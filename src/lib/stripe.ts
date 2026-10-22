import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { Db } from "@/db";
import { users, workspaces } from "@/db/schema";
import { env } from "./env";
import { sendEmail } from "./email";
import type { Deps } from "./stripe-webhook";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export async function emailWorkspaceOwner(db: Db, workspaceId: string, key: string, values: Record<string, string> = {}) {
  const [owner] = await db
    .select({ email: users.email, locale: users.locale })
    .from(workspaces)
    .innerJoin(users, eq(users.id, workspaces.ownerId))
    .where(eq(workspaces.id, workspaceId));
  if (!owner) return;
  const t = await getTranslations({ locale: owner.locale, namespace: `email.${key}` });
  await sendEmail(owner.email, t("subject"), t("body", values));
}

export const stripeDeps: Deps = {
  lookupKeyOf: async (id) => (await stripe.subscriptions.retrieve(id)).items.data[0]?.price.lookup_key ?? null,
  notify: (db, e) => emailWorkspaceOwner(db, e.workspaceId, "annualRenewal", { date: e.renewsAt.toISOString().slice(0, 10) }),
};
