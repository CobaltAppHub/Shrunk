"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, clips, jobs, projects, sourceAssets } from "@/db/schema";
import { InsufficientCredits, reserve } from "@/lib/credits";
import { editState, validateEdit, type EditState } from "@/lib/edit-state";
import { CREDIT_COSTS } from "@/lib/pricing";
import { requireWorkspace } from "@/lib/workspace";
import { inngest } from "@/inngest/client";

/** The clip, only if it belongs to the caller's workspace. */
async function ownedClip(clipId: string, workspaceId: string) {
  const [row] = await db.select({ clip: clips, durationS: sourceAssets.durationS }).from(clips)
    .innerJoin(projects, eq(projects.id, clips.projectId))
    .innerJoin(sourceAssets, eq(sourceAssets.id, projects.sourceAssetId))
    .where(and(eq(clips.id, z.uuid().parse(clipId)), eq(projects.workspaceId, workspaceId)));
  return row;
}

export async function saveEdit(clipId: string, input: EditState) {
  const { workspace } = await requireWorkspace("editor");
  const row = await ownedClip(clipId, workspace.id);
  if (!row) return { ok: false as const, error: "not_found" as const };
  const state = editState.parse(input);
  const error = validateEdit(state, { durationS: row.durationS ?? 0 });
  if (error) return { ok: false as const, error };
  await db.update(clips).set({ editState: state }).where(eq(clips.id, row.clip.id));
  return { ok: true as const };
}

/** Paid HD render: 1 credit, reserved now, captured only when the file is delivered. */
export async function requestRender(clipId: string, idempotencyKey: string) {
  const { user, workspace } = await requireWorkspace("editor");
  const key = `render:${z.uuid().parse(idempotencyKey)}`;
  const row = await ownedClip(clipId, workspace.id);
  if (!row) return { ok: false as const, error: "not_found" as const };

  const [existing] = await db.select({ id: jobs.id, status: jobs.status, error: jobs.error }).from(jobs).where(eq(jobs.idempotencyKey, key));
  if (existing) return existing.error === "insufficient_credits" ? { ok: false as const, error: "insufficient_credits" as const } : { ok: true as const };
  if (row.clip.status === "rendering") return { ok: false as const, error: "already_rendering" as const };

  const state = editState.safeParse(row.clip.editState);
  if (!state.success) return { ok: false as const, error: "not_saved" as const };
  const invalid = validateEdit(state.data, { durationS: row.durationS ?? 0 });
  if (invalid) return { ok: false as const, error: invalid };

  const cost = CREDIT_COSTS.render_hd;
  const [job] = await db.insert(jobs).values({ workspaceId: workspace.id, type: "render", refId: row.clip.id, idempotencyKey: key, creditCost: cost }).returning();
  try {
    await reserve(db, { workspaceId: workspace.id, jobId: job!.id, cost, reason: "render HD" });
  } catch (e) {
    if (!(e instanceof InsufficientCredits)) throw e;
    await db.update(jobs).set({ status: "failed", error: "insufficient_credits", finishedAt: new Date() }).where(eq(jobs.id, job!.id));
    return { ok: false as const, error: "insufficient_credits" as const };
  }
  await db.update(clips).set({ status: "rendering" }).where(eq(clips.id, row.clip.id));
  await db.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "clip.render", target: row.clip.id, meta: { jobId: job!.id, cost } });
  await inngest.send({ id: job!.id, name: "clip/render.requested", data: { jobId: job!.id, workspaceId: workspace.id } });
  return { ok: true as const };
}
