import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

// ── Quota windows ────────────────────────────────────────────────────────────
function wallParts(t: Date, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(t).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)])) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}
const offsetAt = (t: Date, timeZone: string) => {
  const p = wallParts(t, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t.getTime() / 1000) * 1000;
};

/** Start of the calendar day in `timeZone` containing `now`. DST-safe: the offset is re-read at midnight itself. */
export function startOfDayIn(now: Date, timeZone: string): Date {
  const p = wallParts(now, timeZone);
  const midnightWall = Date.UTC(p.year, p.month - 1, p.day);
  const guess = midnightWall - offsetAt(now, timeZone);
  return new Date(midnightWall - offsetAt(new Date(guess), timeZone));
}

const PT = "America/Los_Angeles";
/** YouTube quotas reset at midnight Pacific Time. */
export const youtubeQuotaWindow = (now: Date) => {
  const start = startOfDayIn(now, PT);
  return { start, reset: startOfDayIn(new Date(start.getTime() + 25 * 3_600_000), PT) };
};

/** Instagram: 100 API posts per rolling 24 h. Returns when the next slot frees up, or null if one is free now. */
export function instagramNextSlot(publishedAt: Date[], now: Date, limit = 100): Date | null {
  const recent = publishedAt.filter((d) => now.getTime() - d.getTime() < 86_400_000).sort((a, b) => a.getTime() - b.getTime());
  return recent.length < limit ? null : new Date(recent[recent.length - limit]!.getTime() + 86_400_000);
}

// ── Captions ─────────────────────────────────────────────────────────────────
export const CAPTION_MAX = { tiktok: 2200, youtube: 5000, instagram: 2200 } as const;

/** Default caption: title, hashtags, the source credit when content is not the user's own, and the AI label when required. */
export function defaultCaption(p: { title: string; hashtags: string[]; credit?: string | null; creditLabel: string; aiLabel?: string | null }): string {
  return [p.title, p.hashtags.join(" "), p.credit ? `${p.creditLabel} ${p.credit}` : null, p.aiLabel]
    .filter((x) => x && x.trim()).join("\n\n");
}

// ── OAuth state (CSRF) and PKCE ──────────────────────────────────────────────
export const OAUTH_COOKIE = "shrunk_oauth";
export type OAuthState = { ws: string; user: string; platform: string; nonce: string; exp: number; verifier: string };

export function signState(s: Omit<OAuthState, "nonce" | "exp" | "verifier">, secret: string, now = Date.now()): { token: string; state: OAuthState } {
  const state: OAuthState = { ...s, nonce: randomBytes(12).toString("base64url"), exp: now + 10 * 60_000, verifier: randomBytes(32).toString("base64url") };
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return { token: `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`, state };
}

export function verifyState(token: string | undefined, secret: string, now = Date.now()): OAuthState | null {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const s = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthState;
  return s.exp > now ? s : null;
}

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
