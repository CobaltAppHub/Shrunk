import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { Report } from "../scripts/report";

const state = vi.hoisted(() => ({ db: null as unknown, configured: true, send: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/inngest/client", () => ({ inngest: { send: state.send } }));
vi.mock("@/publish", () => ({ providers: { youtube: { isConfigured: () => state.configured } }, freshTokens: async () => ({ accessToken: "test-token" }) }));
const { testYoutubeAccount, verifyPrivateVideo, publishPrivateDemo } = await import("../scripts/e2e-publish");

describe("YouTube E2E extension", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let actor: { userId: string; workspace: { id: string; plan: "pro" } };
  let yt: string;
  let foreign: string;
  let tt: string;
  let clipId: string;
  beforeEach(async () => {
    pg = new PGlite();
    for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
      for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
    }
    db = drizzle(pg, { schema }); state.db = db; state.configured = true; state.send.mockReset();
    await db.insert(schema.users).values([{ id: "u1", email: "a@x.test" }, { id: "u2", email: "b@x.test" }]);
    const [ws, other] = await db.insert(schema.workspaces).values([{ name: "a", ownerId: "u1", plan: "pro" }, { name: "b", ownerId: "u2", plan: "pro" }]).returning();
    actor = { userId: "u1", workspace: { id: ws!.id, plan: "pro" } };
    const [asset] = await db.insert(schema.sourceAssets).values({ workspaceId: ws!.id, kind: "upload" }).returning();
    const [project] = await db.insert(schema.projects).values({ workspaceId: ws!.id, sourceAssetId: asset!.id, title: "p" }).returning();
    const [clip] = await db.insert(schema.clips).values({ projectId: project!.id, startS: 0, endS: 30, score: 50, scoreReasons: {}, renderKey: `ws/${ws!.id}/renders/test.mp4` }).returning();
    clipId = clip!.id;
    const [a, b, c] = await db.insert(schema.socialAccounts).values([
      { workspaceId: ws!.id, platform: "youtube", externalId: "channel", status: "connected" },
      { workspaceId: other!.id, platform: "youtube", externalId: "foreign", status: "connected" },
      { workspaceId: ws!.id, platform: "tiktok", externalId: "tt", status: "connected" },
    ]).returning();
    yt = a!.id; foreign = b!.id; tt = c!.id;
  });
  afterEach(async () => { vi.unstubAllGlobals(); await pg.close(); });

  it("rejects unconfigured, foreign, disconnected and non-YouTube accounts", async () => {
    expect((await testYoutubeAccount(actor, yt)).externalId).toBe("channel");
    for (const id of [foreign, tt]) await expect(testYoutubeAccount(actor, id)).rejects.toThrow("compte YouTube connecté requis");
    await db.update(schema.socialAccounts).set({ status: "expired" }).where(eq(schema.socialAccounts.id, yt));
    await expect(testYoutubeAccount(actor, yt)).rejects.toThrow("compte YouTube connecté requis");
    state.configured = false;
    await expect(testYoutubeAccount(actor, yt)).rejects.toThrow("YOUTUBE_CLIENT_ID");
  });

  it("schedules one private credited-source post through the real core, then checks Google", async () => {
    state.send.mockImplementation(async (event) => {
      await db.update(schema.scheduledPosts).set({ status: "published", externalPostId: "video", publishedAt: new Date() }).where(and(eq(schema.scheduledPosts.id, event.data.postId), eq(schema.scheduledPosts.workspaceId, actor.workspace.id)));
    });
    const http = vi.fn(async () => Response.json({ items: [{ id: "video", snippet: { channelId: "channel" }, status: { privacyStatus: "private", uploadStatus: "processed" } }] }));
    vi.stubGlobal("fetch", http);
    const report = new Report("full");
    await publishPrivateDemo(report, actor, clipId, yt, 1);
    expect(report.verdict).toBe("PASS");
    const posts = await db.select().from(schema.scheduledPosts);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ socialAccountId: yt, options: { privacy: "private" } });
    expect(posts[0]!.caption).toContain("NASA");
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledTimes(1);
    const [url, options] = http.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("part")).toBe("status,snippet");
    expect(options.headers).toEqual({ authorization: "Bearer test-token" });
  });

  it("never calls a different platform or schedules when account ownership fails", async () => {
    await expect(publishPrivateDemo(new Report("full"), actor, clipId, foreign, 1)).rejects.toThrow();
    expect(await db.select().from(schema.scheduledPosts)).toHaveLength(0);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("refuses public, unlisted, wrong-channel, failed, missing and unauthorized videos", async () => {
    for (const item of [
      { id: "video", snippet: { channelId: "channel" }, status: { privacyStatus: "public", uploadStatus: "processed" } },
      { id: "video", snippet: { channelId: "channel" }, status: { privacyStatus: "unlisted", uploadStatus: "processed" } },
      { id: "video", snippet: { channelId: "foreign" }, status: { privacyStatus: "private", uploadStatus: "processed" } },
      { id: "video", snippet: { channelId: "channel" }, status: { privacyStatus: "private", uploadStatus: "failed" } },
      { id: "wrong-video" },
    ]) {
      await expect(verifyPrivateVideo("video", "channel", "test-token", async () => Response.json({ items: [item] }))).rejects.toThrow();
    }
    await expect(verifyPrivateVideo("video", "channel", "test-token", async () => Response.json({ items: [] }))).rejects.toThrow();
    await expect(verifyPrivateVideo("video", "channel", "test-token", async () => new Response(null, { status: 401 }))).rejects.toThrow("HTTP 401");
  });
});
