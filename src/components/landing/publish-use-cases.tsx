import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { PLANS } from "@/lib/pricing";
import { cardClass, ctaClass, h2Class, sectionClass } from "./styles";

export async function PublishSection() {
  const t = await getTranslations("landing.publish");
  return (
    <section aria-labelledby="publish-title" className={sectionClass}>
      <h2 id="publish-title" className={h2Class}>{t("title")}</h2>
      <p className="max-w-2xl text-muted">{t("summary")}</p>
    </section>
  );
}

export async function UseCases() {
  const t = await getTranslations("landing.useCases");
  const hero = await getTranslations("landing.hero");
  const cases = [
    { key: "podcasters", values: {} },
    { key: "founders", values: {} },
    { key: "agencies", values: { seats: PLANS.agency.seats } },
  ] as const;
  return (
    <section aria-labelledby="use-cases-title" className={sectionClass}>
      <h2 id="use-cases-title" className={h2Class}>{t("title")}</h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {cases.map(({ key, values }) => (
          <li key={key} className={`${cardClass} flex flex-col gap-2`}>
            <h3 className="font-semibold">{t(`${key}.name`)}</h3>
            <p className="text-sm text-muted">{t(`${key}.line`, values)}</p>
          </li>
        ))}
      </ul>
      <Link href="/new" prefetch={false} className={`${ctaClass} w-full sm:w-fit`}>{hero("cta")}</Link>
    </section>
  );
}
