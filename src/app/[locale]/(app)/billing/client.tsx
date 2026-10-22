"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { cancelSubscription, requestWithdrawal, startCheckout } from "./actions";

type PlanCard = { id: "starter" | "pro" | "agency"; name: string; credits: number; month: string; year: string };

/** No interval is preselected: the user must pick monthly or yearly explicitly. */
export function PlanPicker({ plans }: { plans: PlanCard[] }) {
  const t = useTranslations("billing");
  const [interval, setInterval] = useState<"month" | "year" | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t("choosePlan")}</h2>
      <fieldset className="flex gap-4">
        <legend className="mb-2 text-sm text-muted">{t("interval")}</legend>
        {(["month", "year"] as const).map((i) => (
          <label key={i} className="flex items-center gap-2">
            <input type="radio" name="interval" value={i} checked={interval === i} onChange={() => { setInterval(i); setMissing(false); }} />
            {t(i === "month" ? "monthly" : "yearly")}
          </label>
        ))}
      </fieldset>
      {missing && <p role="alert" className="text-danger">{t("pickInterval")}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-[var(--r-md)] bg-surface p-5">
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <p>{interval === "year" ? t("perYear", { price: p.year }) : t("perMonth", { price: p.month })}</p>
            <p className="text-sm text-muted">{t("credits", { n: p.credits })}</p>
            <button type="button" disabled={pending}
              onClick={() => (interval ? start(() => startCheckout({ plan: p.id, interval })) : setMissing(true))}
              className="mt-auto min-h-11 rounded-[var(--r-full)] bg-primary font-semibold text-on-primary disabled:opacity-60">{t("subscribe")}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Résilier" → one confirmation screen. Native <dialog> gives focus trapping and Esc. */
export function CancelSubscription() {
  const t = useTranslations("billing");
  const ref = useRef<HTMLDialogElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: typeof cancelSubscription | typeof requestWithdrawal, okKey: "cancelled" | "withdrawalDone") =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? t(okKey) : t(`errors.${r.error}`));
      ref.current?.close();
    });
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="min-h-11 rounded-[var(--r-full)] border border-danger px-5 text-danger">{t("cancel")}</button>
      <dialog ref={ref} aria-labelledby="cancel-title" className="m-auto max-w-md rounded-[var(--r-md)] bg-surface p-6 text-text backdrop:bg-black/60">
        <h2 id="cancel-title" className="text-xl font-semibold">{t("cancelTitle")}</h2>
        <p className="mt-3 text-muted">{t("cancelBody")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" disabled={pending} onClick={() => run(cancelSubscription, "cancelled")} className="min-h-11 rounded-[var(--r-full)] bg-danger px-5 font-semibold text-bg">{t("cancelConfirm")}</button>
          <button type="button" autoFocus onClick={() => ref.current?.close()} className="min-h-11 rounded-[var(--r-full)] border border-border px-5">{t("keep")}</button>
        </div>
        <hr className="my-5 border-border" />
        <button type="button" disabled={pending} onClick={() => run(requestWithdrawal, "withdrawalDone")} className="text-sm underline">{t("withdrawal")}</button>
        <p className="mt-1 text-xs text-muted">{t("withdrawalHelp")}</p>
      </dialog>
      <p role="status" aria-live="polite">{msg}</p>
    </>
  );
}
