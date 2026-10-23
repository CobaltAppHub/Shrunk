"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clips, projects, sourceAssets } from "@/db/schema";
import { editState, validateEdit, type EditState } from "@/lib/edit-state";
import { requireWorkspace } from "@/lib/workspace";
import { requestClipRender } from "@/lib/renders";
import { scheduleInput, schedulePosts } from "@/lib/posts";

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

/** Paid HD render: shared with the real E2E harness. */
export async function requestRender(clipId: string, idempotencyKey: string) {
  const { user, workspace } = await requireWorkspace("editor");
  return requestClipRender({ userId: user.id, workspace }, clipId, idempotencyKey);
}

export async function schedule(input: z.input<typeof scheduleInput>) {
  const { user, workspace } = await requireWorkspace("editor");
  return schedulePosts({ userId: user.id, workspace }, input);
}
