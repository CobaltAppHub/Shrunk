import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, clips, jobs, projects, sourceAssets } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { InsufficientCredits, reserve } from "./credits";
import { editState, validateEdit } from "./edit-state";
import { CREDIT_COSTS } from "./pricing";

export type RenderActor = { userId: string; workspace: { id: string } };

/** Same paid-render request for the editor and the E2E harness. */
export async function requestClipRender(actor: RenderActor, clipId: string, idempotencyKey: string) {
  const id = z.uuid().parse(clipId);
  const key = `render:${z.uuid().parse(idempotencyKey)}`;
  let result;
  try {
    result = await db.transaction(async (tx) => {
      // Lock the owned clip: concurrent requests with different keys cannot both charge it.
      const [row] = await tx.select({ clip: clips, durationS: sourceAssets.durationS }).from(clips)
        .innerJoin(projects, eq(projects.id, clips.projectId))
        .innerJoin(sourceAssets, eq(sourceAssets.id, projects.sourceAssetId))
        .where(and(eq(clips.id, id), eq(projects.workspaceId, actor.workspace.id)))
        .for("update", { of: clips });
      if (!row) return { ok: false as const, error: "not_found" as const };

      const [existing] = await tx.select().from(jobs).where(and(eq(jobs.idempotencyKey, key), eq(jobs.workspaceId, actor.workspace.id)));
      if (existing) {
        if (existing.workspaceId !== actor.workspace.id || existing.refId !== id || existing.type !== "render") {
          return { ok: false as const, error: "not_found" as const };
        }
        if (existing.error === "insufficient_credits") return { ok: false as const, error: "insufficient_credits" as const };
        return { ok: true as const, jobId: existing.id, queued: existing.status === "queued" };
      }
      if (row.clip.status === "rendering") return { ok: false as const, error: "already_rendering" as const };
      const state = editState.safeParse(row.clip.editState);
      if (!state.success) return { ok: false as const, error: "not_saved" as const };
      const invalid = validateEdit(state.data, { durationS: row.durationS ?? 0 });
      if (invalid) return { ok: false as const, error: invalid };

      const [job] = await tx.insert(jobs).values({
        workspaceId: actor.workspace.id, type: "render", refId: id, idempotencyKey: key, creditCost: CREDIT_COSTS.render_hd,
      }).onConflictDoNothing({ target: jobs.idempotencyKey }).returning();
      if (!job) return { ok: false as const, error: "not_found" as const };
      await reserve(tx, { workspaceId: actor.workspace.id, jobId: job.id, cost: job.creditCost, reason: "render HD" });
      await tx.update(clips).set({ status: "rendering" }).where(eq(clips.id, id));
      await tx.insert(auditLog).values({ workspaceId: actor.workspace.id, actorId: actor.userId, action: "clip.render", target: id, meta: { jobId: job.id, cost: job.creditCost } });
      return { ok: true as const, jobId: job.id, queued: true };
    });
  } catch (e) {
    if (e instanceof InsufficientCredits) return { ok: false as const, error: "insufficient_credits" as const };
    throw e;
  }

  // A failed event send can be retried with the same key, without reserving again.
  // Inngest deduplicates these sends by job id, including simultaneous replays.
  if (result.ok && result.queued) {
    await inngest.send({ id: result.jobId, name: "clip/render.requested", data: { jobId: result.jobId, workspaceId: actor.workspace.id } });
  }
  if (!result.ok) return result;
  return { ok: true as const, jobId: result.jobId };
}
