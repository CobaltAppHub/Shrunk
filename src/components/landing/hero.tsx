import { getTranslations } from "next-intl/server";
import { Link, routing } from "@/i18n/routing";
import { DemoVideo } from "./demo-video";
import { ctaClass } from "./styles";

export async function Hero({ locale }: { locale: string }) {
  const t = await getTranslations("landing");
  return (
    <section id="hero" aria-labelledby="hero-title" className="flex flex-col items-center gap-6 pb-10 pt-12 text-center">
      <p className="text-sm font-medium text-primary">{t("tagline")}</p>
      <h1 id="hero-title" className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
      <form action={locale === routing.defaultLocale ? "/new" : `/${locale}/new`} method="get" className="flex w-full max-w-xl flex-col gap-3 sm:flex-row">
        <label htmlFor="url" className="sr-only">{t("hero.linkLabel")}</label>
        <input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder={t("hero.linkPlaceholder")}
          aria-describedby="hero-help"
          className="min-h-12 min-w-0 flex-1 rounded-[var(--r-full)] border border-border bg-surface px-5 text-base placeholder:text-muted"
        />
        <button type="submit" className={ctaClass}>{t("hero.cta")}</button>
      </form>
      <p className="text-sm text-muted">{t("hero.reassurance")}</p>
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        <a href="#pricing" className="rounded-sm underline underline-offset-4">{t("hero.seePricing")}</a>
        <Link href="/new?tab=upload" prefetch={false} className="rounded-sm underline underline-offset-4">{t("hero.uploadLink")}</Link>
      </div>
      <div id="hero-help" className="flex max-w-xl flex-col gap-2 text-sm text-muted">
        <p>{t("hero.youtubeNote")}</p>
        <p>{t("hero.worksWith")}</p>
        <p className="text-xs">{t("hero.rightsNote")}</p>
      </div>
      <DemoVideo />
    </section>
  );
}
