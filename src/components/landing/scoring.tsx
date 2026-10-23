import { getTranslations } from "next-intl/server";
import { CRITERIA, CRITERION_MAX, clipScore, formatHMS, type DemoClip } from "@/lib/landing-demo";
import { cardClass, h2Class, sectionClass } from "./styles";

/** The only score shown is a real one: the first produced demo clip, or an explicit placeholder. */
export async function Scoring({ example }: { example: DemoClip | null }) {
  const t = await getTranslations("landing.scoring");
  return (
    <section aria-labelledby="scoring-title" className={sectionClass}>
      <div className="flex flex-col gap-2">
        <h2 id="scoring-title" className={h2Class}>{t("title")}</h2>
        <p className="max-w-2xl text-muted">{t("intro")}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="flex flex-col gap-4">
          {CRITERIA.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <dt className="font-semibold">{t(`criteria.${k}.name`)}</dt>
              <dd className="text-sm text-muted">{t(`criteria.${k}.desc`)}</dd>
            </div>
          ))}
        </dl>
        <article className={`${cardClass} flex flex-col gap-4`} aria-labelledby="scoring-example">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">{t("exampleLabel")}</p>
          {example ? (
            <>
              <div className="flex flex-col gap-1">
                <h3 id="scoring-example" className="font-semibold">{example.title}</h3>
                <p className="text-sm text-muted">{formatHMS(example.startS)} – {formatHMS(example.endS)}</p>
              </div>
              <ul className="flex flex-col gap-2 text-sm">
                {CRITERIA.map((k) => (
                  <li key={k} className="flex justify-between gap-4">
                    <span>{t(`criteria.${k}.name`)}</span>
                    <span className="font-mono">{t("outOf", { points: example.points[k], max: CRITERION_MAX })}</span>
                  </li>
                ))}
              </ul>
              <p className="font-mono text-lg font-semibold">{t("outOf", { points: clipScore(example), max: CRITERIA.length * CRITERION_MAX })}</p>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 id="scoring-example" className="font-semibold">{t("exampleEmpty")}</h3>
              <p className="text-sm text-muted">{t("exampleEmptyBody")}</p>
            </div>
          )}
          <p className="text-xs text-muted">{t("aiNote")}</p>
        </article>
      </div>
    </section>
  );
}
