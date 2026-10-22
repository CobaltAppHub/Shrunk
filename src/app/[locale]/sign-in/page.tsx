"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export default function SignIn() {
  const t = useTranslations("auth");
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  async function sendLink(form: FormData) {
    const { error } = await authClient.signIn.magicLink({ email: String(form.get("email")), callbackURL: "/billing" });
    setState(error ? "error" : "sent");
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <button type="button" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/billing" })}
        className="min-h-12 rounded-[var(--r-full)] border border-border bg-surface font-medium">{t("google")}</button>
      <form action={sendLink} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm">{t("emailLabel")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="min-h-12 rounded-[var(--r-sm)] border border-border bg-surface px-4" />
        <button type="submit" className="min-h-12 rounded-[var(--r-full)] bg-primary font-semibold text-on-primary">{t("sendLink")}</button>
      </form>
      <p role="status" aria-live="polite" className={state === "error" ? "text-danger" : "text-muted"}>
        {state === "sent" ? t("linkSent") : state === "error" ? t("error") : ""}
      </p>
    </div>
  );
}
