import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { advertisedPlatforms } from "@/sources";
import { Brand } from "@/components/brand";

// Hero only for J1. The link field posts to /new, which runs the real inspection (auth required).
export default async function Landing({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("landing");
  const platforms = advertisedPlatforms();
  return (
    <main className="public-page" id="main">
      <header className="public-brandbar"><Link href="/" className="brand"><Brand /></Link><Link href="/studio">{(await getTranslations("studio"))("nav.studio")}</Link></header>
    <section className="flex flex-col items-center gap-6 py-16 text-center">
      <p className="text-sm font-medium text-primary">{t("tagline")}</p>
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
      <form action="/new" method="get" className="flex w-full max-w-xl flex-col gap-3 sm:flex-row">
        <label htmlFor="url" className="sr-only">{t("linkLabel")}</label>
        <input id="url" name="url" type="url" required inputMode="url" placeholder={t("linkPlaceholder")} aria-describedby="works-with"
          className="min-h-12 flex-1 rounded-[var(--r-full)] border border-border bg-surface px-5 text-base placeholder:text-muted" />
        <button type="submit" className="min-h-12 rounded-[var(--r-full)] bg-primary px-6 font-semibold text-on-primary">{t("continue")}</button>
      </form>
      <Link href="/new?tab=upload" className="text-sm underline underline-offset-4">{t("orUpload")}</Link>
      <p id="works-with" className="max-w-xl text-sm text-muted">
        {t("worksWith", { platforms: platforms.length ? platforms.join(", ") : "none" })}
      </p>
      <p className="max-w-xl text-sm text-muted">{t("youtubeNote")}</p>
      <p className="max-w-xl text-xs text-muted">{t("rightsNote")}</p>
    </section>
    </main>
  );
}
