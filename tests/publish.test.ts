import { describe, expect, it } from "vitest";
import { failFrom } from "@/publish/common";
import { instagram } from "@/publish/instagram";
import { defaultCaption, instagramNextSlot, pkceChallenge, signState, verifyState, youtubeQuotaWindow } from "@/publish/schedule";
import { freeSlots, visibleDays } from "@/publish/slots";
import { chunkPlan, mapTikTokStatus, tiktok } from "@/publish/tiktok";
import { PublishError, type PublishInput, type Tokens } from "@/publish/types";
import { youtube } from "@/publish/youtube";

const MB = 1024 * 1024;
const tokens: Tokens = { accessToken: "at", refreshToken: "rt", expiresAt: null, scopes: [] };

/** Fake fetch: records calls, answers from a list of handlers matched by URL substring. */
function fakeHttp(routes: [string, (init: RequestInit, url: string) => Response][]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find(([k]) => url.includes(k));
    if (!r) throw new Error(`unexpected call ${url}`);
    return r[1](init, url);
  }) as typeof fetch;
  return { http, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const input = (bytes: number, extra: Partial<PublishInput> = {}): PublishInput => ({
  accountExternalId: "IG123",
  video: { bytes, readRange: async (s, e) => new Uint8Array(e - s + 1), signedUrl: async () => "https://r2.example/render.mp4?sig=x" },
  title: "Titre", caption: "Légende #tag", aiGenerated: false, options: {}, ...extra,
});
const errCode = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof PublishError ? e.code : String(e)));

describe("TikTok", () => {
  it("chunk plan follows the documented limits", () => {
    expect(chunkPlan(3 * MB)).toEqual({ chunkSize: 3 * MB, count: 1 });
    expect(chunkPlan(25 * MB)).toEqual({ chunkSize: 10 * MB, count: 2 }); // last chunk 15 MB
    const big = chunkPlan(4 * 1024 * MB);
    expect(big.count).toBeLessThanOrEqual(1000);
    expect(big.chunkSize).toBeLessThanOrEqual(64 * MB);
    expect(4 * 1024 * MB - (big.count - 1) * big.chunkSize).toBeLessThanOrEqual(128 * MB);
  });

  it("unaudited app: inbox upload, contiguous chunks, then draft_sent", async () => {
    const { http, calls } = fakeHttp([
      ["/inbox/video/init/", () => json({ data: { publish_id: "p1", upload_url: "https://upload.tiktok/u" }, error: { code: "ok" } })],
      ["upload.tiktok", () => new Response(null, { status: 201 })],
      ["/status/fetch/", () => json({ data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } })],
    ]);
    const tt = tiktok({ clientKey: "k", clientSecret: "s", audited: false }, http);
    const out = await tt.publish(input(25 * MB), tokens);
    expect(out).toEqual({ status: "processing", pollRef: "p1" });
    const init = JSON.parse(String(calls[0]!.init.body));
    expect(init.source_info).toEqual({ source: "FILE_UPLOAD", video_size: 25 * MB, chunk_size: 10 * MB, total_chunk_count: 2 });
    const ranges = calls.filter((c) => c.url.includes("upload.tiktok")).map((c) => (c.init.headers as Record<string, string>)["content-range"]);
    expect(ranges).toEqual([`bytes 0-${10 * MB - 1}/${25 * MB}`, `bytes ${10 * MB}-${25 * MB - 1}/${25 * MB}`]);
    expect(await tt.checkStatus("p1", tokens)).toEqual({ status: "draft_sent", externalPostId: "p1" });
  });

  it("audited app: privacy level must be one the creator offers; AI flag is sent", async () => {
    const { http, calls } = fakeHttp([
      ["/creator_info/query/", () => json({ data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, error: { code: "ok" } })],
      ["/post/publish/video/init/", () => json({ data: { publish_id: "p2", upload_url: "https://upload.tiktok/u" }, error: { code: "ok" } })],
      ["upload.tiktok", () => new Response(null, { status: 201 })],
    ]);
    const tt = tiktok({ clientKey: "k", clientSecret: "s", audited: true }, http);
    expect(await errCode(tt.publish(input(MB, { options: { tiktokPrivacyLevel: "FOLLOWER_OF_CREATOR" } }), tokens))).toBe("rejected");
    await tt.publish(input(MB, { aiGenerated: true, options: { tiktokPrivacyLevel: "SELF_ONLY" } }), tokens);
    const body = JSON.parse(String(calls.find((c) => c.url.endsWith("/post/publish/video/init/"))!.init.body));
    expect(body.post_info).toMatchObject({ privacy_level: "SELF_ONLY", is_aigc: true });
  });

  it("maps statuses and API error codes", async () => {
    expect(mapTikTokStatus({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [42] }, "p")).toEqual({ status: "published", externalPostId: "42" });
    expect(mapTikTokStatus({ status: "PROCESSING_UPLOAD" }, "p")).toEqual({ status: "processing", pollRef: "p" });
    expect(() => mapTikTokStatus({ status: "FAILED", fail_reason: "duration" }, "p")).toThrow(PublishError);
    for (const [code, expected] of [["access_token_invalid", "auth_expired"], ["rate_limit_exceeded", "rate_limited"], ["spam_risk_too_many_pending_share", "quota_exceeded"]]) {
      const { http } = fakeHttp([["/inbox/video/init/", () => json({ data: {}, error: { code, message: "" } })]]);
      expect(await errCode(tiktok({ clientKey: "k", clientSecret: "s", audited: false }, http).publish(input(MB), tokens))).toBe(expected);
    }
  });
});

