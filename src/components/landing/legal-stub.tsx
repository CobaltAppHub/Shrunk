import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { PublicHeader } from "./public-header";

export async function LegalStub({ title }: { title: string }) {
  const t = await getTranslations("legal");
  return (
    <main className="public-page" id="main">
      <PublicHeader withNav={false} />
      <section className="flex flex-col gap-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <h2 className="text-lg font-medium">{t("draftTitle")}</h2>
        <p className="text-muted">{t("draftBody")}</p>
        <Link href="/" className="w-fit rounded-sm underline underline-offset-4">{t("back")}</Link>
      </section>
    </main>
  );
}
