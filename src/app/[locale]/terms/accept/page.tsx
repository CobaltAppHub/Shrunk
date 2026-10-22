import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic"; // per-user page, never prerendered

const TERMS_VERSION = "2026-10-22";

async function accept(form: FormData) {
  "use server";
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (form.get("terms") !== "on") redirect("/terms/accept?error=required"); // explicit consent only
  await db.update(users).set({ termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION }).where(eq(users.id, session.user.id));
  redirect("/billing");
}

export default async function AcceptTerms({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations("terms");
  const { error } = await searchParams;
  const link = (href: string) => function Link(chunks: React.ReactNode) { return <a href={href} target="_blank" className="underline">{chunks}</a>; };
  return (
    <form action={accept} className="mx-auto flex max-w-md flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="terms" required className="mt-1 size-5" aria-describedby={error ? "terms-error" : undefined} />
        <span>{t.rich("checkbox", { cgv: link("/legal/cgv"), privacy: link("/legal/privacy") })}</span>
      </label>
      {error && <p id="terms-error" role="alert" className="text-danger">{t("required")}</p>}
      <button type="submit" className="min-h-12 rounded-[var(--r-full)] bg-primary font-semibold text-on-primary">{t("accept")}</button>
    </form>
  );
}
