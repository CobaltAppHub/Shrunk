import { expiresIn, failFrom, json } from "./common";
import { PublishError, type Http, type PublisherProvider, type PublishOutcome, type Tokens } from "./types";

// Content Posting API, checked 2026-10-23 on developers.tiktok.com:
// - inbox upload (video.upload) until the app passes TikTok's audit; direct post (video.publish) after.
// - 6 requests/min per token; at most 5 pending inbox shares per user per 24 h.
// - FILE_UPLOAD chunks: 5-64 MB, last chunk up to 128 MB, files < 5 MB in one chunk, ≤ 1000 chunks, in order.
const API = "https://open.tiktokapis.com/v2";
const MB = 1024 * 1024;

/** Chunk layout accepted by TikTok for a file of `size` bytes. */
export function chunkPlan(size: number, preferred = 10 * MB): { chunkSize: number; count: number } {
  if (size < 5 * MB) return { chunkSize: size, count: 1 };
  let chunkSize = Math.min(64 * MB, Math.max(5 * MB, preferred));
  while (Math.floor(size / chunkSize) > 1000) chunkSize = Math.min(64 * MB, chunkSize * 2);
  return { chunkSize, count: Math.floor(size / chunkSize) }; // the remainder rides on the last chunk (< 2 × chunkSize ≤ 128 MB)
}

type TikTokEnvelope<T> = { data: T; error: { code: string; message: string } };
const ok = <T>(r: TikTokEnvelope<T>, ctx: string): T => {
  if (r.error?.code && r.error.code !== "ok") {
    const c = r.error.code;
    if (c === "access_token_invalid" || c === "scope_not_authorized") throw new PublishError("auth_expired", `${ctx} ${c}`);
    if (c === "rate_limit_exceeded") throw new PublishError("rate_limited", `${ctx} ${c}`, 60);
    if (c === "spam_risk_too_many_pending_share") throw new PublishError("quota_exceeded", `${ctx} ${c}`);
    throw new PublishError("rejected", `${ctx} ${c} ${r.error.message}`);
  }
  return r.data;
};

/** TikTok publish status → our outcome. SEND_TO_USER_INBOX is the honest "draft sent" state. */
export function mapTikTokStatus(d: { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }, publishId: string): PublishOutcome {
  switch (d.status) {
    case "SEND_TO_USER_INBOX": return { status: "draft_sent", externalPostId: publishId };
    case "PUBLISH_COMPLETE": return { status: "published", externalPostId: String(d.publicaly_available_post_id?.[0] ?? publishId) };
    case "FAILED": throw new PublishError("rejected", d.fail_reason ?? "FAILED");
    default: return { status: "processing", pollRef: publishId };
  }
}

export function tiktok(cfg: { clientKey?: string; clientSecret?: string; audited: boolean }, http: Http = fetch): PublisherProvider {
  const form = (o: Record<string, string>) => new URLSearchParams(o);
  const token = async (body: URLSearchParams): Promise<Tokens & { open_id: string }> => {
    const r = await json<{ access_token: string; refresh_token: string; expires_in: number; scope: string; open_id: string; error?: string }>(
      await http(`${API}/oauth/token/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }), "token");
    if (r.error || !r.access_token) throw new PublishError("auth_expired", `token ${r.error ?? "no token"}`);
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: expiresIn(r.expires_in), scopes: r.scope.split(","), open_id: r.open_id };
  };
  const call = async <T>(path: string, t: Tokens, body: unknown) =>
    ok(await json<TikTokEnvelope<T>>(await http(`${API}${path}`, {
      method: "POST", headers: { authorization: `Bearer ${t.accessToken}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(body),
    }), path), path);

  return {
    platform: "tiktok",
    isConfigured: () => !!(cfg.clientKey && cfg.clientSecret),
    authorizeUrl: ({ state, redirectUri, codeChallenge }) => `https://www.tiktok.com/v2/auth/authorize/?${form({
      client_key: cfg.clientKey!, response_type: "code", redirect_uri: redirectUri, state,
      scope: ["user.info.basic", cfg.audited ? "video.publish" : "video.upload"].join(","),
      code_challenge: codeChallenge, code_challenge_method: "S256",
    })}`,
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const t = await token(form({ client_key: cfg.clientKey!, client_secret: cfg.clientSecret!, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: codeVerifier }));
      const me = await http(`${API}/user/info/?fields=open_id,display_name`, { headers: { authorization: `Bearer ${t.accessToken}` } })
        .then((r) => json<TikTokEnvelope<{ user: { display_name: string } }>>(r, "user info"));
      return { ...t, externalId: t.open_id, displayName: ok(me, "user info").user.display_name };
    },
    async refresh(t) {
      if (!t.refreshToken) throw new PublishError("auth_expired", "no refresh token");
      // A refresh may return a new refresh token: always store the one we get back.
      return token(form({ client_key: cfg.clientKey!, client_secret: cfg.clientSecret!, grant_type: "refresh_token", refresh_token: t.refreshToken }));
    },
    async publish(input, t) {
      const { chunkSize, count } = chunkPlan(input.video.bytes);
      const source_info = { source: "FILE_UPLOAD", video_size: input.video.bytes, chunk_size: chunkSize, total_chunk_count: count };
      let init: { publish_id: string; upload_url: string };
      if (cfg.audited) {
        const creator = await call<{ privacy_level_options: string[] }>("/post/publish/creator_info/query/", t, {});
        const level = input.options.tiktokPrivacyLevel;
        if (!level || !creator.privacy_level_options.includes(level)) throw new PublishError("rejected", "privacy level not offered by this account");
        init = await call("/post/publish/video/init/", t, {
          post_info: { title: input.caption.slice(0, 2200), privacy_level: level, is_aigc: input.aiGenerated },
          source_info,
        });
      } else {
        init = await call("/post/publish/inbox/video/init/", t, { source_info });
      }
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? input.video.bytes - 1 : start + chunkSize - 1;
        const res = await http(init.upload_url, {
          method: "PUT",
          headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${input.video.bytes}` },
          body: Buffer.from(await input.video.readRange(start, end)),
        });
        if (!res.ok) await failFrom(res, `upload chunk ${i + 1}/${count}`);
      }
      return { status: "processing", pollRef: init.publish_id };
    },
    async checkStatus(publishId, t) {
      return mapTikTokStatus(await call("/post/publish/status/fetch/", t, { publish_id: publishId }), publishId);
    },
  };
}
