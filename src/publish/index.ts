import { eq } from "drizzle-orm";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { env } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/secrets";
import { instagram } from "./instagram";
import { tiktok } from "./tiktok";
import { PublishError, type Platform, type PublisherProvider, type Tokens } from "./types";
import { youtube } from "./youtube";

export const providers: Record<Platform, PublisherProvider> = {
  tiktok: tiktok({ clientKey: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET, audited: env.TIKTOK_AUDITED === "1" }),
  youtube: youtube({ clientId: env.YOUTUBE_CLIENT_ID, clientSecret: env.YOUTUBE_CLIENT_SECRET }),
  instagram: instagram({ appId: env.INSTAGRAM_APP_ID, appSecret: env.INSTAGRAM_APP_SECRET }),
};
export const configuredPlatforms = () => (Object.keys(providers) as Platform[]).filter((p) => providers[p].isConfigured());
export const tiktokDraftMode = () => env.TIKTOK_AUDITED !== "1";

type Account = typeof socialAccounts.$inferSelect;
const key = env.DATA_ENCRYPTION_KEY;

export function tokensOf(a: Account): Tokens {
  return {
    accessToken: decrypt(a.accessTokenEnc!, key),
    refreshToken: a.refreshTokenEnc ? decrypt(a.refreshTokenEnc, key) : null,
    expiresAt: a.expiresAt,
    scopes: a.scopes ?? [],
  };
}

export const encryptedTokens = (t: Tokens) => ({
  accessTokenEnc: encrypt(t.accessToken, key),
  refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken, key) : null,
  expiresAt: t.expiresAt,
  scopes: t.scopes,
});

/** Mark an account disconnected; the UI shows it and the owner gets an email from the caller. */
export const markExpired = (id: string, reason: string) =>
  db.update(socialAccounts).set({ status: "expired", lastError: reason.slice(0, 300) }).where(eq(socialAccounts.id, id));

/**
 * Tokens valid for at least `marginMs`, refreshing (and persisting) them if needed.
 * A refusal from the platform marks the account expired instead of retrying forever.
 */
export async function freshTokens(a: Account, marginMs = 5 * 60_000): Promise<Tokens> {
  if (a.status !== "connected") throw new PublishError("auth_expired", `account ${a.status}`);
  const t = tokensOf(a);
  if (!t.expiresAt || t.expiresAt.getTime() - Date.now() > marginMs) return t;
  try {
    const fresh = await providers[a.platform].refresh(t);
    await db.update(socialAccounts).set({ ...encryptedTokens(fresh), lastError: null }).where(eq(socialAccounts.id, a.id));
    return fresh;
  } catch (e) {
    if (e instanceof PublishError && e.code === "auth_expired") await markExpired(a.id, e.detail || e.message);
    throw e;
  }
}
