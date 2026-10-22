import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { clips, projects, sourceAssets } from "@/db/schema";
import { Link } from "@/i18n/routing";
import type { Candidate } from "@/lib/clip-selection";
import { STEPS, isTerminal, pipelineSteps } from "@/lib/pipeline";
import { signedGetUrl } from "@/lib/storage";
import { requireWorkspace } from "@/lib/workspace";
import { IMPORT_ERROR_CODES } from "@/sources/errors";
import { LiveRefresh } from "./live";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireWorkspace("viewer");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  // Scoped to the active workspace: another tenant's project is a plain 404.
  const [row] = await db.select({ p: projects, a: sourceAssets }).from(projects)
    .leftJoin(sourceAssets, eq(sourceAssets.id, projects.sourceAssetId))
    .where(and(eq(projects.id, id.data), eq(projects.workspaceId, workspace.id)));
  if (!row) notFound();
  const { p, a } = row;

  const t = await getTranslations("project");
  const ti = await getTranslations("import");
  const te = await getTranslations("editor");
  const steps = pipelineSteps(p.status, p.stage);
  const list = p.status === "ready" ? await db.select().from(clips).where(eq(clips.projectId, p.id)).orderBy(desc(clips.score)) : [];
  const previews = await Promise.all(list.map((c) => (c.previewKey ? signedGetUrl(c.previewKey, 3600) : null)));
  const err = p.errorCode;
  const errorText = !err ? null
    : (IMPORT_ERROR_CODES as readonly string[]).includes(err) ? ti(`errors.${err as (typeof IMPORT_ERROR_CODES)[number]}`)
    : err === "no_audio" || err === "worker_failed" ? t(`errors.${err}`) : t("errors.worker_failed");

  return (
    <div className="flex flex-col gap-8">
      {!isTerminal(p.status) && <LiveRefresh projectId={p.id} rendered={JSON.stringify({ status: p.status, stage: p.stage, errorCode: p.errorCode })} />}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold break-words">{p.title}</h1>
        {a?.creditLine && <p className="text-sm text-muted">{t("credit", { credit: a.creditLine })}</p>}
      </header>

      <ol className="flex flex-col gap-2" aria-label={t("steps.check")}>
        {STEPS.map((s) => (
          <li key={s} className="flex items-center gap-3" aria-current={steps[s] === "active" ? "step" : undefined}>
            <span aria-hidden className={`size-3 rounded-full ${steps[s] === "done" ? "bg-primary" : steps[s] === "active" ? "animate-pulse bg-primary/60" : steps[s] === "failed" ? "bg-danger" : "bg-border"}`} />
            <span className={steps[s] === "pending" ? "text-muted" : ""}>{t(`steps.${s}`)}</span>
            <span className="sr-only">({t(`state.${steps[s]}`)})</span>
          </li>
        ))}
      </ol>

      {p.status === "failed" && (
        <div role="alert" className="flex flex-col gap-2 rounded-[var(--r-md)] border border-danger p-4">
          <p>{errorText}</p>
          <p className="text-sm text-muted">{t("failed")}</p>
          <Link href="/new?tab=upload" className="self-start underline">{ti("uploadInstead")}</Link>
        </div>
      )}

      {p.status === "ready" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{t("ready", { count: list.length })}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c, i) => {
              const r = c.scoreReasons as Candidate["scoreReasons"];
              return (
                <li key={c.id} className="flex flex-col gap-3 rounded-[var(--r-md)] bg-surface p-4">
                  {previews[i]
                    ? <video src={previews[i]!} controls preload="metadata" className="aspect-video w-full rounded-[var(--r-sm)] bg-black" aria-label={c.title ?? ""} />
                    : <p className="flex aspect-video items-center justify-center rounded-[var(--r-sm)] bg-bg text-sm text-muted">{t("previewUnavailable")}</p>}
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-sm">{c.hook}</p>
                  <details className="text-sm">
                    <summary className="cursor-pointer font-semibold text-primary">{t("score", { score: c.score })}</summary>
                    <dl className="mt-2 grid gap-2">
                      {(["hook", "standalone", "emotion", "pace"] as const).map((k) => (
                        <div key={k}><dt className="font-medium">{t(`criteria.${k}`)} — {r[k].score}/20</dt><dd className="text-muted">{r[k].reason}</dd></div>
                      ))}
                      <div><dt className="font-medium">{t("criteria.duration")} — {r.duration.score}/20</dt><dd className="text-muted">{t("durationReason", { seconds: r.duration.seconds })}</dd></div>
                    </dl>
                  </details>
                  {c.hashtags.length > 0 && <p className="text-xs text-muted">{c.hashtags.join(" ")}</p>}
                  <Link href={`/projects/${p.id}/clips/${c.id}`} className="mt-auto self-start rounded-[var(--r-full)] border border-border px-4 py-2 text-sm">{te("edit")}</Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
