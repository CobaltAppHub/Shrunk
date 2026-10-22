import { expiresIn, json } from "./common";
import { PublishError, type Http, type PublisherProvider, type PublishOutcome } from "./types";

// Instagram API with Instagram Login (graph.instagram.com), checked 2026-10-23:
// professional (Business/Creator) accounts only; permissions instagram_business_basic + instagram_business_content_publish;
// Reels = container (media_type=REELS, public video_url) → poll status_code → media_publish;
// 100 API-published posts per account per rolling 24 h (enforced by the scheduler too).
// The OAuth endpoints below follow Meta's documented flow; re-check them when the app is created.
const GRAPH = "https://graph.instagram.com";

export function instagram(cfg: { appId?: string; appSecret?: string }, http: Http = fetch): PublisherProvider {
  const get = async <T>(path: string, params: Record<string, string>) => json<T>(await http(`${GRAPH}${path}?${new URLSearchParams(params)}`), path);
  const post = async <T>(path: string, params: Record<string, string>) =>
    json<T>(await http(`${GRAPH}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) }), path);

  return {
    platform: "instagram",
    isConfigured: () => !!(cfg.appId && cfg.appSecret),
    // Meta's Instagram Login does not take PKCE; the signed state cookie protects the callback.
    authorizeUrl: ({ state, redirectUri }) => `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
      client_id: cfg.appId!, redirect_uri: redirectUri, response_type: "code", state,
      scope: "instagram_business_basic,instagram_business_content_publish",
    })}`,
    async exchangeCode({ code, redirectUri }) {
      const short = await json<{ access_token: string; user_id: string | number }>(await http("https://api.instagram.com/oauth/access_token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: cfg.appId!, client_secret: cfg.appSecret!, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
      }), "token");
      const long = await get<{ access_token: string; expires_in: number }>("/access_token", { grant_type: "ig_exchange_token", client_secret: cfg.appSecret!, access_token: short.access_token });
      const me = await get<{ user_id: string; username: string; account_type?: string }>("/me", { fields: "user_id,username,account_type", access_token: long.access_token });
      if (me.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(me.account_type)) throw new PublishError("rejected", "a professional (Business or Creator) Instagram account is required");
      // Long-lived token, refreshed by the token cron before its 60 days run out.
      return { accessToken: long.access_token, refreshToken: null, expiresAt: expiresIn(long.expires_in), scopes: ["instagram_business_basic", "instagram_business_content_publish"], externalId: String(me.user_id), displayName: me.username };
    },
    async refresh(t) {
      const r = await get<{ access_token: string; expires_in: number }>("/refresh_access_token", { grant_type: "ig_refresh_token", access_token: t.accessToken });
      return { ...t, accessToken: r.access_token, expiresAt: expiresIn(r.expires_in) };
    },
    async publish(input, t) {
      const container = await post<{ id: string }>(`/${input.accountExternalId}/media`, {
        media_type: "REELS", video_url: await input.video.signedUrl(), caption: input.caption.slice(0, 2200), share_to_feed: "true", access_token: t.accessToken,
      });
      return { status: "processing", pollRef: `${input.accountExternalId}:${container.id}` };
    },
    async checkStatus(pollRef, t): Promise<PublishOutcome> {
      const [igId, containerId] = pollRef.split(":") as [string, string];
      const c = await get<{ status_code: string; status?: string }>(`/${containerId}`, { fields: "status_code,status", access_token: t.accessToken });
      if (c.status_code === "IN_PROGRESS") return { status: "processing", pollRef };
      if (c.status_code === "ERROR" || c.status_code === "EXPIRED") throw new PublishError("rejected", `container ${c.status_code} ${c.status ?? ""}`);
      if (c.status_code === "PUBLISHED") return { status: "published", externalPostId: containerId };
      const published = await post<{ id: string }>(`/${igId}/media_publish`, { creation_id: containerId, access_token: t.accessToken });
      return { status: "published", externalPostId: published.id };
    },
  };
}
