import { eq, or, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { db } from "@/db";
import { jobs, projects, sourceAssets, workspaces } from "@/db/schema";
import { expireDue, grant, releaseTimedOut } from "@/lib/credits";
import { env } from "@/lib/env";
import { JOB_TIMEOUT_MS, PLANS, grantExpiry } from "@/lib/pricing";
import { decrypt } from "@/lib/secrets";
import { sourceKey } from "@/lib/storage";
import { emailWorkspaceOwner } from "@/lib/stripe";
import { providerById } from "@/sources";
import { inngest } from "./client";

const MAX_SOURCE_BYTES = 4 * 1024 ** 3;

async function failIngest(jobId: string, code: string) {
  const [job] = await db.update(jobs).set({ status: "failed", error: code, finishedAt: new Date() }).where(eq(jobs.id, jobId)).returning();
  if (!job) return;
  // The project is kept (status failed) so the user can attach the file instead.
  await db.update(sourceAssets).set({ importStatus: "failed", importErrorCode: code }).where(eq(sourceAssets.id, job.refId));
  await db.update(projects).set({ status: "failed" }).where(eq(projects.sourceAssetId, job.refId));
}

export const ingestSource = inngest.createFunction(
  {
    id: "ingest-source",
    triggers: [{ event: "source/ingest.requested" }],
    retries: 2,
    // Download limits: 2 per workspace, 20 overall.
    concurrency: [{ key: "event.data.workspaceId", limit: 2 }, { limit: 20 }],
    onFailure: async ({ event }) => {
      const e = event.data.error as { message?: string };
      await failIngest(event.data.event.data.jobId, e?.message ?? "retrieval_failed");
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string; workspaceId: string };

    const ctx = await step.run("claim", async () => {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (!job || job.type !== "ingest") throw new NonRetriableError("job_not_found");
      if (job.status === "succeeded") return null; // replayed event: nothing to do
      const [asset] = await db.select().from(sourceAssets).where(eq(sourceAssets.id, job.refId));
      if (!asset?.originalUrlEnc || !asset.importProvider) throw new NonRetriableError("retrieval_failed");
      await db.update(jobs).set({ status: "running", startedAt: new Date(), attempts: sql`${jobs.attempts} + 1` }).where(eq(jobs.id, jobId));
      await db.update(sourceAssets).set({ importStatus: "importing" }).where(eq(sourceAssets.id, asset.id));
      return { assetId: asset.id, workspaceId: asset.workspaceId, provider: asset.importProvider };
    });
    if (!ctx) return { skipped: true };

    const result = await step.run("transfer", async () => {
      const provider = providerById(ctx.provider);
      if (!provider) throw new NonRetriableError("unsupported_source");
      const [asset] = await db.select({ u: sourceAssets.originalUrlEnc }).from(sourceAssets).where(eq(sourceAssets.id, ctx.assetId));
      // The URL is decrypted only here, inside the worker step, and never logged.
      const url = new URL(decrypt(asset!.u!, env.DATA_ENCRYPTION_KEY));
      try {
        return await provider.ingest(url, { key: sourceKey(ctx.workspaceId, ctx.assetId), maxBytes: MAX_SOURCE_BYTES }, {});
      } catch (e) {
        const err = provider.normalizeError(e);
        if (err.permanent) throw new NonRetriableError(err.code);
        throw new Error(err.code);
      }
    });

    await step.run("record", async () => {
      await db.update(sourceAssets).set({
        importStatus: "imported",
        importedBytes: result.bytes,
        contentHash: result.sha256,
        storageKey: sourceKey(ctx.workspaceId, ctx.assetId),
        purgeAfter: new Date(Date.now() + 30 * 86_400_000),
      }).where(eq(sourceAssets.id, ctx.assetId));
      await db.update(jobs).set({ status: "succeeded", finishedAt: new Date(), progress: 1 }).where(eq(jobs.id, jobId));
      await db.update(projects).set({ status: "analyzing" }).where(eq(projects.sourceAssetId, ctx.assetId));
    });

    // Next stage (J2): ffprobe duration/size check + transcription on the GPU worker, in its sandbox.
    await step.sendEvent("analyze", { name: "source/analyze.requested", data: { assetId: ctx.assetId, workspaceId: ctx.workspaceId }, id: `analyze:${ctx.assetId}` });
    return result;
  },
);

/** Jobs running > 15 min are failed and their reserved credits returned, with an email. */
export const releaseStuckJobs = inngest.createFunction(
  { id: "release-stuck-jobs", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const released = await step.run("release", () => releaseTimedOut(db, new Date(Date.now() - JOB_TIMEOUT_MS)));
    for (const jobId of released) {
      await step.run(`email-${jobId}`, async () => {
        const [j] = await db.select({ ws: jobs.workspaceId }).from(jobs).where(eq(jobs.id, jobId));
        if (j) await emailWorkspaceOwner(db, j.ws, "creditsReturned");
      });
    }
    return { released: released.length };
  },
);

/** Monthly grants for free and annual workspaces (monthly subscribers get theirs on invoice.paid, same key). */
export const monthlyGrants = inngest.createFunction(
  { id: "monthly-grants", triggers: [{ cron: "TZ=Europe/Paris 5 0 1 * *" }] },
  async ({ step }) => {
    const ws = await step.run("list", () =>
      db.select({ id: workspaces.id, plan: workspaces.plan }).from(workspaces)
        .where(or(eq(workspaces.plan, "free"), eq(workspaces.billingInterval, "year"))));
    await step.run("grant", async () => {
      const now = new Date();
      for (const w of ws) {
        await grant(db, { workspaceId: w.id, amount: PLANS[w.plan].monthlyCredits, key: `${w.plan === "free" ? "free" : "plan"}:${w.id}:${now.toISOString().slice(0, 7)}`, reason: `${w.plan} monthly credits`, expiresAt: grantExpiry(now) });
      }
    });
  },
);

export const expireCredits = inngest.createFunction(
  { id: "expire-credits", triggers: [{ cron: "TZ=Europe/Paris 15 0 1 * *" }] },
  async ({ step }) => {
    const ids = await step.run("list", async () => (await db.select({ id: workspaces.id }).from(workspaces)).map((w) => w.id));
    // ponytail: one step for all workspaces; fan out per workspace past ~10k workspaces.
    await step.run("expire", async () => { for (const id of ids) await expireDue(db, id); });
  },
);

export const functions = [ingestSource, releaseStuckJobs, monthlyGrants, expireCredits];
