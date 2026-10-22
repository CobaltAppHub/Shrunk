import { and, desc, eq, gte } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { clips, jobs, projects, scheduledPosts, socialAccounts, sourceAssets } from "@/db/schema";
import { Link } from "@/i18n/routing";
import type { Transcript } from "@/lib/clip-selection";
import { getBalance } from "@/lib/credits";
import { defaultEditState, editState, renderSpec } from "@/lib/edit-state";
import { CREDIT_COSTS, PLANS } from "@/lib/pricing";
import { tiktokDraftMode } from "@/publish";
import { defaultCaption } from "@/publish/schedule";
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
  const ts = await getTranslations("schedule");
  const [accounts, booked] = await Promise.all([
    db.select({ id: socialAccounts.id, platform: socialAccounts.platform, name: socialAccounts.displayName, ext: socialAccounts.externalId }).from(socialAccounts)
      .where(and(eq(socialAccounts.workspaceId, workspace.id), eq(socialAccounts.status, "connected"))),
    db.select({ at: scheduledPosts.scheduledAt }).from(scheduledPosts)
      .where(and(eq(scheduledPosts.workspaceId, workspace.id), eq(scheduledPosts.status, "scheduled"), gte(scheduledPosts.scheduledAt, new Date()))),
  ]);
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
        publish={{
          autoPublish: PLANS[workspace.plan].autoPublish,
          tiktokDraft: tiktokDraftMode(),
          // Third-party content keeps its credit in the suggested caption (licence attribution).
          defaultCaption: defaultCaption({ title: clip.title ?? "", hashtags: clip.hashtags, credit: asset.rightsBasis !== "own" ? asset.creditLine : null, creditLabel: ts("creditLabel") }),
          accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, name: a.name ?? a.ext })),
          booked: booked.map((b) => b.at.toISOString()),
        }}
      />
    </div>
  );
}
