"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { Icon } from "./icon";

export type StudioProject = { id: string; title: string; status: "draft" | "importing" | "analyzing" | "ready" | "rendering" | "done" | "failed"; createdAt: string; clips: number };

export function StudioView({ projects, preview = false, listOnly = false, canEdit = true }: { projects: StudioProject[]; preview?: boolean; listOnly?: boolean; canEdit?: boolean }) {
  const t = useTranslations("studio");
  const f = useFormatter();
  const router = useRouter();
  const newHref = preview ? "/preview?screen=new" : "/new";
  return (
    <div className="studio-home">
      {!listOnly ? <>
        <section className="studio-hero"><div><p className="eyebrow"><span className="status-dot" />{t("eyebrow")}</p><h1>{t("headline")}<br /><span>{t("headlineAccent")}</span></h1><p className="hero-description">{t("description")}</p></div><div className="hero-orbit" aria-hidden="true"><span className="orbit-ring" /><span className="orbit-ring second" /><div className="orbit-core"><Icon name="scissors" /></div><span className="orbit-point" /></div></section>
        {canEdit && <section className="studio-import"><h2><span className="mini-icon"><Icon name="spark" /></span>{t("importTitle")}</h2><form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const url = String(form.get("url") ?? "").trim(); if (preview) router.push("/preview?screen=new"); else router.push(`/new?url=${encodeURIComponent(url)}`); }}><label className="studio-url"><Icon name="link" /><span className="sr-only">{t("urlLabel")}</span><input type="url" required name="url" maxLength={4096} placeholder={t("urlPlaceholder")} /></label><button className="studio-button primary" type="submit">{t("createClips")}<Icon name="arrow" /></button></form><div className="import-bottom"><Link href={preview ? "/preview?screen=new" : "/new?tab=upload"}><Icon name="upload" />{t("upload")}</Link><span>{t("rights")}</span></div></section>}
      </> : <div className="page-heading"><div><p className="eyebrow">{t("workspace")}</p><h1>{t("nav.projects")}</h1></div>{canEdit && <Link href={newHref} className="studio-button primary"><Icon name="upload" />{t("nav.new")}</Link>}</div>}
      <div className="section-heading"><h2>{t("recentProjects")}</h2>{!listOnly && <Link href={preview ? "/preview?screen=projects" : "/projects"}>{t("allProjects")}<Icon name="arrow" /></Link>}</div>
      {projects.length ? <div className="project-grid">{projects.map((p) => <Link key={p.id} href={`/projects/${p.id}`} className="project-card"><div className="project-art"><Icon name="film" /><span className={`project-status status-${p.status}`}>{t(`status.${p.status}`)}</span></div><div className="project-details"><h3>{p.title}</h3><div><span>{t("clipCount", { n: p.clips })}</span><span>{f.dateTime(new Date(p.createdAt), { day: "numeric", month: "short" })}</span></div></div></Link>)}</div>
        : <div className="studio-empty"><span className="empty-icon"><Icon name="film" /></span><div><h3>{t("emptyTitle")}</h3><p>{t("emptyDescription")}</p></div>{canEdit && <Link href={newHref} className="studio-button secondary">{t("firstProject")}<Icon name="arrow" /></Link>}</div>}
      {!listOnly && <><div className="section-heading"><h2>{t("workflowTitle")}</h2><span className="eyebrow">{t("workflowNote")}</span></div><div className="workflow-grid">
        {([{ key: "import", icon: "upload", href: newHref }, { key: "edit", icon: "scissors", href: preview ? "/preview?screen=editor" : "/projects" }, { key: "publish", icon: "calendar", href: preview ? "/preview?screen=calendar" : "/calendar" }] as const).map((s) => <Link href={s.href} className={`workflow-card workflow-${s.key}`} key={s.key}><div className="workflow-art" aria-hidden="true"><Icon name={s.icon} /></div><h3>{t(`workflow.${s.key}.title`)}</h3><p>{t(`workflow.${s.key}.description`)}</p><span className="workflow-arrow"><Icon name="arrow" /></span></Link>)}
      </div><footer className="studio-footer"><span>{t("footer")}</span><span>TikTok <b>·</b> YouTube <b>·</b> Instagram</span></footer></>}
    </div>
  );
}
