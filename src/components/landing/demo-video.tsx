"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { DEMO, DEMO_POSTER } from "@/lib/demo";

type ConnectionNavigator = Navigator & { connection?: { saveData?: boolean } };

/** Real public-domain NASA demo. Nothing is downloaded before play (preload="none" + poster); autoplay only when allowed. */
export function DemoVideo() {
  const t = useTranslations("landing.media");
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = (navigator as ConnectionNavigator).connection?.saveData === true;
    if (reduced.matches || saveData) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !reduced.matches) void video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.5 });
    observer.observe(video);
    const onChange = () => { if (reduced.matches) video.pause(); };
    reduced.addEventListener("change", onChange);
    return () => { observer.disconnect(); reduced.removeEventListener("change", onChange); };
  }, []);

  return (
    <figure className="flex w-full max-w-3xl flex-col gap-3">
      <video
        ref={ref}
        className="aspect-video w-full rounded-[var(--r-md)] border border-border bg-surface object-cover"
        width={1920}
        height={1080}
        poster={DEMO_POSTER}
        preload="none"
        controls
        muted
        loop
        playsInline
        aria-label={t("aria")}
      >
        <source src={DEMO.url} type="video/webm" />
        {t("fallback")}
      </video>
      <figcaption className="flex flex-col gap-1 text-sm text-muted">
        <span className="font-medium text-text">{t("label")}</span>
        <span>{t("credit", { credit: DEMO.credit })}</span>
      </figcaption>
    </figure>
  );
}
