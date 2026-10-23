import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalStub } from "@/components/landing/legal-stub";

const SLUGS = ["mentions", "cgv", "privacy", "cookies"] as const;
type Slug = (typeof SLUGS)[number];
const isSlug = (s: string): s is Slug => (SLUGS as readonly string[]).includes(s);

export const dynamicParams = false;
export const generateStaticParams = () => SLUGS.map((slug) => ({ slug }));

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSlug(slug)) return {};
  const t = await getTranslations({ locale, namespace: "legal.titles" });
  return { title: t(slug) };
}

export default async function LegalPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isSlug(slug)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("legal.titles");
  return <LegalStub title={t(slug)} />;
}
