import { eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { db } from "@/db";
import { clips, jobs, projects, sourceAssets, workspaces } from "@/db/schema";
import { settle } from "@/lib/credits";
import { editState, renderPayload } from "@/lib/edit-state";
import { env } from "@/lib/env";
import { headSize, renderKey, signedGetUrl, signedPutUrl } from "@/lib/storage";
import { emailWorkspaceOwner } from "@/lib/stripe";
import { submitWorkerJob } from "@/lib/worker";
import { inngest } from "./client";

/**
 * Paid render. Credits were reserved by the server action before this runs.
 * Capture happens only once the file is verified in R2; anything else releases the reservation.
 * The 15-minute sweeper (releaseStuckJobs) releases it too if this function never finishes.
 */
export const renderClip = inngest.createFunction(
  {
    id: "render-clip",
    triggers: [{ event: "clip/render.requested" }],
    retries: 1,
    concurrency: [{ key: "event.data.workspaceId", limit: 2 }, { limit: 20 }],
    onFailure: async ({ event }) => {
      const { jobId } = event.data.event.data as { jobId: string };
      await finish(jobId, false);
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string; workspaceId: string };

    const ctx = await step.run("dispatch", async () => {
      const [row] = await db.select({ job: jobs, clip: clips, asset: sourceAssets, plan: workspaces.plan })
        .from(jobs)
        .innerJoin(clips, eq(clips.id, jobs.refId))
        .innerJoin(projects, eq(projects.id, clips.projectId))
        .innerJoin(sourceAssets, eq(sourceAssets.id, projects.sourceAssetId))
        .innerJoin(workspaces, eq(workspaces.id, jobs.workspaceId))
        .where(eq(jobs.id, jobId));
      if (!row || row.job.type !== "render") throw new NonRetriableError("job_not_found");
      if (row.job.status !== "queued") return { key: renderKey(row.job.workspaceId, row.clip.id, jobId) };
      const state = editState.parse(row.clip.editState);
      const key = renderKey(row.job.workspaceId, row.clip.id, jobId);
      await db.update(jobs).set({ status: "running", startedAt: new Date(), attempts: 1 }).where(eq(jobs.id, jobId));
      await submitWorkerJob(env.WORKER_URL, env.WORKER_TOKEN, {
        kind: "render",
        ref: jobId,
        source_url: await signedGetUrl(row.asset.storageKey!, 3600),
        render_put_url: await signedPutUrl(key, "video/mp4", 3600),
        ...renderPayload(state, row.asset.vision as Parameters<typeof renderPayload>[1], row.plan),
      });
      return { key };
    });

    // Up to 15 min, the same limit as the credit sweeper. The DB is the source of truth.
    for (let i = 0; i < 4; i++) {
      const status = await step.run(`check-${i}`, async () => (await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, jobId)))[0]!.s);
      if (status === "succeeded" || status === "failed") break;
      await step.waitForEvent(`wait-${i}`, { event: "worker/done", if: `async.data.key == "job:${jobId}"`, timeout: "5m" });
    }

    return step.run("settle", async () => {
      const [job] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
      const delivered = job!.status === "succeeded" && ((await headSize(ctx.key)) ?? 0) > 0;
      await finish(jobId, delivered, ctx.key);
      return { delivered };
    });
  },
);

async function finish(jobId: string, delivered: boolean, key?: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return;
  if (delivered && key) {
    await settle(db, jobId, "capture");
    await db.update(clips).set({ status: "rendered", renderKey: key }).where(eq(clips.id, job.refId));
    return;
  }
  if (job.status === "running" || job.status === "queued") {
    await db.update(jobs).set({ status: "failed", error: job.error ?? "render_failed", finishedAt: new Date() }).where(eq(jobs.id, jobId));
  }
  await db.update(clips).set({ status: "failed" }).where(eq(clips.id, job.refId));
  if (await settle(db, jobId, "release")) await emailWorkspaceOwner(db, job.workspaceId, "creditsReturned");
}
