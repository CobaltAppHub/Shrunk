import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { Db } from "@/db";
import { auditLog, stripeEvents, workspaces } from "@/db/schema";
import { grant } from "./credits";
import { CREDIT_PACKS, PLANS, grantExpiry, type PackId, type PlanId } from "./pricing";

export type SideEffect = { kind: "annual_renewal_reminder"; workspaceId: string; renewsAt: Date };

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/**
 * Applies one Stripe event. The event row and every effect share one transaction:
 * a crash rolls everything back so Stripe's retry re-applies it, and a replay of a
 * committed event is skipped by the primary key. Emails are returned, sent after commit.
 */
export type Deps = {
  /** Plan lookup_key of a subscription ("pro_month"), fetched from Stripe: invoice.paid can arrive before subscription.created. */
  lookupKeyOf: (subscriptionId: string) => Promise<string | null>;
  notify: (db: Db, e: SideEffect) => Promise<void>;
};

export async function applyStripeEvent(db: Db, event: Stripe.Event, deps: Deps): Promise<"applied" | "duplicate" | "ignored"> {
  const effects: SideEffect[] = [];
  const result = await db.transaction(async (tx) => {
    const fresh = await tx.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
    if (!fresh.length) return "duplicate" as const;

    const wsByCustomer = async (customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) => {
      const id = typeof customer === "string" ? customer : customer?.id;
      if (!id) return undefined;
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.stripeCustomerId, id));
      return ws;
    };

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const ws = await wsByCustomer(s.customer);
        if (!ws) throw new Error(`unknown customer for ${s.id}`);
        if (s.mode === "payment" && s.payment_status === "paid") {
          const pack = CREDIT_PACKS[s.metadata?.pack as PackId];
          if (!pack) throw new Error(`unknown pack on ${s.id}`);
          await grant(tx, { workspaceId: ws.id, amount: pack.credits, key: `purchase:${s.id}`, reason: `pack ${s.metadata!.pack}`, expiresAt: null, kind: "purchase" });
        }
        return "applied" as const;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const ws = await wsByCustomer(sub.customer);
        if (!ws) throw new Error(`unknown customer for ${sub.id}`);
        const item = sub.items.data[0];
        const [plan, interval] = (item?.price.lookup_key ?? "free_month").split("_") as [PlanId, string];
        const active = event.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(sub.status);
        await tx.update(workspaces).set({
          plan: active && plan in PLANS ? plan : "free",
          stripeSubscriptionId: active ? sub.id : null,
          billingInterval: active ? interval : null,
          currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        }).where(eq(workspaces.id, ws.id));
        await tx.insert(auditLog).values({ workspaceId: ws.id, action: `billing.${event.type}`, target: sub.id, meta: { plan, status: sub.status } });
        return "applied" as const;
      }

      case "invoice.paid": {
        const inv = event.data.object;
        const sub = inv.parent?.subscription_details?.subscription;
        if (!sub) return "ignored" as const;
        const ws = await wsByCustomer(inv.customer);
        if (!ws) throw new Error(`unknown customer for ${inv.id}`);
        const plan = (await deps.lookupKeyOf(typeof sub === "string" ? sub : sub.id))?.split("_")[0] as PlanId | undefined;
        if (!plan || plan === "free" || !(plan in PLANS)) return "ignored" as const;
        // Same key as the monthly cron: whichever runs first grants this month, never both.
        const now = new Date(inv.created * 1000);
        await grant(tx, { workspaceId: ws.id, amount: PLANS[plan].monthlyCredits, key: `plan:${ws.id}:${monthKey(now)}`, reason: `${plan} monthly credits`, expiresAt: grantExpiry(now) });
        return "applied" as const;
      }

      case "invoice.upcoming": {
        // Stripe sends this N days before renewal (set N = 7 in Dashboard › Billing › Subscriptions).
        const inv = event.data.object;
        const ws = await wsByCustomer(inv.customer);
        if (ws?.billingInterval === "year" && inv.next_payment_attempt) {
          effects.push({ kind: "annual_renewal_reminder", workspaceId: ws.id, renewsAt: new Date(inv.next_payment_attempt * 1000) });
        }
        return "applied" as const;
      }

      default:
        return "ignored" as const;
    }
  });

  for (const e of effects) await deps.notify(db, e);
  return result;
}

