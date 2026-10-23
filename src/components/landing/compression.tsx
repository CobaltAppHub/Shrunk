"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { CRITERIA, CRITERION_MAX, clipScore, formatHMS, type DemoClip } from "@/lib/landing-demo";
import { cardClass, h2Class } from "./styles";

/**
 * Scroll-driven compression of the source timeline into the real clips.
 * Progress is written to a CSS variable (--p) outside React; without JS or with
 * prefers-reduced-motion the section stays in its final, static state (--p = 1).
 */
export function Compression({ clips, durationS }: { clips: DemoClip[]; durationS: number }) {
  const t = useTranslations("landing");
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.scroll = "true";
    let frame = 0;
    const update = () => {
      frame = 0;
      const { top, height } = el.getBoundingClientRect();
      const travel = height - window.innerHeight;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -top / travel)) : 1;
      el.style.setProperty("--p", progress.toFixed(3));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      delete el.dataset.scroll;
      el.style.removeProperty("--p");
    };
  }, []);

  const duration = formatHMS(durationS);
  return (
    <section ref={sectionRef} className="compress" aria-labelledby="stay-title">
      <div className="compress-stick flex flex-col gap-6 py-12">
        <div className="flex flex-col gap-2">
          <h2 id="stay-title" className={h2Class}>{t("stay.title")}</h2>
          <p className="max-w-2xl text-muted">{t("stay.intro")}</p>
          <p className="text-sm font-medium text-primary">{t("media.label")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("stay.sourceLabel", { duration })}</p>
          <div
            role="img"
            aria-label={t("stay.timelineAlt", { duration, count: clips.length })}
            className="relative h-10 w-full overflow-hidden rounded-[var(--r-sm)] border border-border bg-surface"
          >
            <span className="compress-gap absolute inset-0 bg-border" aria-hidden="true" />
            {clips.map((c, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="absolute inset-y-0 bg-primary"
                style={{ left: `${(c.startS / durationS) * 100}%`, width: `${((c.endS - c.startS) / durationS) * 100}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between font-mono text-xs text-muted" aria-hidden="true">
            <span>{formatHMS(0)}</span>
            <span>{duration}</span>
          </div>
          <p className="text-sm font-medium">{t("stay.clipsLabel", { count: clips.length })}</p>
        </div>
        <ol className="grid gap-4 md:grid-cols-3">
          {clips.map((c, i) => (
            <li key={i} className={`compress-card ${cardClass} flex flex-col gap-3`} style={{ "--i": i } as React.CSSProperties}>
              <h3 className="font-semibold">{c.title}</h3>
              <p className="font-mono text-sm text-muted">{t("stay.range", { start: formatHMS(c.startS), end: formatHMS(c.endS) })}</p>
              <p className="font-mono font-semibold">{t("stay.score", { score: clipScore(c) })}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {CRITERIA.map((k) => (
                  <li key={k} className="flex justify-between gap-3">
                    <span className="text-muted">{t(`scoring.criteria.${k}.name`)}</span>
                    <span className="font-mono">{t("scoring.outOf", { points: c.points[k], max: CRITERION_MAX })}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
