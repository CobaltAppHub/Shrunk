import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { auditLog, socialAccounts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { encryptedTokens, providers } from "@/publish";
import { OAUTH_COOKIE, verifyState } from "@/publish/schedule";
import { PublishError, type Platform } from "@/publish/types";

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const url = new URL(req.url);
  const jar = await cookies();
  const state = verifyState(jar.get(OAUTH_COOKIE)?.value, env.BETTER_AUTH_SECRET);
  jar.delete({ name: OAUTH_COOKIE, path: "/api/social" });
  const platform = (await params).platform as Platform;
  const session = await getSession();

  // CSRF: the state must be ours, unexpired, for this platform, this user, and echoed back by the provider.
  if (!state || state.platform !== platform || state.nonce !== url.searchParams.get("state") || state.user !== session?.user.id) {
    redirect("/accounts?error=state");
  }
  if (url.searchParams.get("error") || !url.searchParams.get("code")) redirect("/accounts?error=denied");

  let account;
  try {
    account = await providers[platform].exchangeCode({
      code: url.searchParams.get("code")!,
      redirectUri: `${env.APP_URL}/api/social/${platform}/callback`,
      codeVerifier: state.verifier,
    });
  } catch (e) {
    redirect(`/accounts?error=${e instanceof PublishError && e.code === "rejected" ? "not_eligible" : "connect_failed"}`);
  }

  const values = {
    ...encryptedTokens(account),
    displayName: account.displayName,
    status: "connected",
    lastError: null,
    connectedBy: state.user,
    connectedAt: new Date(),
  };
  await db.insert(socialAccounts)
    .values({ workspaceId: state.ws, platform, externalId: account.externalId, ...values })
    .onConflictDoUpdate({ target: [socialAccounts.workspaceId, socialAccounts.platform, socialAccounts.externalId], set: values });
  await db.insert(auditLog).values({ workspaceId: state.ws, actorId: state.user, action: "social.connect", target: `${platform}:${account.externalId}` });
  redirect(`/accounts?connected=${platform}`);
}
