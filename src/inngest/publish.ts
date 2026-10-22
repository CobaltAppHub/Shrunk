import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { NonRetriableError, RetryAfterError } from "inngest";
import { db } from "@/db";
import { clips, scheduledPosts, socialAccounts } from "@/db/schema";
import { env } from "@/lib/env";
import { headSize, readRange, signedGetUrl } from "@/lib/storage";
import { emailWorkspaceOwner } from "@/lib/stripe";
import { freshTokens, markExpired, providers, tiktokDraftMode } from "@/publish";
import { instagramNextSlot, youtubeQuotaWindow } from "@/publish/schedule";
import { PublishError, type PublishOutcome } from "@/publish/types";
import { inngest } from "./client";

type Post = typeof scheduledPosts.$inferSelect;
const setPost = (id: string, v: Partial<Post>) => db.update(scheduledPosts).set(v).where(eq(scheduledPosts.id, id));

async function persist(postId: string, o: PublishOutcome) {
  if (o.status === "published") await setPost(postId, { status: "published", externalPostId: o.externalPostId, publishedAt: new Date(), error: null });
  else if (o.status === "draft_sent") await setPost(postId, { status: "draft_sent", externalPostId: o.externalPostId ?? null, publishedAt: new Date(), error: null });
}

export const publishPost = inngest.createFunction(
  {
    id: "publish-post",
    triggers: [{ event: "post/publish.requested" }],
    retries: 4,
    // One YouTube upload at a time (shared project quota); other posts run in parallel.
    concurrency: [{ key: "event.data.quotaKey", limit: 1 }],
    onFailure: async ({ event, error }) => {
      const { postId } = event.data.event.data as { postId: string };
      await db.update(scheduledPosts).set({ status: "failed", error: error.message.slice(0, 300) })
        .where(and(eq(scheduledPosts.id, postId), inArray(scheduledPosts.status, ["scheduled", "publishing"])));
    },
  },
  async ({ event, step }) => {
    const { postId, scheduledAt } = event.data as { postId: string; scheduledAt: string };
    await step.sleepUntil("until-scheduled", new Date(scheduledAt));

    const ctx = await step.run("claim", async () => {
      const [row] = await db.select({ post: scheduledPosts, account: socialAccounts, renderKey: clips.renderKey }).from(scheduledPosts)
        .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId))
        .innerJoin(clips, eq(clips.id, scheduledPosts.clipId))
        .where(eq(scheduledPosts.id, postId));
      // Rescheduled (newer event), cancelled or already done: this run is stale.
      if (!row || row.post.status !== "scheduled" || row.post.scheduledAt.toISOString() !== scheduledAt) return null;
      // A previous attempt may have reached the platform: never upload blindly a second time.
      if (row.post.attemptedAt) {
        await setPost(postId, { status: "failed", error: "uncertain_state" });
        return null;
      }
      if (row.account.status !== "connected") {
        await setPost(postId, { status: "failed", error: "account_disconnected" });
        return null;
      }
      if (!row.renderKey) {
        await setPost(postId, { status: "failed", error: "not_rendered" });
        return null;
      }
      return { platform: row.account.platform, accountId: row.account.id, workspaceId: row.post.workspaceId };
    });
    if (!ctx) return { skipped: true };

    // Platform limits enforced before calling, so the queue waits instead of failing.
    const waitUntil = await step.run("quota-gate", async () => {
      const now = new Date();
      if (ctx.platform === "youtube") {
        const w = youtubeQuotaWindow(now);
        const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(scheduledPosts)
          .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId))
          .where(and(eq(socialAccounts.platform, "youtube"), gte(scheduledPosts.attemptedAt, w.start)));
        return (used?.n ?? 0) >= env.YOUTUBE_DAILY_UPLOADS ? w.reset.toISOString() : null;
      }
      const recent = await db.select({ at: scheduledPosts.publishedAt }).from(scheduledPosts)
        .where(and(eq(scheduledPosts.socialAccountId, ctx.accountId), isNotNull(scheduledPosts.publishedAt), gte(scheduledPosts.publishedAt, new Date(now.getTime() - 86_400_000))));
      const dates = recent.map((r) => r.at!);
      // Instagram: 100 posts / 24 h. TikTok inbox: 5 pending shares / 24 h (we count what we sent).
      const limit = ctx.platform === "instagram" ? 100 : tiktokDraftMode() ? 5 : Infinity;
      return instagramNextSlot(dates, now, limit)?.toISOString() ?? null;
    });
    if (waitUntil) {
      await step.run("note-wait", () => setPost(postId, { error: "quota_wait" }));
      await step.sleepUntil("quota-reset", new Date(new Date(waitUntil).getTime() + 60_000));
    }

    const first = await step.run("publish", async (): Promise<PublishOutcome> => {
      const [row] = await db.select({ post: scheduledPosts, account: socialAccounts, renderKey: clips.renderKey, title: clips.title }).from(scheduledPosts)
        .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId))
        .innerJoin(clips, eq(clips.id, scheduledPosts.clipId))
        .where(eq(scheduledPosts.id, postId));
      if (!row || row.post.status !== "scheduled" || row.post.attemptedAt) throw new NonRetriableError("post_changed");
      const key = row.renderKey!;
      const bytes = await headSize(key);
      if (!bytes) throw new NonRetriableError("render_missing");
      let tokens;
      try {
        tokens = await freshTokens(row.account);
      } catch (e) {
        return handle(e, row.post, row.account.id, ctx.workspaceId, false);
      }
      await setPost(postId, { status: "publishing", attemptedAt: new Date(), error: null });
      try {
        const out = await providers[row.account.platform].publish({
          accountExternalId: row.account.externalId,
          video: { bytes, readRange: (s, e) => readRange(key, s, e), signedUrl: () => signedGetUrl(key, 2 * 3600) },
          title: row.title ?? row.post.caption.split("\n")[0]!.slice(0, 100),
          caption: row.post.caption,
          aiGenerated: row.post.aiGenerated,
          options: row.post.options,
        }, tokens);
        if (out.status === "processing") await setPost(postId, { options: { ...row.post.options, pollRef: out.pollRef } });
        else await persist(postId, out);
        return out;
      } catch (e) {
        return handle(e, row.post, row.account.id, ctx.workspaceId, true);
      }
    });

    // TikTok and Instagram process asynchronously: poll for up to ~10 minutes.
    if (first.status === "processing") {
      for (let i = 0; i < 10; i++) {
        await step.sleep(`poll-wait-${i}`, "60s");
        const out = await step.run(`poll-${i}`, async (): Promise<PublishOutcome | { status: "failed" }> => {
          const [row] = await db.select({ post: scheduledPosts, account: socialAccounts }).from(scheduledPosts)
            .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId)).where(eq(scheduledPosts.id, postId));
          try {
            const o = await providers[row!.account.platform].checkStatus(first.pollRef, await freshTokens(row!.account));
            await persist(postId, o);
            return o;
          } catch (e) {
            if (e instanceof PublishError && e.code === "rejected") {
              await setPost(postId, { status: "failed", error: e.detail.slice(0, 300) });
              return { status: "failed" };
            }
            return first; // transient: keep polling
          }
        });
        if (out.status !== "processing") return out;
      }
      await setPost(postId, { status: "failed", error: "platform_timeout" });
    }
    return first;
  },
);

