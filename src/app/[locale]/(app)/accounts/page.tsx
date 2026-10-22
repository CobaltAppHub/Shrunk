import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, socialAccounts } from "@/db/schema";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/pricing";
import { requireWorkspace } from "@/lib/workspace";
import { configuredPlatforms, tiktokDraftMode } from "@/publish";
import type { Platform } from "@/publish/types";

export const dynamic = "force-dynamic";

const ERRORS = ["unavailable", "plan_limit", "state", "denied", "connect_failed", "not_eligible"] as const;
const ALL: Platform[] = ["tiktok", "youtube", "instagram"];

async function disconnect(form: FormData) {
  "use server";
  const { user, workspace } = await requireWorkspace("editor");
  const id = z.uuid().parse(form.get("id"));
  // Tokens are wiped; the row stays for the history of posts made with it.
  await db.update(socialAccounts).set({ status: "revoked", accessTokenEnc: null, refreshTokenEnc: null })
    .where(and(eq(socialAccounts.id, id), eq(socialAccounts.workspaceId, workspace.id)));
  await db.insert(auditLog).values({ workspaceId: workspace.id, actorId: user.id, action: "social.disconnect", target: id });
  revalidatePath("/accounts");
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { workspace, role } = await requireWorkspace("viewer");
  const t = await getTranslations("accounts");
  const f = await getFormatter();
  const { error, connected } = await searchParams;
  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.workspaceId, workspace.id));
  const available = configuredPlatforms();
  const missing = ALL.filter((p) => !available.includes(p));
  const canEdit = role !== "viewer";
  const limit = PLANS[workspace.plan].socialAccounts;
  const shownError = ERRORS.find((e) => e === error);
  const shownConnected = ALL.find((p) => p === connected);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <div role="status" aria-live="polite">
        {shownError && <p className="text-danger">{t(`errors.${shownError}`)}</p>}
        {shownConnected && <p>{t("connected", { platform: t(`platforms.${shownConnected}`) })}</p>}
      </div>
      <p className="text-sm text-muted">{Number.isFinite(limit) ? t("planLimit", { n: limit }) : t("planUnlimited")}</p>

      {available.map((p) => {
        const list = accounts.filter((a) => a.platform === p && a.status !== "revoked");
        return (
          <section key={p} className="flex flex-col gap-3 rounded-[var(--r-md)] bg-surface p-5" aria-labelledby={`h-${p}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id={`h-${p}`} className="text-xl font-semibold">{t(`platforms.${p}`)}</h2>
              {canEdit && limit > 0 && (
                <a href={`/api/social/${p}/connect`} className="min-h-11 rounded-[var(--r-full)] bg-primary px-5 py-2.5 font-semibold text-on-primary">
                  {t("connect", { platform: t(`platforms.${p}`) })}
                </a>
              )}
            </div>
            <p className="text-sm text-muted">
              {p === "tiktok" && tiktokDraftMode() ? t("tiktokDraft") : p === "youtube" ? t("youtubeQuota", { n: env.YOUTUBE_DAILY_UPLOADS }) : p === "instagram" ? t("instagramNote") : null}
            </p>
            {list.length === 0 ? <p className="text-sm">{t("none")}</p> : (
              <ul className="flex flex-col gap-2">
                {list.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2">
                    <div>
                      <p className="font-medium">{a.displayName ?? a.externalId}</p>
                      <p className={`text-sm ${a.status === "connected" ? "text-primary" : "text-danger"}`}>{t(`status.${a.status as "connected" | "expired"}`)}</p>
                      {a.expiresAt && a.status === "connected" && <p className="text-xs text-muted">{t("expires", { date: f.dateTime(a.expiresAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>}
                      {a.lastError && <p className="text-xs text-muted">{t("lastError", { error: a.lastError })}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        {a.status === "expired" && <a href={`/api/social/${p}/connect`} className="min-h-11 rounded-[var(--r-full)] border border-border px-4 py-2.5 text-sm">{t("reconnect")}</a>}
                        <form action={disconnect}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="min-h-11 rounded-[var(--r-full)] border border-border px-4 text-sm">{t("disconnect")}</button>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {missing.length > 0 && <p className="text-sm text-muted">{t("unavailable", { list: missing.map((p) => t(`platforms.${p}`)).join(", ") })}</p>}
    </div>
  );
}
