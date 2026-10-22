import { and, eq, gte, lt } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { clips, projects, scheduledPosts, socialAccounts } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import { Calendar } from "./calendar";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const { workspace, role } = await requireWorkspace("viewer");
  const t = await getTranslations("calendar");
  const q = await searchParams;
  const view = q.view === "week" ? "week" : "month";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(q.d ?? "") ? q.d! : new Date().toISOString().slice(0, 10);
  // Generous UTC window; the browser groups posts into its own local days.
  const a = new Date(`${anchor}T00:00:00Z`);
  const from = new Date(a.getTime() - (view === "month" ? 45 : 9) * 86_400_000);
  const to = new Date(a.getTime() + (view === "month" ? 45 : 9) * 86_400_000);

  const posts = await db.select({
    id: scheduledPosts.id, at: scheduledPosts.scheduledAt, status: scheduledPosts.status, error: scheduledPosts.error,
    externalPostId: scheduledPosts.externalPostId, platform: socialAccounts.platform, account: socialAccounts.displayName,
    clipTitle: clips.title, clipId: clips.id, projectId: projects.id,
  }).from(scheduledPosts)
    .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId))
    .innerJoin(clips, eq(clips.id, scheduledPosts.clipId))
    .innerJoin(projects, eq(projects.id, clips.projectId))
    .where(and(eq(scheduledPosts.workspaceId, workspace.id), gte(scheduledPosts.scheduledAt, from), lt(scheduledPosts.scheduledAt, to)));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <Calendar view={view} anchor={anchor} canEdit={role !== "viewer"}
        posts={posts.map((p) => ({ ...p, at: p.at.toISOString(), account: p.account ?? "" }))} />
    </div>
  );
}
