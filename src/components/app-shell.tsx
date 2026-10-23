"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import { Icon, type IconName } from "./icon";
import { Brand } from "./brand";

const navigation: { path: string; key: "studio" | "projects" | "new" | "calendar" | "accounts" | "billing"; icon: IconName }[] = [
  { path: "/studio", key: "studio", icon: "studio" },
  { path: "/projects", key: "projects", icon: "film" },
  { path: "/new", key: "new", icon: "upload" },
  { path: "/calendar", key: "calendar", icon: "calendar" },
  { path: "/accounts", key: "accounts", icon: "link" },
  { path: "/billing", key: "billing", icon: "credit" },
];

export function AppShell({ children, workspaceName, balance, plan, preview = false, screen = "studio" }: {
  children: React.ReactNode; workspaceName: string; balance: number | null; plan: string | null; preview?: boolean; screen?: string;
}) {
  const t = useTranslations("studio");
  const tp = useTranslations("plans");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const current = preview ? screen : navigation.find((n) => pathname === n.path || (n.path === "/projects" && pathname.startsWith("/projects/")))?.key ?? "studio";
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link href={preview ? "/preview" : "/studio"} className="brand" aria-label={t("home")}><Brand /></Link>
        <p className="eyebrow nav-label">{t("workspace")}</p>
        <nav className="app-nav" aria-label={t("navigation")}>
          {navigation.map((item) => <Link key={item.key} href={preview ? `/preview?screen=${item.key}` : item.path} aria-current={current === item.key || (screen === "editor" && item.key === "projects") ? "page" : undefined}>
            <Icon name={item.icon} /><span>{t(`nav.${item.key}`)}</span>
          </Link>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-promo"><span className="eyebrow">{t("motto")}</span><p>{t("promo")}</p><Link href={preview ? "/sign-in" : "/billing"} className="studio-button primary">{t("plans")}<Icon name="arrow" /></Link></div>
          <div className="workspace-profile"><span className="profile-avatar"><Icon name="account" /></span><div><strong>{workspaceName}</strong><small>{preview || !plan ? t("previewMode") : tp(plan)}</small></div></div>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar"><div className="app-breadcrumb"><Icon name="studio" /><span>{workspaceName}</span><span>/</span><strong>{t(current === "editor" ? "editor" : `nav.${current}`)}</strong></div>
          <div className="topbar-tools"><span className="credit-chip">{preview ? t("previewMode") : t("credits", { n: balance ?? 0 })}</span><label className="language-picker"><span className="sr-only">{t("language")}</span><select value={locale} onChange={(e) => { const query = typeof window !== "undefined" ? window.location.search : ""; router.replace(`${pathname}${query}`, { locale: e.target.value }); }}>{routing.locales.map((l) => <option value={l} key={l}>{l.toUpperCase()}</option>)}</select></label></div>
        </header>
        {preview && <div className="preview-banner"><span className="status-dot" />{t("previewBanner")}<Link href="/sign-in">{t("signIn")}<Icon name="arrow" /></Link></div>}
        <main className="app-content" id="main">{children}</main>
      </div>
    </div>
  );
}
