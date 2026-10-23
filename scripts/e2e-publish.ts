import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scheduledPosts, socialAccounts } from "@/db/schema";
import { schedulePosts, type PostActor } from "@/lib/posts";
import { freshTokens, providers } from "@/publish";
import { defaultCaption } from "@/publish/schedule";
import { DEMO } from "./seed";
import type { Report } from "./report";

export const PUBLISH_FILES = ["scripts/e2e-publish.ts", "src/lib/posts.ts", "src/inngest/publish.ts", "src/publish/youtube.ts", "docs/PUBLISHING.md"];

export async function testYoutubeAccount(actor: PostActor, accountId: string) {
  if (!providers.youtube.isConfigured()) throw new Error("YOUTUBE_CLIENT_ID et YOUTUBE_CLIENT_SECRET requis");
  const [account] = await db.select().from(socialAccounts).where(and(
    eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, actor.workspace.id),
    eq(socialAccounts.platform, "youtube"), eq(socialAccounts.status, "connected"),
  ));
  if (!account) throw new Error("compte YouTube connecté requis dans l'espace E2E ; aucun autre compte ne sera utilisé");
  return account;
}

/** Read back the actual privacy from Google, rather than trusting our stored options. */
export async function verifyPrivateVideo(videoId: string, channelId: string, accessToken: string, http: typeof fetch = fetch) {
  const query = new URLSearchParams({ part: "status,snippet", id: videoId });
  const response = await http(`https://www.googleapis.com/youtube/v3/videos?${query}`, {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`lecture du statut YouTube refusée (HTTP ${response.status})`);
  const body = await response.json() as { items?: { id: string; snippet?: { channelId?: string }; status?: { privacyStatus?: string; uploadStatus?: string } }[] };
  const video = body.items?.find((v) => v.id === videoId);
  if (video?.status?.privacyStatus !== "private" || video.snippet?.channelId !== channelId || !["uploaded", "processed"].includes(video.status.uploadStatus ?? "")) {
    throw new Error("YouTube n'a pas confirmé une vidéo privée valide sur la chaîne attendue");
  }
}

export async function publishPrivateDemo(report: Report, actor: PostActor, clipId: string, accountId: string, timeoutMin: number) {
  const account = await testYoutubeAccount(actor, accountId);
  const input = {
    clipId, accountIds: [accountId], scheduledAt: new Date(),
    caption: defaultCaption({ title: "Shrunk — test de publication privée", hashtags: [], credit: DEMO.credit, creditLabel: "Source :" }),
    youtubePrivacy: "private" as const, idempotencyKey: randomUUID(),
  };
  let postId = "";
  const scheduled = await report.run({ id: "youtube-schedule", section: "flow", title: "Démo programmée sur le compte YouTube explicite, en privé", files: PUBLISH_FILES }, async () => {
    const r = await schedulePosts(actor, input);
    if (!r.ok || r.postIds.length !== 1) throw new Error("programmation YouTube refusée");
    postId = r.postIds[0]!;
    report.facts["Publication YouTube"] = postId;
    const again = await schedulePosts(actor, input);
    if (!again.ok || again.postIds.length !== 0) throw new Error("la double soumission a créé une publication supplémentaire");
    const [post] = await db.select().from(scheduledPosts).where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.workspaceId, actor.workspace.id)));
    if (post?.options.privacy !== "private") throw new Error("la programmation n'impose pas la confidentialité privée");
  });
  if (scheduled !== "pass") return;

  await report.run({ id: "youtube-private", section: "flow", title: "Upload YouTube effectué et confidentialité privée confirmée par Google", files: PUBLISH_FILES }, async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMin * 60_000) {
      const [post] = await db.select().from(scheduledPosts).where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.workspaceId, actor.workspace.id)));
      if (!post || post.status === "failed" || post.status === "cancelled") throw new Error("publication échouée ; consulter son état dans l'application avant toute nouvelle tentative");
      if (post.status === "published" && post.externalPostId) {
        const [current] = await db.select().from(socialAccounts).where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, actor.workspace.id)));
        if (!current) throw new Error("compte de test supprimé");
        const tokens = await freshTokens(current);
        await verifyPrivateVideo(post.externalPostId, account.externalId, tokens.accessToken);
        report.facts["Vidéo YouTube (privée)"] = post.externalPostId;
        return { detail: "vidéo conservée en privé sur la chaîne de test ; suppression manuelle après vérification" };
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error("délai YouTube dépassé ; la publication peut encore aboutir, vérifier son état avant de relancer");
  });
}
