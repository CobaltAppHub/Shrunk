import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { clips, jobs, projects, sourceAssets } from "@/db/schema";
import { Link } from "@/i18n/routing";
import type { Transcript } from "@/lib/clip-selection";
import { getBalance } from "@/lib/credits";
import { defaultEditState, editState, renderSpec } from "@/lib/edit-state";
import { CREDIT_COSTS } from "@/lib/pricing";
import { signedGetUrl } from "@/lib/storage";
import { requireWorkspace } from "@/lib/workspace";
import { Editor } from "./editor";

export const dynamic = "force-dynamic";

export default async function ClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { workspace, role } = await requireWorkspace("viewer");
  const p = await params;
  const ids = z.object({ id: z.uuid(), clipId: z.uuid() }).safeParse(p);
  if (!ids.success) notFound();
  // Scoped to the active workspace: another tenant's clip is a plain 404.
  const [row] = await db.select({ clip: clips, asset: sourceAssets }).from(clips)
    .innerJoin(projects, eq(projects.id, clips.projectId))
    .innerJoin(sourceAssets, eq(sourceAssets.id, projects.sourceAssetId))
    .where(and(eq(clips.id, ids.data.clipId), eq(projects.id, ids.data.id), eq(projects.workspaceId, workspace.id)));
  if (!row) notFound();
  const { clip, asset } = row;

  const t = await getTranslations("editor");
  const words = (asset.transcript as Transcript | null)?.segments.flatMap((s) => s.words) ?? [];
  const saved = editState.safeParse(clip.editState);
  const [lastRender] = await db.select({ status: jobs.status, error: jobs.error }).from(jobs)
    .where(and(eq(jobs.refId, clip.id), eq(jobs.type, "render"))).orderBy(desc(jobs.createdAt)).limit(1);

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/projects/${ids.data.id}`} className="self-start text-sm underline">{t("back")}</Link>
      <h1 className="text-2xl font-semibold">{clip.title ?? t("title")}</h1>
      <Editor
        clipId={clip.id}
        bounds={{ start: clip.startS, end: clip.endS }}
        initial={saved.success ? saved.data : defaultEditState(clip, words)}
        previewUrl={clip.previewKey ? await signedGetUrl(clip.previewKey, 3600) : null}
        hasVision={!!asset.vision}
        canEdit={role !== "viewer"}
        render={{
          status: clip.status,
          lastFailed: lastRender?.status === "failed" && lastRender.error !== "insufficient_credits",
          downloadUrl: clip.status === "rendered" && clip.renderKey ? await signedGetUrl(clip.renderKey, 3600, `${clip.title ?? "clip"}.mp4`) : null,
          cost: CREDIT_COSTS.render_hd,
          balance: await getBalance(db, workspace.id),
          hd: renderSpec(workspace.plan).height === 1080,
        }}
      />
    </div>
  );
}
