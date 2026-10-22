"use server";

import { and, count, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, jobs, projects, sourceAssets } from "@/db/schema";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/pricing";
import { encrypt } from "@/lib/secrets";
import { headSize, signedPutUrl, sourceKey } from "@/lib/storage";
import { requireWorkspace } from "@/lib/workspace";
import { inngest } from "@/inngest/client";
import { ImportError, type ImportErrorCode } from "@/sources/errors";
import { providerFor } from "@/sources";
import { validateUrl } from "@/sources/safe-fetch";
import type { Inspection } from "@/sources/types";

const INSPECTIONS_PER_MINUTE = 10;
const startOfMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

async function inspect(raw: string): Promise<Inspection> {
  const url = validateUrl(raw.trim());
  return providerFor(url).inspect(url, { signal: AbortSignal.timeout(20_000) });
}

/** Free; rate-limited. Never returns the raw URL back (it may carry a token). */
export async function inspectLink(raw: string): Promise<Inspection | { status: "error"; errorCode: ImportErrorCode }> {
  const { user, workspace } = await requireWorkspace("editor");
  const [recent] = await db.select({ n: count() }).from(auditLog)
    .where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, "source.inspect"), gte(auditLog.createdAt, sql`now() - interval '1 minute'`)));
  if ((recent?.n ?? 0) >= INSPECTIONS_PER_MINUTE) return { status: "error", errorCode: "quota_reached" };
  await db.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "source.inspect" });
  try {
    return await inspect(z.string().max(4096).parse(raw));
  } catch (e) {
    return { status: "error", errorCode: e instanceof ImportError ? e.code : "invalid_link" };
  }
}

const startInput = z.object({
  url: z.string().max(4096),
  rightsBasis: z.enum(["own", "authorized", "licensed"]),
  attested: z.literal(true), // the rights checkbox; required before any transfer
  licenseReference: z.string().max(500).optional(),
  creditLine: z.string().max(300).optional(),
  idempotencyKey: z.uuid(), // generated once per form: double clicks map to one job
}).refine((v) => v.rightsBasis !== "licensed" || !!v.licenseReference, { path: ["licenseReference"] });

export async function startImport(input: z.input<typeof startInput>) {
  const { user, workspace } = await requireWorkspace("editor");
  const v = startInput.parse(input);

  const [existing] = await db.select({ refId: jobs.refId }).from(jobs).where(eq(jobs.idempotencyKey, `ingest:${v.idempotencyKey}`));
  if (existing) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.sourceAssetId, existing.refId));
    return { ok: true as const, projectId: p!.id };
  }

  // Re-inspect server side: the client's view of the link is never trusted.
  let info: Inspection;
  try { info = await inspect(v.url); } catch (e) { return { ok: false as const, errorCode: e instanceof ImportError ? e.code : "invalid_link" }; }
  if (info.status !== "supported") return { ok: false as const, errorCode: info.errorCode ?? "unsupported_source" };

  const plan = PLANS[workspace.plan];
  const [month] = await db.select({ n: count() }).from(jobs)
    .where(and(eq(jobs.workspaceId, workspace.id), eq(jobs.type, "ingest"), gte(jobs.createdAt, startOfMonth())));
  if ((month?.n ?? 0) >= plan.monthlyImports) return { ok: false as const, errorCode: "quota_reached" as const };
  if (info.sizeBytes && info.sizeBytes > 4 * 1024 ** 3) return { ok: false as const, errorCode: "size_exceeded" as const };

  const created = await db.transaction(async (tx) => {
    const [asset] = await tx.insert(sourceAssets).values({
      workspaceId: workspace.id,
      kind: info.provider === "direct" ? "remote_url" : (info.platform as "vimeo"),
      originalUrlEnc: encrypt(v.url.trim(), env.DATA_ENCRYPTION_KEY),
      canonicalUrl: info.canonicalUrl,
      platform: info.platform,
      externalVideoId: info.externalVideoId,
      sourceTitle: info.title,
      sourceCreatorName: info.creatorName,
      sourceCreatorUrl: info.creatorUrl,
      thumbnailUrl: info.thumbnailUrl,
      creditLine: v.creditLine ?? (v.rightsBasis === "own" ? null : info.creatorName ?? null),
      rightsBasis: v.rightsBasis,
      rightsAttestedAt: new Date(),
      rightsAttestedBy: user.id,
      licenseReference: v.licenseReference,
      importProvider: info.provider,
      importStatus: "queued",
    }).returning();
    const [project] = await tx.insert(projects).values({ workspaceId: workspace.id, sourceAssetId: asset!.id, title: info.title ?? info.canonicalUrl, status: "importing", stage: "import" }).returning();
    const [job] = await tx.insert(jobs).values({ workspaceId: workspace.id, type: "ingest", refId: asset!.id, idempotencyKey: `ingest:${v.idempotencyKey}` }).returning();
    await tx.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "source.import", target: asset!.id, meta: { rightsBasis: v.rightsBasis, canonicalUrl: info.canonicalUrl } });
    return { projectId: project!.id, jobId: job!.id };
  });

  await inngest.send({ id: created.jobId, name: "source/ingest.requested", data: { jobId: created.jobId, workspaceId: workspace.id } });
  return { ok: true as const, projectId: created.projectId };
}

const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;