describe("YouTube", () => {
  it("resumable upload with privacy and the synthetic-media flag", async () => {
    const { http, calls } = fakeHttp([
      ["uploadType=resumable", () => new Response(null, { status: 200, headers: { location: "https://upload.youtube/session" } })],
      ["upload.youtube/session", () => json({ id: "vid123" })],
    ]);
    const out = await youtube({ clientId: "c", clientSecret: "s" }, http).publish(input(5 * MB, { aiGenerated: true, options: { privacy: "unlisted" } }), tokens);
    expect(out).toEqual({ status: "published", externalPostId: "vid123" });
    const meta = JSON.parse(String(calls[0]!.init.body));
    expect(meta.status).toEqual({ privacyStatus: "unlisted", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect((calls[0]!.init.headers as Record<string, string>)["x-upload-content-length"]).toBe(String(5 * MB));
  });

  it("quota errors are recognised; refresh keeps the refresh token Google omits", async () => {
    const quota = fakeHttp([["uploadType=resumable", () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403)]]);
    expect(await errCode(youtube({ clientId: "c", clientSecret: "s" }, quota.http).publish(input(MB), tokens))).toBe("quota_exceeded");
    const r = fakeHttp([["oauth2.googleapis.com/token", () => json({ access_token: "new", expires_in: 3600, scope: "a b" })]]);
    expect(await youtube({ clientId: "c", clientSecret: "s" }, r.http).refresh(tokens)).toMatchObject({ accessToken: "new", refreshToken: "rt" });
  });
});

describe("Instagram", () => {
  it("container on the account id, poll, then media_publish", async () => {
    let state = "IN_PROGRESS";
    const { http, calls } = fakeHttp([
      ["/IG123/media_publish", () => json({ id: "media9" })],
      ["/IG123/media", () => json({ id: "c1" })],
      ["/c1?", () => json({ status_code: state })],
    ]);
    const ig = instagram({ appId: "a", appSecret: "s" }, http);
    const first = await ig.publish(input(MB), tokens);
    expect(first).toEqual({ status: "processing", pollRef: "IG123:c1" });
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("video_url")).toBe("https://r2.example/render.mp4?sig=x");
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("media_type")).toBe("REELS");
    expect(await ig.checkStatus("IG123:c1", tokens)).toEqual({ status: "processing", pollRef: "IG123:c1" });
    state = "FINISHED";
    expect(await ig.checkStatus("IG123:c1", tokens)).toEqual({ status: "published", externalPostId: "media9" });
    state = "ERROR";
    expect(await errCode(ig.checkStatus("IG123:c1", tokens))).toBe("rejected");
  });
});

