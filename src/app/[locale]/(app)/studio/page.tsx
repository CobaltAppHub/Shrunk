import { and, count, eq, gte, lt } from "drizzle-orm";
import { StudioView } from "@/components/studio-view";
import { db } from "@/db";
import { clips, projects, scheduledPosts, socialAccounts, sourceAssets } from "@/db/schema";
import { getBalance } from "@/lib/credits";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export default async function StudioPage() {
  const { workspace, role } = await requireWorkspace("viewer");
  const [projectRows, clipRows, postRows, accountRows, balance] = await Promise.all([
    db.select({ id: projects.id, title: projects.title, status: projects.status, createdAt: projects.createdAt, clips: count(clips.id), durationS: sourceAssets.durationS, stage: projects.stage }).from(projects).leftJoin(clips, eq(clips.projectId, projects.id)).leftJoin(sourceAssets, eq(sourceAssets.id, projects.sourceAssetId)).where(eq(projects.workspaceId, workspace.id)).groupBy(projects.id, sourceAssets.durationS).orderBy(projects.createdAt).limit(120),
    db.select({ id: clips.id, projectId: clips.projectId, title: clips.title, startS: clips.startS, endS: clips.endS, score: clips.score }).from(clips).innerJoin(projects, eq(projects.id, clips.projectId)).where(eq(projects.workspaceId, workspace.id)).limit(300),
    db.select({ id: scheduledPosts.id, at: scheduledPosts.scheduledAt, status: scheduledPosts.status, platform: socialAccounts.platform, clipTitle: clips.title, clipId: clips.id, projectId: projects.id }).from(scheduledPosts).innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId)).innerJoin(clips, eq(clips.id, scheduledPosts.clipId)).innerJoin(projects, eq(projects.id, clips.projectId)).where(and(eq(scheduledPosts.workspaceId, workspace.id), gte(scheduledPosts.scheduledAt, new Date()), lt(scheduledPosts.scheduledAt, new Date(Date.now() + 7 * 86400000)))),
    db.select({ platform: socialAccounts.platform, status: socialAccounts.status, displayName: socialAccounts.displayName }).from(socialAccounts).where(eq(socialAccounts.workspaceId, workspace.id)),
    getBalance(db, workspace.id),
  ]);
  const projectMap = new Map<string, (typeof projectRows)[number]>();
  for (const row of projectRows) { const current = projectMap.get(row.id); if (!current) projectMap.set(row.id, row); else if (row.clips) projectMap.set(row.id, { ...current, clips: row.clips }); }
  return <StudioView projects={[...projectMap.values()].map((p) => ({ ...p, clips: p.clips ? 1 : 0, createdAt: p.createdAt.toISOString() }))} clips={clipRows} posts={postRows.map((p) => ({ ...p, at: p.at.toISOString() }))} accounts={accountRows} balance={balance} canEdit={role !== "viewer"} />;
}
