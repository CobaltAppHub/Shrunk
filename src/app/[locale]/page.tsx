import { setRequestLocale } from "next-intl/server";
import { availableDemoClips } from "@/lib/landing-demo";
import { PublicHeader } from "@/components/landing/public-header";
import { Hero } from "@/components/landing/hero";
import { Scoring } from "@/components/landing/scoring";
import { StaySection } from "@/components/landing/stay-section";
import { PublishSection, UseCases } from "@/components/landing/publish-use-cases";
import { Calculator } from "@/components/landing/calculator";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { StickyCta } from "@/components/landing/sticky-cta";

export default async function Landing({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const clips = availableDemoClips();
  return (
    <main className="public-page pb-28 md:pb-12" id="main">
      <PublicHeader />
      <Hero locale={locale} />
      <Scoring example={clips?.[0] ?? null} />
      <StaySection clips={clips} />
      <PublishSection />
      <UseCases />
      <Calculator />
      <Pricing />
      <Faq />
      <Footer />
      <StickyCta />
    </main>
  );
}
