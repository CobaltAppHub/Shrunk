import { desc, eq, count } from "drizzle-orm";
import { db } from "@/db";
import { clips, projects } from "@/db/schema";

/** Workspace-scoped projects, with real clip counts. Never fills an empty account with demo data. */
export async function workspaceProjects(workspaceId: string, limit = 60) {
  const rows = await db.select({ id: projects.id, title: projects.title, status: projects.status, createdAt: projects.createdAt, clips: count(clips.id) })
    .from(projects).leftJoin(clips, eq(clips.projectId, projects.id))
    .where(eq(projects.workspaceId, workspaceId)).groupBy(projects.id).orderBy(desc(projects.createdAt)).limit(limit);
  return rows.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));
}