const uploadInput = z.object({
  filename: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  rightsBasis: z.enum(["own", "authorized", "licensed"]),
  attested: z.literal(true),
  licenseReference: z.string().max(500).optional(),
  creditLine: z.string().max(300).optional(),
  // A link whose file could not be fetched (e.g. YouTube): its provenance is kept with the upload.
  fromUrl: z.string().max(4096).optional(),
  idempotencyKey: z.uuid(),
}).refine((v) => v.rightsBasis !== "licensed" || !!v.licenseReference, { path: ["licenseReference"] });

/** Step 1 of an upload: create the records and return a short-lived signed PUT URL (direct to R2). */
export async function createUpload(input: z.input<typeof uploadInput>) {
  const { user, workspace } = await requireWorkspace("editor");
  const v = uploadInput.parse(input);

  const [existing] = await db.select({ refId: jobs.refId }).from(jobs).where(eq(jobs.idempotencyKey, `upload:${v.idempotencyKey}`));
  if (existing) return { ok: false as const, errorCode: "retrieval_failed" as const }; // a key is used for one upload only

  const [month] = await db.select({ n: count() }).from(jobs)
    .where(and(eq(jobs.workspaceId, workspace.id), eq(jobs.type, "ingest"), gte(jobs.createdAt, startOfMonth())));
  if ((month?.n ?? 0) >= PLANS[workspace.plan].monthlyImports) return { ok: false as const, errorCode: "quota_reached" as const };

  let origin: Inspection | null = null;
  if (v.fromUrl) { try { origin = await inspect(v.fromUrl); } catch { origin = null; } }

  const created = await db.transaction(async (tx) => {
    const [asset] = await tx.insert(sourceAssets).values({
      workspaceId: workspace.id,
      kind: "upload",
      canonicalUrl: origin?.canonicalUrl,
      platform: origin?.platform,
      externalVideoId: origin?.externalVideoId,
      sourceTitle: origin?.title ?? v.filename,
      sourceCreatorName: origin?.creatorName,
      sourceCreatorUrl: origin?.creatorUrl,
      thumbnailUrl: origin?.thumbnailUrl,
      creditLine: v.creditLine ?? (v.rightsBasis === "own" ? null : origin?.creatorName ?? null),
      rightsBasis: v.rightsBasis,
      rightsAttestedAt: new Date(),
      rightsAttestedBy: user.id,
      licenseReference: v.licenseReference,
      importProvider: "upload",
      importStatus: "importing",
    }).returning();
    const key = sourceKey(workspace.id, asset!.id);
    await tx.update(sourceAssets).set({ storageKey: key }).where(eq(sourceAssets.id, asset!.id));
    const [project] = await tx.insert(projects).values({ workspaceId: workspace.id, sourceAssetId: asset!.id, title: origin?.title ?? v.filename, status: "importing", stage: "import" }).returning();
    await tx.insert(jobs).values({ workspaceId: workspace.id, type: "ingest", refId: asset!.id, idempotencyKey: `upload:${v.idempotencyKey}`, status: "running", startedAt: new Date() });
    await tx.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "source.upload", target: asset!.id, meta: { rightsBasis: v.rightsBasis, size: v.size } });
    return { projectId: project!.id, key };
  });
  return { ok: true as const, projectId: created.projectId, putUrl: await signedPutUrl(created.key, "application/octet-stream", 6 * 3600) };
}

/** Step 2: the browser finished its PUT. Size is checked on the stored object, never on the client's word. */
export async function completeUpload(projectId: string) {
  const { workspace } = await requireWorkspace("editor");
  const [row] = await db.select({ asset: sourceAssets }).from(projects)
    .innerJoin(sourceAssets, eq(sourceAssets.id, projects.sourceAssetId))
    .where(and(eq(projects.id, z.uuid().parse(projectId)), eq(projects.workspaceId, workspace.id)));
  if (!row || row.asset.kind !== "upload" || !row.asset.storageKey) return { ok: false as const, errorCode: "retrieval_failed" as const };
  if (row.asset.importStatus === "imported") return { ok: true as const }; // double submit

  const size = await headSize(row.asset.storageKey);
  const fail = async (code: ImportErrorCode) => {
    await db.update(sourceAssets).set({ importStatus: "failed", importErrorCode: code }).where(eq(sourceAssets.id, row.asset.id));
    await db.update(projects).set({ status: "failed", errorCode: code }).where(eq(projects.id, projectId));
    await db.update(jobs).set({ status: "failed", error: code, finishedAt: new Date() }).where(and(eq(jobs.refId, row.asset.id), eq(jobs.type, "ingest")));
    return { ok: false as const, errorCode: code };
  };
  if (!size) return fail("retrieval_failed");
  if (size > MAX_UPLOAD_BYTES) return fail("size_exceeded");

  await db.update(sourceAssets).set({ importStatus: "imported", importedBytes: size, purgeAfter: new Date(Date.now() + 30 * 86_400_000) }).where(eq(sourceAssets.id, row.asset.id));
  await db.update(jobs).set({ status: "succeeded", progress: 1, finishedAt: new Date() }).where(and(eq(jobs.refId, row.asset.id), eq(jobs.type, "ingest")));
  await db.update(projects).set({ status: "analyzing", stage: "transcribe" }).where(eq(projects.id, projectId));
  await inngest.send({ id: `analyze:${row.asset.id}`, name: "source/analyze.requested", data: { assetId: row.asset.id, workspaceId: workspace.id } });
  return { ok: true as const };
}
