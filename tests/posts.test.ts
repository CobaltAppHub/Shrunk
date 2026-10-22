// Scheduling on a real Postgres (PGlite): plan gating, tenancy, double-submit safety, reschedule/cancel/retry rules.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const sent: { name: string; id?: string; data: Record<string, unknown> }[] = [];
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async (e: (typeof sent)[number]) => { sent.push(e); } } }));

const { schedulePosts, reschedulePost, cancelPost, retryPost } = await import("@/lib/posts");

async function setup() {
  const pg = new PGlite();
  for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
  }
  const db = drizzle(pg, { schema });
  state.db = db;
  await db.insert(schema.users).values([{ id: "u1", email: "a@x.test" }, { id: "u2", email: "b@x.test" }]);
  const [ws] = await db.insert(schema.workspaces).values({ name: "a", ownerId: "u1", plan: "pro" }).returning();
  const [other] = await db.insert(schema.workspaces).values({ name: "b", ownerId: "u2", plan: "pro" }).returning();
  const [asset] = await db.insert(schema.sourceAssets).values({ workspaceId: ws!.id, kind: "upload" }).returning();
  const [project] = await db.insert(schema.projects).values({ workspaceId: ws!.id, sourceAssetId: asset!.id, title: "p" }).returning();
  const clip = (renderKey: string | null) => ({ projectId: project!.id, startS: 0, endS: 30, score: 50, scoreReasons: {}, renderKey });
  const [rendered, raw] = await db.insert(schema.clips).values([clip("ws/x/renders/a.mp4"), clip(null)]).returning();
  const acc = (workspaceId: string, platform: "tiktok" | "youtube", externalId: string) => ({ workspaceId, platform, externalId, accessTokenEnc: "x", status: "connected" });
  const [tt, yt, foreign] = await db.insert(schema.socialAccounts).values([acc(ws!.id, "tiktok", "t1"), acc(ws!.id, "youtube", "y1"), acc(other!.id, "tiktok", "t2")]).returning();
  return { db, actor: { userId: "u1", workspace: { id: ws!.id, plan: "pro" as const } }, rendered: rendered!, raw: raw!, tt: tt!, yt: yt!, foreign: foreign! };
}

describe("schedulePosts", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  const when = () => new Date(Date.now() + 3_600_000);
  beforeEach(async () => { s = await setup(); sent.length = 0; });

  const base = () => ({ clipId: s.rendered.id, accountIds: [s.tt.id, s.yt.id], caption: "hello", scheduledAt: when(), idempotencyKey: crypto.randomUUID() });

  it("creates one post per account and one event each; YouTube shares one quota queue", async () => {
    const r = await schedulePosts(s.actor, base());
    expect(r.ok && r.postIds.length).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent.map((e) => e.data.quotaKey).sort()).toContain("youtube");
  });

  it("a double submit (same key) schedules nothing twice", async () => {
    const input = base();
    await schedulePosts(s.actor, input);
    const again = await schedulePosts(s.actor, input);
    expect(again.ok && again.postIds).toEqual([]);
    expect(sent).toHaveLength(2);
    expect(await s.db.select().from(schema.scheduledPosts)).toHaveLength(2);
  });

  it("refuses: free plan, unrendered clip, other workspace's account, caption too long, past date", async () => {
    expect(await schedulePosts({ ...s.actor, workspace: { ...s.actor.workspace, plan: "free" } }, base())).toEqual({ ok: false, error: "plan_no_autopublish" });
    expect(await schedulePosts(s.actor, { ...base(), clipId: s.raw.id })).toEqual({ ok: false, error: "not_rendered" });
    expect(await schedulePosts(s.actor, { ...base(), accountIds: [s.foreign.id] })).toEqual({ ok: false, error: "account_unavailable" });
    expect(await schedulePosts(s.actor, { ...base(), accountIds: [s.tt.id], caption: "x".repeat(2300) })).toEqual({ ok: false, error: "caption_too_long" });
    expect(await schedulePosts(s.actor, { ...base(), scheduledAt: new Date(Date.now() - 3_600_000) })).toEqual({ ok: false, error: "date_invalid" });
    expect(sent).toHaveLength(0);
  });

  it("reschedule sends a new event; cancel stops it; retry never re-sends an uncertain upload", async () => {
    const r = await schedulePosts(s.actor, { ...base(), accountIds: [s.tt.id] });
    const id = r.ok ? r.postIds[0]! : "";
    const later = new Date(Date.now() + 7_200_000);
    expect(await reschedulePost(s.actor, id, later)).toEqual({ ok: true });
    expect(sent.at(-1)!.data.scheduledAt).toBe(later.toISOString());
    expect(await cancelPost(s.actor, id)).toEqual({ ok: true });
    expect(await reschedulePost(s.actor, id, later)).toEqual({ ok: false, error: "not_editable" });

    await s.db.update(schema.scheduledPosts).set({ status: "failed", error: "uncertain_state" }).where(eq(schema.scheduledPosts.id, id));
    expect(await retryPost(s.actor, id)).toEqual({ ok: false, error: "not_editable" });
    await s.db.update(schema.scheduledPosts).set({ error: "rate_limited", attemptedAt: new Date() }).where(eq(schema.scheduledPosts.id, id));
    expect(await retryPost(s.actor, id)).toEqual({ ok: true });
    const [post] = await s.db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id));
    expect(post).toMatchObject({ status: "scheduled", attemptedAt: null, error: null });
  });

  it("another workspace cannot touch the post", async () => {
    const r = await schedulePosts(s.actor, { ...base(), accountIds: [s.tt.id] });
    const id = r.ok ? r.postIds[0]! : "";
    const intruder = { userId: "u2", workspace: { id: s.foreign.workspaceId, plan: "pro" as const } };
    expect(await cancelPost(intruder, id)).toEqual({ ok: false, error: "not_editable" });
  });
});
