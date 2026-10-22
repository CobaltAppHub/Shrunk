import { expiresIn, failFrom, json } from "./common";
import { PublishError, type Http, type PublisherProvider } from "./types";

// YouTube Data API videos.insert, checked 2026-10-23: 1 unit in the "Video Uploads" quota bucket,
// 100 calls/day by default (per Google Cloud project, reset at midnight Pacific Time). The scheduler
// enforces that budget before calling; status.containsSyntheticMedia carries the AI label.
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

export function youtube(cfg: { clientId?: string; clientSecret?: string }, http: Http = fetch): PublisherProvider {
  const token = async (body: URLSearchParams) => {
    const r = await json<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>(
      await http("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }), "token");
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? null, expiresAt: expiresIn(r.expires_in), scopes: r.scope.split(" ") };
  };
  return {
    platform: "youtube",
    isConfigured: () => !!(cfg.clientId && cfg.clientSecret),
    authorizeUrl: ({ state, redirectUri, codeChallenge }) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: cfg.clientId!, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "), state,
      access_type: "offline", prompt: "consent", include_granted_scopes: "true",
      code_challenge: codeChallenge, code_challenge_method: "S256",
    })}`,
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const t = await token(new URLSearchParams({ client_id: cfg.clientId!, client_secret: cfg.clientSecret!, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: codeVerifier }));
      const me = await json<{ items?: { id: string; snippet: { title: string } }[] }>(
        await http("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${t.accessToken}` } }), "channels");
      const ch = me.items?.[0];
      if (!ch) throw new PublishError("rejected", "this Google account has no YouTube channel");
      return { ...t, externalId: ch.id, displayName: ch.snippet.title };
    },
    async refresh(t) {
      if (!t.refreshToken) throw new PublishError("auth_expired", "no refresh token");
      const fresh = await token(new URLSearchParams({ client_id: cfg.clientId!, client_secret: cfg.clientSecret!, grant_type: "refresh_token", refresh_token: t.refreshToken }));
      return { ...fresh, refreshToken: fresh.refreshToken ?? t.refreshToken }; // Google usually omits it on refresh
    },
    async publish(input, t) {
      const meta = {
        snippet: { title: input.title.slice(0, 100), description: input.caption.slice(0, 5000), categoryId: "22" },
        status: { privacyStatus: input.options.privacy ?? "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: input.aiGenerated },
      };
      const init = await http("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: { authorization: `Bearer ${t.accessToken}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(input.video.bytes) },
        body: JSON.stringify(meta),
      });
      if (!init.ok) await failFrom(init, "upload init");
      const session = init.headers.get("location");
      if (!session) throw new PublishError("temporary", "no resumable session URL");
      // ponytail: one PUT of the whole render (shorts are tens of MB); chunked resume if renders grow past ~500 MB.
      const res = await http(session, { method: "PUT", headers: { "content-type": "video/mp4" }, body: Buffer.from(await input.video.readRange(0, input.video.bytes - 1)) });
      const video = await json<{ id: string }>(res, "upload");
      return { status: "published", externalPostId: video.id };
    },
    async checkStatus(ref) {
      return { status: "published", externalPostId: ref };
    },
  };
}
