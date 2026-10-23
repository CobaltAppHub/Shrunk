import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalStub } from "@/components/landing/legal-stub";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "legal.titles" });
  return { title: t("report") };
}

export default async function ReportPage({ params }: Props) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("legal.titles");
  return <LegalStub title={t("report")} />;
}
