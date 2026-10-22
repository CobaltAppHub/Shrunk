import { getTranslations } from "next-intl/server";
import { requireWorkspace } from "@/lib/workspace";
import { NewProject } from "./client";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ url?: string; tab?: string }> }) {
  await requireWorkspace("editor");
  const t = await getTranslations("newProject");
  const { url, tab } = await searchParams;
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      {/* "Créer depuis une idée" arrives with J5 (faceless); not shown until it works. */}
      <NewProject initialUrl={url?.slice(0, 4096) ?? ""} initialTab={tab === "upload" ? "upload" : "link"} />
    </div>
  );
}
