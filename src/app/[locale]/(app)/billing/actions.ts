"use server";

import { and, count, eq, gte } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, jobs, workspaces } from "@/db/schema";
import { env } from "@/lib/env";
import { CREDIT_PACKS, stripeLookupKey, withdrawalEligible } from "@/lib/pricing";
import { emailWorkspaceOwner, stripe } from "@/lib/stripe";
import { requireWorkspace } from "@/lib/workspace";

async function ensureCustomer() {
  const { user, workspace } = await requireWorkspace("owner");
  if (workspace.stripeCustomerId) return { user, workspace, customer: workspace.stripeCustomerId };
  const c = await stripe.customers.create(
    { email: user.email, name: workspace.name, metadata: { workspaceId: workspace.id } },
    { idempotencyKey: `customer:${workspace.id}` },
  );
  await db.update(workspaces).set({ stripeCustomerId: c.id }).where(eq(workspaces.id, workspace.id));
  return { user, workspace, customer: c.id };
}

const checkoutInput = z.object({
  plan: z.enum(["starter", "pro", "agency"]),
  // No default: the interval must be chosen explicitly in the UI.
  interval: z.enum(["month", "year"]),
});

export async function startCheckout(input: z.input<typeof checkoutInput>) {
  const { plan, interval } = checkoutInput.parse(input);
  const { workspace, customer } = await ensureCustomer();
  if (workspace.stripeSubscriptionId) redirect("/billing?error=already_subscribed");
  const prices = await stripe.prices.list({ lookup_keys: [stripeLookupKey(plan, interval)], active: true });
  if (!prices.data[0]) throw new Error("price_not_configured");
  const s = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: prices.data[0].id, quantity: 1 }],
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    success_url: `${env.APP_URL}/billing?checkout=success`,
    cancel_url: `${env.APP_URL}/pricing`,
  });
  redirect(s.url!);
}

export async function buyPack(pack: keyof typeof CREDIT_PACKS) {
  const p = CREDIT_PACKS[z.enum(Object.keys(CREDIT_PACKS) as [keyof typeof CREDIT_PACKS]).parse(pack)];
  const { customer } = await ensureCustomer();
  const s = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{ price_data: { currency: "eur", unit_amount: p.cents, tax_behavior: "inclusive", product_data: { name: `Shrunk — ${p.credits} crédits` } }, quantity: 1 }],
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    invoice_creation: { enabled: true },
    metadata: { pack },
    success_url: `${env.APP_URL}/billing?pack=success`,
    cancel_url: `${env.APP_URL}/billing`,
  });
  redirect(s.url!);
}

export async function openPortal() {
  const { customer } = await ensureCustomer();
  const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${env.APP_URL}/billing` });
  redirect(s.url);
}

/** "Résilier": effective at period end, confirmed by email. One confirmation screen in the UI. */
export async function cancelSubscription() {
  const { user, workspace } = await requireWorkspace("owner");
  if (!workspace.stripeSubscriptionId) return { ok: false as const, error: "no_subscription" };
  const sub = await stripe.subscriptions.update(workspace.stripeSubscriptionId, { cancel_at_period_end: true });
  const end = new Date((sub.items.data[0]?.current_period_end ?? 0) * 1000);
  await db.update(workspaces).set({ cancelAtPeriodEnd: true }).where(eq(workspaces.id, workspace.id));
  await db.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "billing.cancel", target: sub.id });
  await emailWorkspaceOwner(db, workspace.id, "cancelConfirmed", { date: end.toISOString().slice(0, 10) });
  return { ok: true as const, endsAt: end.toISOString() };
}

/** Rétractation 14 j: refund the first payment and end the subscription now. */
export async function requestWithdrawal() {
  const { user, workspace } = await requireWorkspace("owner");
  if (!workspace.stripeSubscriptionId) return { ok: false as const, error: "no_subscription" };
  const sub = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId);
  const since = new Date(sub.start_date * 1000);
  const [renders] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspace.id), eq(jobs.type, "render"), eq(jobs.status, "succeeded"), gte(jobs.createdAt, since)));
  if (!withdrawalEligible(since, new Date(), renders?.n ?? 0)) return { ok: false as const, error: "not_eligible" };

  const [invoice] = (await stripe.invoices.list({ subscription: sub.id, status: "paid", limit: 1 })).data;
  const [payment] = invoice ? (await stripe.invoicePayments.list({ invoice: invoice.id!, limit: 1 })).data : [];
  const pi = payment?.payment.payment_intent;
  if (pi) await stripe.refunds.create({ payment_intent: typeof pi === "string" ? pi : pi.id }, { idempotencyKey: `withdrawal:${sub.id}` });
  await stripe.subscriptions.cancel(sub.id); // subscription.deleted webhook downgrades the plan
  await db.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "billing.withdrawal", target: sub.id });
  await emailWorkspaceOwner(db, workspace.id, "withdrawalConfirmed");
  return { ok: true as const };
}
