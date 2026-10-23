"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ctaClass } from "./styles";

/** Mobile-only bar: visible once the hero has scrolled away, hidden while the pricing section is on screen. */
export function StickyCta() {
  const t = useTranslations("landing");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    const pricing = document.getElementById("pricing");
    if (!hero || !pricing) return;
    const onScreen = { hero: true, pricing: false };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) onScreen.hero = entry.isIntersecting;
        else onScreen.pricing = entry.isIntersecting;
      }
      setVisible(!onScreen.hero && !onScreen.pricing);
    });
    observer.observe(hero);
    observer.observe(pricing);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      role="region"
      aria-label={t("sticky.label")}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg p-3 md:hidden ${visible ? "" : "hidden"}`}
    >
      <Link href="/new" className={`${ctaClass} w-full`}>{t("hero.cta")}</Link>
      <p className="mt-2 text-center text-xs text-muted">{t("hero.reassurance")}</p>
    </div>
  );
}
