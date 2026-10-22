import { db } from "@/db";
import { env } from "@/lib/env";
import { stripe, stripeDeps } from "@/lib/stripe";
import { applyStripeEvent } from "@/lib/stripe-webhook";

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });
  let event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), sig, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  // Throwing → 500 → Stripe retries; the event row was rolled back with the effects.
  const result = await applyStripeEvent(db, event, stripeDeps);
  return Response.json({ result });
}
