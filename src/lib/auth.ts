import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "./env";
import { sendEmail } from "./email";
import { createPersonalWorkspace } from "./workspace";

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema: { users: schema.users, sessions: schema.sessions, accounts: schema.accounts, verifications: schema.verifications },
  }),
  user: {
    additionalFields: {
      locale: { type: "string", defaultValue: "fr", input: false },
      termsAcceptedAt: { type: "date", required: false, input: false },
    },
  },
  socialProviders: {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  },
  databaseHooks: {
    user: { create: { after: async (user) => { await createPersonalWorkspace(user.id, user.name || user.email); } } },
  },
  plugins: [
    magicLink({
      expiresIn: 600,
      sendMagicLink: async ({ email, url }) => {
        const t = await getTranslations("email.magicLink");
        await sendEmail(email, t("subject"), t("body", { url }));
      },
    }),
    nextCookies(),
  ],
});

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
