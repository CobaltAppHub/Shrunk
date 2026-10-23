import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

const LINKS = [
  { key: "mentions", href: "/legal/mentions" },
  { key: "cgv", href: "/legal/cgv" },
  { key: "privacy", href: "/legal/privacy" },
  { key: "cookies", href: "/legal/cookies" },
  { key: "report", href: "/report" },
] as const;

export async function Footer() {
  const t = await getTranslations("legal");
  return (
    <footer className="flex flex-col gap-4 border-t border-border py-8 text-sm text-muted">
      <nav aria-label={t("footerLabel")}>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {LINKS.map(({ key, href }) => (
            <li key={key}><Link href={href} className="rounded-sm underline-offset-4 hover:text-text hover:underline">{t(`titles.${key}`)}</Link></li>
          ))}
        </ul>
      </nav>
      <p>{t("copyright", { year: new Date().getFullYear(), company: t("company") })}</p>
    </footer>
  );
}
