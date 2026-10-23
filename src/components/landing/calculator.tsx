"use client";

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CREDIT_COSTS, PLANS } from "@/lib/pricing";
import { PAID_PLAN_IDS, creditsForRenders, minimalPlan } from "@/lib/landing-math";
import { cardClass, h2Class, sectionClass } from "./styles";

const toCount = (raw: string) => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 0;
};

export function Calculator() {
  const t = useTranslations("landing.calculator");
  const plans = useTranslations("plans");
  const format = useFormatter();
  const id = useId();
  const [minutes, setMinutes] = useState("300");
  const [clips, setClips] = useState("10");

  const sourceMinutes = toCount(minutes);
  const renders = toCount(clips);
  const planId = minimalPlan(sourceMinutes, renders);
  const euro = (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR" });
  const importLimits = PAID_PLAN_IDS.map((p) => `${plans(p)} ${PLANS[p].monthlyImports}`).join(", ");
  const inputClass = "min-h-12 rounded-[var(--r-full)] border border-border bg-bg px-4 text-base";

  return (
    <section aria-labelledby="calculator-title" className={sectionClass}>
      <div className="flex flex-col gap-2">
        <h2 id="calculator-title" className={h2Class}>{t("title")}</h2>
        <p className="max-w-2xl text-muted">{t("intro")}</p>
      </div>
      <div className={`${cardClass} flex flex-col gap-6`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-minutes`} className="text-sm font-medium">{t("minutesLabel")}</label>
            <input id={`${id}-minutes`} className={inputClass} type="number" inputMode="numeric" min={0} step={10} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-clips`} className="text-sm font-medium">{t("clipsLabel")}</label>
            <input id={`${id}-clips`} className={inputClass} type="number" inputMode="numeric" min={0} step={1} value={clips} onChange={(e) => setClips(e.target.value)} />
          </div>
        </div>
        <div aria-live="polite" className="flex flex-col gap-2">
          {planId ? (
            <>
              <p className="text-lg font-semibold">{t("resultTitle", { plan: plans(planId) })}</p>
              <p className="font-mono text-primary">{t("resultPrice", { price: euro(PLANS[planId].monthlyCents) })}</p>
            </>
          ) : (
            <p className="text-lg font-semibold">{t("none")}</p>
          )}
          <p className="text-sm text-muted">
            {t("needs", { credits: creditsForRenders(renders), cost: CREDIT_COSTS.render_hd, minutes: sourceMinutes })}
          </p>
        </div>
        <div className="flex flex-col gap-1 text-xs text-muted">
          <p>{t("importsNote", { limits: importLimits })}</p>
          <p>{t("extrasNote")}</p>
        </div>
      </div>
    </section>
  );
}