/** Error policy: retry what never reached the platform, never what might have. */
async function handle(e: unknown, post: Post, accountId: string, workspaceId: string, attempted: boolean): Promise<never> {
  if (!(e instanceof PublishError)) throw e; // crash: attemptedAt stays set → "uncertain_state" on retry, never a blind re-upload
  const retryable = e.code === "rate_limited" || e.code === "temporary" || e.code === "quota_exceeded";
  if (retryable) {
    // The platform refused before creating anything: safe to go again.
    if (attempted) await setPost(post.id, { status: "scheduled", attemptedAt: null, error: e.code });
    throw new RetryAfterError(e.code, e.code === "quota_exceeded" ? "1h" : `${e.retryAfterS ?? 120}s`);
  }
  if (e.code === "auth_expired") {
    await markExpired(accountId, e.detail || e.message);
    await setPost(post.id, { status: "failed", error: "account_disconnected" });
    const [a] = await db.select({ platform: socialAccounts.platform, name: socialAccounts.displayName }).from(socialAccounts).where(eq(socialAccounts.id, accountId));
    await emailWorkspaceOwner(db, workspaceId, "accountDisconnected", { platform: a?.platform ?? "", account: a?.name ?? "" });
    throw new NonRetriableError("account_disconnected");
  }
  await setPost(post.id, { status: "failed", error: e.detail.slice(0, 300) || "rejected" });
  throw new NonRetriableError("rejected");
}

/** Every 6 h: refresh tokens close to expiry; a refusal marks the account disconnected and alerts the owner. */
export const refreshSocialTokens = inngest.createFunction(
  { id: "refresh-social-tokens", triggers: [{ cron: "15 */6 * * *" }] },
  async ({ step }) => {
    const soon = await step.run("list", async () => (await db.select({ id: socialAccounts.id, platform: socialAccounts.platform }).from(socialAccounts)
      .where(and(eq(socialAccounts.status, "connected"), isNotNull(socialAccounts.expiresAt), lt(socialAccounts.expiresAt, new Date(Date.now() + 7 * 86_400_000))))));
    let expired = 0;
    for (const s of soon) {
      expired += await step.run(`refresh-${s.id}`, async () => {
        const [a] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, s.id));
        // Instagram long-lived tokens: refresh in the last week; others: in the last 2 hours.
        const margin = a!.platform === "instagram" ? 7 * 86_400_000 : 2 * 3_600_000;
        try {
          await freshTokens(a!, margin);
          return 0;
        } catch (e) {
          if (!(e instanceof PublishError && e.code === "auth_expired")) return 0; // transient: next run
          await emailWorkspaceOwner(db, a!.workspaceId, "accountDisconnected", { platform: a!.platform, account: a!.displayName ?? "" });
          return 1;
        }
      });
    }
    return { checked: soon.length, expired };
  },
);
