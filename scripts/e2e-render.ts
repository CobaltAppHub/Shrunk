import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clips, creditLedger, jobs, projects } from "@/db/schema";
import { getBalance } from "@/lib/credits";
import type { Word } from "@/lib/clip-selection";
import { defaultEditState, editState } from "@/lib/edit-state";
import { env } from "@/lib/env";
import { CREDIT_COSTS } from "@/lib/pricing";
import { requestClipRender, type RenderActor } from "@/lib/renders";
import { headSize, renderKey, s3 } from "@/lib/storage";
import { assertHdRender, probeFile } from "./e2e-media";
import type { Report } from "./report";

export const RENDER_FILES = ["src/lib/renders.ts", "src/inngest/render.ts", "src/lib/credits.ts", "worker/render.py", "scripts/e2e-render.ts"];

/** Returns a verified delivered clip, or null; YouTube is gated on all these checks. */
export async function renderBestClip(report: Report, actor: RenderActor, clip: typeof clips.$inferSelect, timeoutMin: number, words: Word[]) {
  const key = randomUUID();
  const before = await getBalance(db, actor.workspace.id);
  const ownedClip = and(eq(clips.id, clip.id), inArray(clips.projectId,
    db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, actor.workspace.id))));
  // Use the editor's defaults, with no invented transcript or words.
  const edit = editState.safeParse(clip.editState);
  const state = edit.success ? edit.data : defaultEditState(clip, words);
  await db.update(clips).set({ editState: state }).where(ownedClip);
  let jobId = "";
  const requested = await report.run({ id: "render-request", section: "flow", title: "Rendu payant du meilleur extrait lancé (1 crédit)", files: RENDER_FILES }, async () => {
    const r = await requestClipRender(actor, clip.id, key);
    if (!r.ok) throw new Error(`rendu refusé : ${r.error}`);
    jobId = r.jobId;
    report.facts["Job rendu"] = jobId;
    return { detail: `job ${jobId}` };
  });
  if (requested !== "pass") return null;

  const expectedKey = renderKey(actor.workspace.id, clip.id, jobId);
  const t0 = Date.now();
  let delivered = false;
  while (Date.now() - t0 < timeoutMin * 60_000) {
    const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, actor.workspace.id)));
    const [current] = await db.select().from(clips).where(ownedClip);
    const [settlement] = await db.select().from(creditLedger).where(and(eq(creditLedger.jobId, jobId), eq(creditLedger.idempotencyKey, `settle:${jobId}`)));
    delivered = job?.status === "succeeded" && current?.status === "rendered" && current.renderKey === expectedKey && settlement?.kind === "capture";
    if (delivered || !job || job.status === "failed" || job.status === "cancelled" || settlement?.kind === "release") break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  report.add({ id: "render-delivered", section: "flow", title: "Rendu livré et réservation capturée", status: delivered ? "pass" : "fail", detail: delivered ? `${Math.round((Date.now() - t0) / 1000)} s` : "rendu non livré/capturé avant la limite ; consulter le job", files: RENDER_FILES });
  if (!delivered) return null;

  const media = await report.run({ id: "render-media", section: "flow", title: "Fichier réel : MP4 1080×1920, 30 i/s, audio et durée", files: RENDER_FILES }, async () => {
    const bytes = await headSize(expectedKey);
    if (!bytes) throw new Error("rendu absent ou vide dans R2");
    await mkdir("work/e2e", { recursive: true });
    const dir = await mkdtemp(join("work/e2e", "render-"));
    try {
      const file = join(dir, "render.mp4");
      const object = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: expectedKey }));
      await pipeline(object.Body as Readable, createWriteStream(file));
      const info = assertHdRender(await probeFile(file), state.trim.end - state.trim.start);
      report.facts["Rendu octets"] = bytes;
      report.facts["Rendu durée (s)"] = info.duration;
      return { detail: `${info.width}×${info.height}, ${info.fps} i/s, ${info.duration.toFixed(2)} s, ${bytes} octets` };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const replay = await report.run({ id: "render-replay", section: "flow", title: "Rejeu du rendu : même job et aucun double débit", files: RENDER_FILES }, async () => {
    const again = await requestClipRender(actor, clip.id, key);
    if (!again.ok || again.jobId !== jobId) throw new Error("le rejeu n'a pas retrouvé le même job");
    const ledger = await db.select().from(creditLedger).where(and(eq(creditLedger.jobId, jobId), eq(creditLedger.workspaceId, actor.workspace.id)));
    const reservations = ledger.filter((l) => l.kind === "reserve");
    const captures = ledger.filter((l) => l.kind === "capture");
    const after = await getBalance(db, actor.workspace.id);
    if (ledger.length !== 2 || reservations.length !== 1 || reservations[0]!.delta !== -CREDIT_COSTS.render_hd || captures.length !== 1 || captures[0]!.delta !== 0 || before - after !== CREDIT_COSTS.render_hd) {
      throw new Error("le ledger ou le solde ne correspond pas à une seule réservation et capture de 1 crédit");
    }
    report.facts["Crédits de rendu consommés"] = before - after;
  });
  return media === "pass" && replay === "pass" ? clip.id : null;
}
