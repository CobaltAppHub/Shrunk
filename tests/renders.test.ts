import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { defaultEditState } from "@/lib/edit-state";
import { getBalance, grant, settle } from "@/lib/credits";
import type { Db } from "@/db";

const state = vi.hoisted(() => ({ db: null as unknown, send: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/inngest/client", () => ({ inngest: { send: state.send } }));
const { requestClipRender } = await import("@/lib/renders");

describe("paid render requests on Postgres", () => {
  let pg: PGlite;
  let db: Db;
  let actor: { userId: string; workspace: { id: string } };
  let clipId: string;
  let otherClipId: string;
  let foreignWorkspace: string;
  beforeEach(async () => {
    pg = new PGlite();
    for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
      for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
    }
    db = drizzle(pg, { schema }) as unknown as Db;
    state.db = db;
    state.send.mockReset().mockResolvedValue({ ids: [] });
    await db.insert(schema.users).values([{ id: "u1", email: "a@x.test" }, { id: "u2", email: "b@x.test" }]);
    const [ws, foreign] = await db.insert(schema.workspaces).values([{ name: "a", ownerId: "u1" }, { name: "b", ownerId: "u2" }]).returning();
    actor = { userId: "u1", workspace: { id: ws!.id } };
    foreignWorkspace = foreign!.id;
    const [asset] = await db.insert(schema.sourceAssets).values({ workspaceId: ws!.id, kind: "upload", durationS: 60 }).returning();
    const [project] = await db.insert(schema.projects).values({ workspaceId: ws!.id, sourceAssetId: asset!.id, title: "p" }).returning();
    const values = { projectId: project!.id, startS: 0, endS: 30, score: 50, scoreReasons: {}, editState: defaultEditState({ startS: 0, endS: 30 }, []) };
    const [one, two] = await db.insert(schema.clips).values([values, values]).returning();
    clipId = one!.id;
    otherClipId = two!.id;
    await grant(db, { workspaceId: ws!.id, amount: 2, key: "test", reason: "test", expiresAt: null });
  });
  afterEach(async () => { await pg.close(); });

  it("reserves once, captures only after delivery, and replays without another debit", async () => {
    const key = crypto.randomUUID();
    const r = await requestClipRender(actor, clipId, key);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("render refused");
    expect(await getBalance(db, actor.workspace.id)).toBe(1);
    expect(await db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, r.jobId))).toMatchObject([{ kind: "reserve", delta: -1 }]);
    await db.update(schema.jobs).set({ status: "succeeded" }).where(eq(schema.jobs.id, r.jobId));
    await db.update(schema.clips).set({ status: "rendered" }).where(eq(schema.clips.id, clipId));
    await settle(db, r.jobId, "capture");
    expect(await requestClipRender(actor, clipId, key)).toEqual(r);
    expect(await settle(db, r.jobId, "capture")).toBe(false);
    expect(await getBalance(db, actor.workspace.id)).toBe(1);
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
    expect(await db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, r.jobId))).toHaveLength(2);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("simultaneous double submit creates one job, one reservation and one audit", async () => {
    const key = crypto.randomUUID();
    const results = await Promise.all([requestClipRender(actor, clipId, key), requestClipRender(actor, clipId, key)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]!.ok).toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
    expect(await db.select().from(schema.auditLog)).toHaveLength(1);
    expect(await getBalance(db, actor.workspace.id)).toBe(1);
    // Re-sends carry the same id, which is the Inngest deduplication key.
    expect(new Set(state.send.mock.calls.map(([event]) => event.id)).size).toBe(1);
  });

  it("different simultaneous keys cannot reserve two renders of the same clip", async () => {
    const results = await Promise.all([requestClipRender(actor, clipId, crypto.randomUUID()), requestClipRender(actor, clipId, crypto.randomUUID())]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, error: "already_rendering" });
    expect(await getBalance(db, actor.workspace.id)).toBe(1);
  });

  it("rejects foreign clips and reusing a key for a different clip or workspace", async () => {
    const key = crypto.randomUUID();
    await requestClipRender(actor, clipId, key);
    expect(await requestClipRender(actor, otherClipId, key)).toEqual({ ok: false, error: "not_found" });
    expect(await requestClipRender({ userId: "u2", workspace: { id: foreignWorkspace } }, clipId, key)).toEqual({ ok: false, error: "not_found" });
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("does not leave jobs, debit, audit or a rendering clip when credits are insufficient", async () => {
    const [spent] = await db.insert(schema.jobs).values({ workspaceId: actor.workspace.id, type: "render", refId: otherClipId, idempotencyKey: "fixture-spend", creditCost: 2 }).returning();
    const { reserve } = await import("@/lib/credits");
    await reserve(db, { workspaceId: actor.workspace.id, jobId: spent!.id, cost: 2, reason: "test fixture" });
    await settle(db, spent!.id, "capture");
    expect(await requestClipRender(actor, clipId, crypto.randomUUID())).toEqual({ ok: false, error: "insufficient_credits" });
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
    expect(await db.select().from(schema.auditLog)).toHaveLength(0);
    expect((await db.select().from(schema.clips).where(eq(schema.clips.id, clipId)))[0]!.status).toBe("candidate");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("recovers a failed event send using the original job, event id and reservation", async () => {
    const key = crypto.randomUUID();
    state.send.mockRejectedValueOnce(new Error("event unavailable"));
    await expect(requestClipRender(actor, clipId, key)).rejects.toThrow("event unavailable");
    expect((await requestClipRender(actor, clipId, key)).ok).toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
    expect(await getBalance(db, actor.workspace.id)).toBe(1);
    expect(state.send.mock.calls[0]![0]).toEqual(state.send.mock.calls[1]![0]);
  });

  it("refuses unsaved and out-of-bounds edits before any charge", async () => {
    await db.update(schema.clips).set({ editState: {} }).where(eq(schema.clips.id, clipId));
    expect(await requestClipRender(actor, clipId, crypto.randomUUID())).toEqual({ ok: false, error: "not_saved" });
    await db.update(schema.clips).set({ editState: defaultEditState({ startS: 0, endS: 70 }, []) }).where(eq(schema.clips.id, clipId));
    expect(await requestClipRender(actor, clipId, crypto.randomUUID())).toEqual({ ok: false, error: "trim_invalid" });
    expect(await getBalance(db, actor.workspace.id)).toBe(2);
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
  });
});
