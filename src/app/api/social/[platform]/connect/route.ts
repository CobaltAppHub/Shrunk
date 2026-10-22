import { and, count, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/pricing";
import { requireWorkspace } from "@/lib/workspace";
import { providers } from "@/publish";
import { OAUTH_COOKIE, pkceChallenge, signState } from "@/publish/schedule";

const platform = z.enum(["tiktok", "youtube", "instagram"]);

export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { user, workspace } = await requireWorkspace("editor");
  const p = platform.safeParse((await params).platform);
  if (!p.success || !providers[p.data].isConfigured()) redirect("/accounts?error=unavailable");

  // Plan limit on connected accounts (the free plan has no auto-publishing).
  const [n] = await db.select({ n: count() }).from(socialAccounts)
    .where(and(eq(socialAccounts.workspaceId, workspace.id), eq(socialAccounts.status, "connected")));
  if ((n?.n ?? 0) >= PLANS[workspace.plan].socialAccounts) redirect("/accounts?error=plan_limit");

  const { token, state } = signState({ ws: workspace.id, user: user.id, platform: p.data }, env.BETTER_AUTH_SECRET);
  (await cookies()).set(OAUTH_COOKIE, token, { httpOnly: true, secure: env.APP_URL.startsWith("https"), sameSite: "lax", path: "/api/social", maxAge: 600 });
  redirect(providers[p.data].authorizeUrl({
    state: state.nonce,
    redirectUri: `${env.APP_URL}/api/social/${p.data}/callback`,
    codeChallenge: pkceChallenge(state.verifier),
  }));
}
