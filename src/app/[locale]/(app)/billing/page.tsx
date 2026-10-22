import { desc, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { db } from "@/db";
import { creditLedger } from "@/db/schema";
import { getBalance } from "@/lib/credits";
import { CREDIT_PACKS, PLANS, yearlyCents, type PackId } from "@/lib/pricing";
import { requireWorkspace } from "@/lib/workspace";
import { buyPack, openPortal } from "./actions";
import { CancelSubscription, PlanPicker } from "./client";

export const dynamic = "force-dynamic"; // per-user page, never prerendered

const ERRORS = ["not_eligible", "no_subscription", "already_subscribed"] as const;

export default async function Billing({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { workspace, role } = await requireWorkspace("viewer");
  const t = await getTranslations("billing");
  const tp = await getTranslations("plans");
  const f = await getFormatter();
  const { error } = await searchParams;
  const eur = (cents: number) => f.number(cents / 100, { style: "currency", currency: "EUR" });
  const [balance, entries] = await Promise.all([
    getBalance(db, workspace.id),
    db.select().from(creditLedger).where(eq(creditLedger.workspaceId, workspace.id)).orderBy(desc(creditLedger.createdAt)).limit(100),
  ]);
  const owner = role === "owner";
  const paid = workspace.plan !== "free" && !!workspace.stripeSubscriptionId;
  const shownError = ERRORS.find((e) => e === error);

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      {shownError && <p role="alert" className="text-danger">{t(`errors.${shownError}`)}</p>}

      <section className="rounded-[var(--r-md)] bg-surface p-6">
        <p className="text-2xl font-semibold">{t("balance", { credits: balance })}</p>
        <p className="mt-2 text-sm text-muted">{t("expiry")}</p>
        <p className="mt-4">{t("plan", { plan: tp(workspace.plan) })}</p>
        {workspace.currentPeriodEnd && (
          <p className="text-sm text-muted">
            {t(workspace.cancelAtPeriodEnd ? "endsAt" : "renews", { date: f.dateTime(workspace.currentPeriodEnd, { dateStyle: "long" }) })}
          </p>
        )}
        {owner && (
          <div className="mt-6 flex flex-wrap gap-3">
            {workspace.stripeCustomerId && (
              <form action={openPortal}><button className="min-h-11 rounded-[var(--r-full)] border border-border px-5">{t("invoices")}</button></form>
            )}
            {paid && !workspace.cancelAtPeriodEnd && <CancelSubscription />}
          </div>
        )}
      </section>

      {owner && !paid && (
        <PlanPicker plans={(["starter", "pro", "agency"] as const).map((id) => ({
          id, name: tp(id), credits: PLANS[id].monthlyCredits, month: eur(PLANS[id].monthlyCents), year: eur(yearlyCents(id)),
        }))} />
      )}

      {owner && (
        <section className="flex flex-wrap gap-3">
          {(Object.keys(CREDIT_PACKS) as PackId[]).map((p) => (
            <form key={p} action={buyPack.bind(null, p)}>
              <button className="min-h-11 rounded-[var(--r-full)] border border-border px-5">{t("buyPack", { n: CREDIT_PACKS[p].credits, price: eur(CREDIT_PACKS[p].cents) })}</button>
            </form>
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xl font-semibold">{t("history")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className="py-2">{t("date")}</th><th>{t("type")}</th><th className="text-right">{t("change")}</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-2">{f.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{t(`kinds.${e.kind}`)}</td>
                  <td className="text-right tabular-nums">{e.delta > 0 ? `+${e.delta}` : e.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
