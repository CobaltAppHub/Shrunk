import { getTranslations } from "next-intl/server";
import { DEMO } from "@/lib/demo";
import { formatHMS, type DemoClip } from "@/lib/landing-demo";
import { Compression } from "./compression";
import { cardClass, h2Class, sectionClass } from "./styles";

export async function StaySection({ clips }: { clips: DemoClip[] | null }) {
  if (clips) return <Compression clips={clips} durationS={DEMO.durationS} />;
  const t = await getTranslations("landing");
  return (
    <section aria-labelledby="stay-title" className={sectionClass}>
      <div className="flex flex-col gap-2">
        <h2 id="stay-title" className={h2Class}>{t("stay.title")}</h2>
        <p className="max-w-2xl text-muted">{t("stay.intro")}</p>
      </div>
      <div className={`${cardClass} flex flex-col gap-2`}>
        <p className="text-xs font-medium uppercase tracking-wider text-primary">{t("media.label")}</p>
        <h3 className="font-semibold">{t("stay.placeholderTitle")}</h3>
        <p className="text-sm text-muted">{t("stay.placeholderBody", { duration: formatHMS(DEMO.durationS) })}</p>
      </div>
    </section>
  );
}
