"use server";

import { and, count, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, jobs, projects, sourceAssets } from "@/db/schema";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/pricing";
import { encrypt } from "@/lib/secrets";
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
    const [project] = await tx.insert(projects).values({ workspaceId: workspace.id, sourceAssetId: asset!.id, title: info.title ?? info.canonicalUrl, status: "importing" }).returning();
    const [job] = await tx.insert(jobs).values({ workspaceId: workspace.id, type: "ingest", refId: asset!.id, idempotencyKey: `ingest:${v.idempotencyKey}` }).returning();
    await tx.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "source.import", target: asset!.id, meta: { rightsBasis: v.rightsBasis, canonicalUrl: info.canonicalUrl } });
    return { projectId: project!.id, jobId: job!.id };
  });

  await inngest.send({ id: created.jobId, name: "source/ingest.requested", data: { jobId: created.jobId, workspaceId: workspace.id } });
  return { ok: true as const, projectId: created.projectId };
}
