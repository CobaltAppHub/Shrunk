import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { db } from "@/db";
import { clips, jobs, projects, sourceAssets, workspaces } from "@/db/schema";
import { selectClips, type Transcript } from "@/lib/clip-selection";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/pricing";
import { getJson, previewKey, signedGetUrl, signedPutUrl, transcriptKey, visionKey } from "@/lib/storage";
import { submitWorkerJob, workerJobKey } from "@/lib/worker";
import { inngest } from "./client";

const MAX_DURATION_S = 3 * 3600;
type Stage = "transcribe" | "select" | "preview";

const setProject = (assetId: string, v: Partial<typeof projects.$inferInsert>) =>
  db.update(projects).set(v).where(eq(projects.sourceAssetId, assetId));

/** One worker sub-job per (kind, asset): created once, dispatched once, settled by the callback route. */
async function ensureJob(workspaceId: string, assetId: string, kind: "transcribe" | "previews" | "vision") {
  const key = workerJobKey(kind, assetId);
  await db.insert(jobs).values({ workspaceId, refId: assetId, type: kind === "previews" ? "preview" : kind, idempotencyKey: key })
    .onConflictDoNothing({ target: jobs.idempotencyKey });
  const [job] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, key));
  return job!;
}

export const analyzeSource = inngest.createFunction(
  {
    id: "analyze-source",
    triggers: [{ event: "source/analyze.requested" }],
    retries: 2,
    concurrency: [{ key: "event.data.workspaceId", limit: 2 }, { limit: 10 }],
    onFailure: async ({ event, error }) => {
      const { assetId } = event.data.event.data as { assetId: string };
      await setProject(assetId, { status: "failed", errorCode: error.message.slice(0, 64) || "worker_failed" });
    },
  },
  async ({ event, step }) => {
    const { assetId, workspaceId } = event.data as { assetId: string; workspaceId: string };

    // Polls the DB (source of truth); the callback's event only shortens the wait.
    const awaitWorker = async (kind: "transcribe" | "previews" | "vision", hours: number) => {
      const key = workerJobKey(kind, assetId);
      for (let i = 0; i < hours * 6; i++) {
        const job = await step.run(`${kind}-check-${i}`, async () => {
          const [j] = await db.select({ status: jobs.status, error: jobs.error, result: jobs.result }).from(jobs).where(eq(jobs.idempotencyKey, key));
          return j!;
        });
        if (job.status === "succeeded" || job.status === "failed") return job;
        await step.waitForEvent(`${kind}-wait-${i}`, { event: "worker/done", if: `async.data.key == "${key}"`, timeout: "10m" });
      }
      throw new NonRetriableError("provider_unavailable");
    };
    const stage = (s: Stage) => step.run(`stage-${s}`, () => setProject(assetId, { status: "analyzing", stage: s, errorCode: null }));

    // 1. Transcription (GPU worker: ffprobe limits, audio extraction, WhisperX).
    await stage("transcribe");
    await step.run("dispatch-transcribe", async () => {
      const [asset] = await db.select().from(sourceAssets).where(and(eq(sourceAssets.id, assetId), eq(sourceAssets.workspaceId, workspaceId)));
      if (!asset?.storageKey) throw new NonRetriableError("retrieval_failed");
      const job = await ensureJob(workspaceId, assetId, "transcribe");
      if (job.status !== "queued") return; // already dispatched (retry of this step)

      const [ws] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId));
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const [used] = await db.select({ s: sql<number>`coalesce(sum(${sourceAssets.durationS}), 0)::float` }).from(sourceAssets)
        .where(and(eq(sourceAssets.workspaceId, workspaceId), ne(sourceAssets.id, assetId), isNotNull(sourceAssets.language), gte(sourceAssets.createdAt, monthStart)));
      const quotaRemaining = PLANS[ws!.plan].monthlyAnalysisMinutes * 60 - (used?.s ?? 0);
      if (quotaRemaining <= 0) throw new NonRetriableError("quota_reached");

      await db.update(jobs).set({ status: "running", startedAt: new Date(), attempts: 1 }).where(eq(jobs.id, job.id));
      await submitWorkerJob(env.WORKER_URL, env.WORKER_TOKEN, {
        kind: "transcribe",
        ref: assetId,
        source_url: await signedGetUrl(asset.storageKey, 4 * 3600),
        transcript_put_url: await signedPutUrl(transcriptKey(workspaceId, assetId), "application/json", 4 * 3600),
        max_duration_s: MAX_DURATION_S,
        quota_remaining_s: quotaRemaining,
      });
    });
    const transcribed = await awaitWorker("transcribe", 4);
    if (transcribed.status === "failed") throw new NonRetriableError(transcribed.error ?? "worker_failed");

    await step.run("store-transcript", async () => {
      const r = transcribed.result as { duration_s: number; language: string };
      const transcript = await getJson<Transcript>(transcriptKey(workspaceId, assetId));
      await db.update(sourceAssets).set({ transcript, durationS: r.duration_s, language: r.language }).where(eq(sourceAssets.id, assetId));
    });

    // 2a. Scenes, faces and audio peaks (CPU worker), running while Claude selects moments.
    await step.run("dispatch-vision", async () => {
      const job = await ensureJob(workspaceId, assetId, "vision");
      if (job.status !== "queued") return;
      const [asset] = await db.select({ key: sourceAssets.storageKey }).from(sourceAssets).where(eq(sourceAssets.id, assetId));
      await db.update(jobs).set({ status: "running", startedAt: new Date(), attempts: 1 }).where(eq(jobs.id, job.id));
      await submitWorkerJob(env.WORKER_URL, env.WORKER_TOKEN, {
        kind: "vision",
        ref: assetId,
        source_url: await signedGetUrl(asset!.key!, 4 * 3600),
        vision_put_url: await signedPutUrl(visionKey(workspaceId, assetId), "application/json", 4 * 3600),
      });
    });

    // 2b. Moment selection (Claude, structured output validated by Zod).
    await stage("select");
    const selected = await step.run("select", async () => {
      const [asset] = await db.select({ transcript: sourceAssets.transcript }).from(sourceAssets).where(eq(sourceAssets.id, assetId));
      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.sourceAssetId, assetId));
      const { candidates, costUsd } = await selectClips(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), asset!.transcript as Transcript);
      await db.transaction(async (tx) => {
        await tx.delete(clips).where(and(eq(clips.projectId, project!.id), eq(clips.status, "candidate"))); // retry-safe
        if (candidates.length) await tx.insert(clips).values(candidates.map((c) => ({ projectId: project!.id, ...c })));
        await tx.insert(jobs).values({ workspaceId, refId: assetId, type: "analyze", idempotencyKey: `select:${assetId}`, status: "succeeded", costUsd: String(costUsd), finishedAt: new Date() })
          .onConflictDoNothing({ target: jobs.idempotencyKey });
      });
      return { projectId: project!.id, count: candidates.length };
    });

    // Vision only improves framing: if it fails, renders fall back to a centred crop and say so.
    const vision = await awaitWorker("vision", 3);
    await step.run("store-vision", async () => {
      if (vision.status !== "succeeded") return;
      await db.update(sourceAssets).set({ vision: await getJson(visionKey(workspaceId, assetId)) }).where(eq(sourceAssets.id, assetId));
    });

    // No candidate is a real outcome: the project is ready and says so; nothing is invented.
    if (selected.count === 0) {
      await step.run("done-empty", () => setProject(assetId, { status: "ready", stage: null }));
      return { clips: 0 };
    }

    // 3. Free 480p previews (CPU worker).
    await stage("preview");
    await step.run("dispatch-previews", async () => {
      const job = await ensureJob(workspaceId, assetId, "previews");
      if (job.status !== "queued") return;
      const [asset] = await db.select({ key: sourceAssets.storageKey }).from(sourceAssets).where(eq(sourceAssets.id, assetId));
      const rows = await db.select({ id: clips.id, startS: clips.startS, endS: clips.endS }).from(clips).where(eq(clips.projectId, selected.projectId));
      await db.update(jobs).set({ status: "running", startedAt: new Date(), attempts: 1 }).where(eq(jobs.id, job.id));
      await submitWorkerJob(env.WORKER_URL, env.WORKER_TOKEN, {
        kind: "previews",
        ref: assetId,
        source_url: await signedGetUrl(asset!.key!, 2 * 3600),
        clips: await Promise.all(rows.map(async (c) => ({ id: c.id, start: c.startS, end: c.endS, put_url: await signedPutUrl(previewKey(workspaceId, c.id), "video/mp4", 2 * 3600) }))),
      });
    });
    const previews = await awaitWorker("previews", 1);

    await step.run("finish", async () => {
      const done = (previews.result as { done?: string[] } | null)?.done ?? [];
      for (const id of done) await db.update(clips).set({ previewKey: previewKey(workspaceId, id) }).where(eq(clips.id, id));
      // A clip without preview stays selectable; the UI says the preview is unavailable.
      await setProject(assetId, { status: "ready", stage: null });
    });
    return { clips: selected.count };
  },
);
