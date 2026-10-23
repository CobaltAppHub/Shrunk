import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { StudioView } from "@/components/studio-view";
import { Icon } from "@/components/icon";
import { Link } from "@/i18n/routing";
import { defaultEditState } from "@/lib/edit-state";
import { Editor } from "../(app)/projects/[id]/clips/[clipId]/editor";
import { Calendar } from "../(app)/calendar/calendar";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Public visual preview. Uses the production components, never a session or customer records. */
export default async function DesignPreview({ searchParams }: { searchParams: Promise<{ screen?: string; view?: string; d?: string }> }) {
  const t = await getTranslations("studio");
  const tc = await getTranslations("calendar");
  const q = await searchParams;
  const screen = ["studio", "projects", "new", "editor", "calendar", "accounts", "billing"].includes(q.screen ?? "") ? q.screen! : "studio";
  const state = defaultEditState({ startS: 0, endS: 30 }, []);
  state.captions.style.highlight = "#ACFA64";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(q.d ?? "") && Number.isFinite(Date.parse(`${q.d}T00:00:00Z`)) ? q.d! : new Date().toISOString().slice(0, 10);
  return <AppShell preview screen={screen} workspaceName={t("previewWorkspace")} plan={null} balance={null}>
    <nav className="preview-tabs" aria-label={t("previewNavigation")}>{(["studio", "editor", "calendar"] as const).map((s) => <Link href={`/preview?screen=${s}`} key={s} aria-current={s === screen ? "page" : undefined}>{s === "editor" ? t("editor") : t(`nav.${s}`)}</Link>)}</nav>
    {screen === "studio" || screen === "projects" ? <StudioView preview listOnly={screen === "projects"} projects={[]} />
      : screen === "editor" ? <><div className="page-heading"><div><p className="eyebrow">{t("previewMode")}</p><h1>{t("editor")}</h1></div></div><Editor previewMode clipId="00000000-0000-4000-8000-000000000000" bounds={{ start: 0, end: 30 }} initial={state} previewUrl={null} hasVision={false} canEdit render={{ status: "candidate", lastFailed: false, downloadUrl: null, cost: 1, balance: 0, hd: true }} publish={{ autoPublish: false, tiktokDraft: true, defaultCaption: "", accounts: [], booked: [] }} /></>
        : screen === "calendar" ? <div className="flex flex-col gap-6"><h1>{tc("title")}</h1><Calendar preview view={q.view === "week" ? "week" : "month"} anchor={anchor} posts={[]} canEdit={false} /></div>
          : <><div className="page-heading"><div><p className="eyebrow">{t("previewMode")}</p><h1>{t(`nav.${screen as "new" | "accounts" | "billing"}`)}</h1></div></div><div className="studio-empty"><span className="empty-icon"><Icon name={screen === "new" ? "upload" : screen === "accounts" ? "link" : "credit"} /></span><div><h3>{t("previewProtectedTitle")}</h3><p>{t("previewProtectedDescription")}</p></div><Link href="/sign-in" className="studio-button primary">{t("signIn")}<Icon name="arrow" /></Link></div></>}
  </AppShell>;
}