describe("HTTP error mapping", () => {
  it.each([[401, "auth_expired"], [429, "rate_limited"], [503, "temporary"], [400, "rejected"]])("%i → %s", async (status, code) => {
    expect(await errCode(failFrom(new Response("x", { status }), "t"))).toBe(code);
  });
});

describe("scheduling maths", () => {
  it("YouTube quota day is the Pacific Time day, DST included", () => {
    const pdt = youtubeQuotaWindow(new Date("2026-10-23T12:00:00Z"));
    expect([pdt.start.toISOString(), pdt.reset.toISOString()]).toEqual(["2026-10-23T07:00:00.000Z", "2026-10-24T07:00:00.000Z"]);
    const dstEnd = youtubeQuotaWindow(new Date("2026-11-01T20:00:00Z")); // clocks go back on 1 Nov 2026
    expect([dstEnd.start.toISOString(), dstEnd.reset.toISOString()]).toEqual(["2026-11-01T07:00:00.000Z", "2026-11-02T08:00:00.000Z"]);
    const late = youtubeQuotaWindow(new Date("2026-10-24T06:59:00Z")); // still 23 Oct in California
    expect(late.start.toISOString()).toBe("2026-10-23T07:00:00.000Z");
  });

  it("rolling 24 h limits", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
    expect(instagramNextSlot([h(1), h(2)], now, 5)).toBeNull();
    expect(instagramNextSlot([h(1), h(2), h(3), h(23), h(30)], now, 4)).toEqual(new Date(h(23).getTime() + 86_400_000));
  });

  it("caption keeps the credit and the AI label", () => {
    expect(defaultCaption({ title: "Titre", hashtags: ["#a", "#b"], credit: "NASA SVS", creditLabel: "Crédit :", aiLabel: "Contenu généré par IA" }))
      .toBe("Titre\n\n#a #b\n\nCrédit : NASA SVS\n\nContenu généré par IA");
    expect(defaultCaption({ title: "T", hashtags: [], credit: null, creditLabel: "Crédit :" })).toBe("T");
  });

  it("free slots skip the past and booked hours (local time)", () => {
    const now = new Date("2026-10-23T10:00:00Z"); // 12:00 in Paris (UTC+2 → offset -120)
    const slots = freeSlots(now, [new Date("2026-10-23T16:00:00Z")], [12, 18, 20], 3, -120);
    expect(slots.map((s) => s.toISOString())).toEqual(["2026-10-23T18:00:00.000Z", "2026-10-24T10:00:00.000Z", "2026-10-24T16:00:00.000Z"]);
  });

  it("calendar grids start on Monday", () => {
    const month = visibleDays("month", "2026-10-15");
    expect(month).toHaveLength(35);
    expect(month[0]!.getDate()).toBe(28); // Monday 28 Sept
    expect(visibleDays("week", "2026-10-22")[0]!.getDate()).toBe(19);
  });
});

describe("OAuth state and PKCE", () => {
  it("signed, bound to its content, expiring", () => {
    const { token, state } = signState({ ws: "w", user: "u", platform: "tiktok" }, "secret", 1000);
    expect(verifyState(token, "secret", 2000)).toEqual(state);
    expect(verifyState(token, "other", 2000)).toBeNull();
    expect(verifyState(token.replace(/^./, "x"), "secret", 2000)).toBeNull();
    expect(verifyState(token, "secret", 1000 + 11 * 60_000)).toBeNull();
    expect(verifyState(undefined, "secret")).toBeNull();
  });
  it("PKCE S256 matches RFC 7636 appendix B", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
