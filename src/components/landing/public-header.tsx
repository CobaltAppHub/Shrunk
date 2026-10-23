import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Brand } from "@/components/brand";

export async function PublicHeader({ withNav = true }: { withNav?: boolean }) {
  const t = await getTranslations("landing");
  const nav = await getTranslations("nav");
  const studio = await getTranslations("studio");
  return (
    <header className="public-brandbar">
      <Link href="/" className="brand"><Brand /></Link>
      {withNav && (
        <nav aria-label={t("navLabel")} className="flex items-center gap-5 text-sm">
          <a href="#pricing" className="rounded-sm underline-offset-4 hover:underline">{nav("pricing")}</a>
          <Link href="/sign-in" className="rounded-sm underline-offset-4 hover:underline">{nav("signIn")}</Link>
          <Link href="/studio" className="rounded-sm underline-offset-4 hover:underline">{studio("nav.studio")}</Link>
        </nav>
      )}
    </header>
  );
}
