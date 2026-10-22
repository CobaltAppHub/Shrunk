import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, clips, projects, scheduledPosts, socialAccounts } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { PLANS, type PlanId } from "@/lib/pricing";
import { CAPTION_MAX } from "@/publish/schedule";

export type PostActor = { userId: string; workspace: { id: string; plan: PlanId } };

export const scheduleInput = z.object({
  clipId: z.uuid(),
  accountIds: z.array(z.uuid()).min(1).max(20),
  caption: z.string().min(1).max(5000),
  scheduledAt: z.coerce.date(),
  youtubePrivacy: z.enum(["public", "unlisted", "private"]).default("public"),
  tiktokPrivacyLevel: z.string().max(40).optional(),
  idempotencyKey: z.uuid(),
});

export type ScheduleError = "plan_no_autopublish" | "not_rendered" | "account_unavailable" | "caption_too_long" | "date_invalid";

/** The YouTube upload quota is per Google Cloud project, so every YouTube post shares one queue. */
export const quotaKey = (platform: string, postId: string) => (platform === "youtube" ? "youtube" : postId);

export const sendPublish = (postId: string, scheduledAt: Date, platform: string) =>
  inngest.send({ id: `publish:${postId}:${scheduledAt.toISOString()}`, name: "post/publish.requested", data: { postId, scheduledAt: scheduledAt.toISOString(), quotaKey: quotaKey(platform, postId) } });

export async function schedulePosts(actor: PostActor, input: z.input<typeof scheduleInput>): Promise<{ ok: true; postIds: string[] } | { ok: false; error: ScheduleError }> {
  const v = scheduleInput.parse(input);
  if (!PLANS[actor.workspace.plan].autoPublish) return { ok: false, error: "plan_no_autopublish" };
  const now = Date.now();
  if (v.scheduledAt.getTime() < now - 60_000 || v.scheduledAt.getTime() > now + 365 * 86_400_000) return { ok: false, error: "date_invalid" };

  const [clip] = await db.select({ id: clips.id, renderKey: clips.renderKey }).from(clips)
    .innerJoin(projects, eq(projects.id, clips.projectId))
    .where(and(eq(clips.id, v.clipId), eq(projects.workspaceId, actor.workspace.id)));
  if (!clip?.renderKey) return { ok: false, error: "not_rendered" };

  const accounts = await db.select().from(socialAccounts)
    .where(and(inArray(socialAccounts.id, v.accountIds), eq(socialAccounts.workspaceId, actor.workspace.id), eq(socialAccounts.status, "connected")));
  if (accounts.length !== new Set(v.accountIds).size) return { ok: false, error: "account_unavailable" };
  if (accounts.some((a) => v.caption.length > CAPTION_MAX[a.platform])) return { ok: false, error: "caption_too_long" };

  const rows = await db.insert(scheduledPosts).values(accounts.map((a) => ({
    workspaceId: actor.workspace.id,
    clipId: clip.id,
    socialAccountId: a.id,
    caption: v.caption,
    scheduledAt: v.scheduledAt,
    options: a.platform === "youtube" ? { privacy: v.youtubePrivacy } : a.platform === "tiktok" && v.tiktokPrivacyLevel ? { tiktokPrivacyLevel: v.tiktokPrivacyLevel } : {},
    idempotencyKey: `${v.idempotencyKey}:${a.id}`,
  }))).onConflictDoNothing({ target: scheduledPosts.idempotencyKey }).returning({ id: scheduledPosts.id, accountId: scheduledPosts.socialAccountId });

  // Only freshly inserted rows get an event: a double submit schedules nothing twice.
  for (const r of rows) await sendPublish(r.id, v.scheduledAt, accounts.find((a) => a.id === r.accountId)!.platform);
  if (rows.length) await db.insert(auditLog).values({ workspaceId: actor.workspace.id, actorId: actor.userId, action: "post.schedule", target: clip.id, meta: { posts: rows.map((r) => r.id) } });
  return { ok: true, postIds: rows.map((r) => r.id) };
}

async function ownedPost(actor: PostActor, postId: string) {
  const [row] = await db.select({ post: scheduledPosts, platform: socialAccounts.platform }).from(scheduledPosts)
    .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId))
    .where(and(eq(scheduledPosts.id, z.uuid().parse(postId)), eq(scheduledPosts.workspaceId, actor.workspace.id)));
  return row;
}

/** Moving a post sends a new event; the old sleeping run wakes up, sees the new date and exits. */
export async function reschedulePost(actor: PostActor, postId: string, when: Date) {
  const row = await ownedPost(actor, postId);
  if (!row || row.post.status !== "scheduled") return { ok: false as const, error: "not_editable" as const };
  if (when.getTime() < Date.now() - 60_000) return { ok: false as const, error: "date_invalid" as const };
  await db.update(scheduledPosts).set({ scheduledAt: when }).where(and(eq(scheduledPosts.id, row.post.id), eq(scheduledPosts.status, "scheduled")));
  await sendPublish(row.post.id, when, row.platform);
  return { ok: true as const };
}

export async function cancelPost(actor: PostActor, postId: string) {
  const row = await ownedPost(actor, postId);
  if (!row || row.post.status !== "scheduled") return { ok: false as const, error: "not_editable" as const };
  await db.update(scheduledPosts).set({ status: "cancelled" }).where(and(eq(scheduledPosts.id, row.post.id), eq(scheduledPosts.status, "scheduled")));
  return { ok: true as const };
}

/** Retry only what certainly never reached the platform; an uncertain upload must be checked by hand. */
export async function retryPost(actor: PostActor, postId: string) {
  const row = await ownedPost(actor, postId);
  if (!row || row.post.status !== "failed" || row.post.error === "uncertain_state") return { ok: false as const, error: "not_editable" as const };
  const now = new Date();
  await db.update(scheduledPosts).set({ status: "scheduled", scheduledAt: now, attemptedAt: null, error: null }).where(eq(scheduledPosts.id, row.post.id));
  await sendPublish(row.post.id, now, row.platform);
  return { ok: true as const };
}
