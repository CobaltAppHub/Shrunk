"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { visibleDays } from "@/publish/slots";
import { cancelAction, moveAction, retryAction } from "./actions";

type Post = {
  id: string; at: string; status: "scheduled" | "publishing" | "published" | "failed" | "draft_sent" | "cancelled";
  error: string | null; externalPostId: string | null; platform: "tiktok" | "youtube" | "instagram"; account: string;
  clipTitle: string | null; clipId: string; projectId: string;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const KNOWN_ERRORS = ["uncertain_state", "account_disconnected", "quota_wait", "platform_timeout", "not_rendered"] as const;

export function Calendar({ view, anchor, posts, canEdit, preview = false }: { preview?: boolean; view: "week" | "month"; anchor: string; posts: Post[]; canEdit: boolean }) {
  const t = useTranslations("calendar");
  const f = useFormatter();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const days = visibleDays(view, anchor);
  const byDay = new Map<string, Post[]>();
  for (const p of [...posts].sort((a, b) => a.at.localeCompare(b.at))) {
    const k = dayKey(new Date(p.at));
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const calendarHref = (v: string, d?: string) => `${preview ? "/preview?screen=calendar&" : "/calendar?"}view=${v}${d ? `&d=${d}` : ""}`;
  const shift = (n: number) => {
    const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
    const next = view === "week" ? new Date(y, m - 1, d + 7 * n) : new Date(y, m - 1 + n, 1);
    return calendarHref(view, dayKey(next));
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? null : t(`errors.${r.error as "not_editable"}`));
    router.refresh();
  });
  // Dropping on a day keeps the post's local time of day.
  const moveTo = (post: Post, day: Date) => {
    const old = new Date(post.at);
    const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    if (dayKey(when) !== dayKey(old)) run(() => moveAction(post.id, when.toISOString()));
  };

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-2" aria-label={t("title")}>
        <Link href={shift(-1)} className="min-h-11 rounded-[var(--r-full)] border border-border px-4 py-2.5">{t("prev")}</Link>
        <Link href={calendarHref(view)} className="min-h-11 rounded-[var(--r-full)] border border-border px-4 py-2.5">{t("today")}</Link>
        <Link href={shift(1)} className="min-h-11 rounded-[var(--r-full)] border border-border px-4 py-2.5">{t("next")}</Link>
        <span className="mx-2 font-semibold">{f.dateTime(days[view === "week" ? 0 : 7]!, view === "week" ? { day: "numeric", month: "long", year: "numeric" } : { month: "long", year: "numeric" })}</span>
        <Link href={calendarHref("week", anchor)} aria-current={view === "week" ? "page" : undefined} className="min-h-11 rounded-[var(--r-full)] px-4 py-2.5 aria-[current=page]:bg-surface">{t("week")}</Link>
        <Link href={calendarHref("month", anchor)} aria-current={view === "month" ? "page" : undefined} className="min-h-11 rounded-[var(--r-full)] px-4 py-2.5 aria-[current=page]:bg-surface">{t("month")}</Link>
      </nav>
      {canEdit && <p className="text-sm text-muted">{t("dragHelp")}</p>}
      <p role="status" aria-live="polite" className="text-sm text-danger">{msg}</p>
      {posts.length === 0 && <p className="text-muted">{t("empty")}</p>}

      <ol className={`grid gap-2 ${view === "week" ? "grid-cols-1 md:grid-cols-7" : "grid-cols-1 sm:grid-cols-7"}`}>
        {days.map((day) => {
          const list = byDay.get(dayKey(day)) ?? [];
          const outside = view === "month" && day.getMonth() !== days[7]!.getMonth();
          return (
            <li key={dayKey(day)} className={`flex min-h-24 flex-col gap-1 rounded-[var(--r-sm)] border border-border p-2 ${outside ? "opacity-50" : ""} ${list.length === 0 && view === "month" ? "max-sm:hidden" : ""}`}
              onDragOver={(e) => canEdit && e.preventDefault()}
              onDrop={(e) => { const p = posts.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (p) moveTo(p, day); }}>
              <p className="text-xs font-semibold">{f.dateTime(day, { weekday: "short", day: "numeric" })}</p>
              {list.map((p) => <PostChip key={p.id} post={p} canEdit={canEdit} pending={pending} run={run} />)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PostChip({ post, canEdit, pending, run }: { post: Post; canEdit: boolean; pending: boolean; run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void }) {
  const t = useTranslations("calendar");
  const ta = useTranslations("accounts");
  const tsch = useTranslations("schedule");
  const f = useFormatter();
  const [when, setWhen] = useState(toLocalInput(new Date(post.at)));
  const movable = canEdit && post.status === "scheduled";
  const errorKey = KNOWN_ERRORS.find((k) => k === post.error);
  const color = { scheduled: "border-border", publishing: "border-primary", published: "border-primary", draft_sent: "border-primary", failed: "border-danger", cancelled: "border-border opacity-60" }[post.status];

  return (
    <details className={`rounded-[var(--r-sm)] border-l-4 bg-surface text-sm ${color}`} draggable={movable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", post.id)}>
      <summary className="cursor-pointer list-none p-2">
        <span className="font-medium">{f.dateTime(new Date(post.at), { hour: "2-digit", minute: "2-digit" })}</span> {ta(`platforms.${post.platform}`)}
        <span className="block truncate text-xs text-muted">{post.clipTitle} · {t(`status.${post.status}`)}</span>
      </summary>
      <div className="flex flex-col gap-2 p-2 pt-0">
        <p className="text-xs">{post.account}</p>
        {post.status === "draft_sent" && <p className="text-xs text-muted">{t("draftNote")}</p>}
        {post.error && post.status !== "published" && (
          <p className="text-xs text-danger">{errorKey ? t(`postError.${errorKey}`) : t("postError.other", { detail: post.error })}</p>
        )}
        <Link href={`/projects/${post.projectId}/clips/${post.clipId}`} className="text-xs underline">{post.clipTitle}</Link>
        {movable && (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => moveAction(post.id, new Date(when).toISOString())); }}>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={tsch("when")} className="min-h-10 rounded-[var(--r-sm)] border border-border bg-bg px-2" />
            <div className="flex flex-wrap gap-2">
              <button disabled={pending} className="min-h-10 rounded-[var(--r-full)] bg-primary px-3 font-semibold text-on-primary">{t("save")}</button>
              <button type="button" disabled={pending} onClick={() => run(() => cancelAction(post.id))} className="min-h-10 rounded-[var(--r-full)] border border-border px-3">{t("cancelPost")}</button>
            </div>
          </form>
        )}
        {canEdit && post.status === "failed" && post.error !== "uncertain_state" && (
          <button type="button" disabled={pending} onClick={() => run(() => retryAction(post.id))} className="min-h-10 self-start rounded-[var(--r-full)] border border-border px-3">{t("retry")}</button>
        )}
      </div>
    </details>
  );
}
