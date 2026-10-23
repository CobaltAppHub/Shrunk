"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { PLANS, yearlyCents } from "@/lib/pricing";
import { CLIPS_PER_EXAMPLE_VIDEO, PAID_PLAN_IDS, hourVideosPerMonth, yearlyDiscountPercent } from "@/lib/landing-math";
import { cardClass, ctaClass, h2Class, sectionClass } from "./styles";

type Interval = "month" | "year";

export function Pricing() {
  const t = useTranslations("landing.pricing");
  const plans = useTranslations("plans");
  const trial = useTranslations("landing.hero");
  const format = useFormatter();
  const [interval, setInterval] = useState<Interval>("month");
  const euro = (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR" });

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={sectionClass}>
      <div className="flex flex-col gap-2">
        <h2 id="pricing-title" className={h2Class}>{t("title")}</h2>
        <p className="max-w-2xl text-muted">{t("intro")}</p>
      </div>
      <fieldset className="flex w-fit gap-1 rounded-[var(--r-full)] border border-border bg-surface p-1">
        <legend className="sr-only">{t("legend")}</legend>
        {(["month", "year"] as const).map((value) => (
          <label
            key={value}
            className="cursor-pointer rounded-[var(--r-full)] px-4 py-2 text-sm font-medium has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
          >
            <input type="radio" name="interval" value={value} checked={interval === value} onChange={() => setInterval(value)} className="sr-only" />
            {value === "month" ? t("monthly") : t("yearly", { percent: yearlyDiscountPercent })}
          </label>
        ))}
      </fieldset>
      <ul className="grid gap-4 md:grid-cols-3">
        {PAID_PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const price = interval === "month" ? t("perMonth", { price: euro(plan.monthlyCents) }) : t("perYear", { price: euro(yearlyCents(id)) });
          return (
            <li key={id} className={`${cardClass} flex flex-col gap-4`}>
              <h3 className="text-lg font-semibold">{plans(id)}</h3>
              <p className="font-mono text-xl font-semibold">{price}</p>
              <ul className="flex flex-col gap-2 text-sm">
                <li>{t("credits", { n: plan.monthlyCredits })}</li>
                <li>{Number.isFinite(plan.socialAccounts) ? t("accounts", { n: plan.socialAccounts }) : t("accountsUnlimited")}</li>
                {plan.maxHeight === 1080 && !plan.watermark && <li>{t("hd")}</li>}
              </ul>
              <p className="text-sm text-muted">{t("videos", { videos: hourVideosPerMonth(id), clips: CLIPS_PER_EXAMPLE_VIDEO })}</p>
              <Link href="/new" className={`${ctaClass} mt-auto`}>{trial("cta")}</Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
