import { getTranslations } from "next-intl/server";
import { WITHDRAWAL_DAYS, WITHDRAWAL_MAX_RENDERS } from "@/lib/pricing";
import { h2Class, sectionClass } from "./styles";

const INDEXES = [1, 2, 3, 4, 5, 6, 7] as const;

export async function Faq() {
  const t = await getTranslations("landing.faq");
  const items = INDEXES.map((i) => ({
    question: t(`q${i}`),
    answer: t(`a${i}`, { days: WITHDRAWAL_DAYS, max: WITHDRAWAL_MAX_RENDERS }),
  }));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  return (
    <section aria-labelledby="faq-title" className={sectionClass}>
      <h2 id="faq-title" className={h2Class}>{t("title")}</h2>
      <div className="flex flex-col divide-y divide-border rounded-[var(--r-md)] border border-border bg-surface">
        {items.map((item) => (
          <details key={item.question} className="group px-5 py-4">
            <summary className="cursor-pointer list-none rounded-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden">{item.question}</summary>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{item.answer}</p>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </section>
  );
}
