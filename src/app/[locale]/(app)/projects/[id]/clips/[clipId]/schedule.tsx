"use client";

import { useMemo, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { freeSlots } from "@/publish/slots";
import { schedule } from "./actions";

export type PublishInfo = {
  autoPublish: boolean;
  tiktokDraft: boolean;
  defaultCaption: string;
  accounts: { id: string; platform: "tiktok" | "youtube" | "instagram"; name: string }[];
  booked: string[]; // ISO times already scheduled on this workspace's accounts
};

const field = "min-h-11 rounded-[var(--r-sm)] border border-border bg-bg px-3";
/** <input type="datetime-local"> value in the viewer's time zone. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ScheduleForm({ clipId, info }: { clipId: string; info: PublishInfo }) {
  const t = useTranslations("schedule");
  const ta = useTranslations("accounts");
  const f = useFormatter();
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState(info.defaultCaption);
  const [when, setWhen] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const slots = useMemo(() => freeSlots(new Date(), info.booked.map((b) => new Date(b)), [12, 18, 20], 3, new Date().getTimezoneOffset()), [info.booked]);

  if (!info.autoPublish) return <Link href="/billing" className="text-sm underline">{t("upgrade")}</Link>;
  if (!info.accounts.length) return <p className="text-sm">{t("noAccounts")} <Link href="/accounts" className="underline">{t("manage")}</Link></p>;

  const platforms = new Set(info.accounts.filter((a) => selected.includes(a.id)).map((a) => a.platform));
  const submit = (now: boolean) => start(async () => {
    setMsg(null);
    const r = await schedule({
      clipId, accountIds: selected, caption, youtubePrivacy: privacy, idempotencyKey: key,
      scheduledAt: now ? new Date() : new Date(when),
    });
    if (r.ok) { setMsg({ ok: true, text: t("done", { n: r.postIds.length }) }); setKey(crypto.randomUUID()); }
    else setMsg({ ok: false, text: t(`errors.${r.error}`) });
  });

  return (
    <section aria-labelledby="schedule-title" className="flex flex-col gap-3 rounded-[var(--r-md)] bg-surface p-4">
      <h2 id="schedule-title" className="font-semibold">{t("title")}</h2>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm text-muted">{t("accounts")}</legend>
        {info.accounts.map((a) => (
          <label key={a.id} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(a.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} />
            {ta(`platforms.${a.platform}`)} — {a.name}
          </label>
        ))}
      </fieldset>
      {platforms.has("tiktok") && info.tiktokDraft && <p className="text-sm text-muted">{t("tiktokDraft")}</p>}
      {platforms.has("youtube") && (
        <label className="flex flex-col gap-1 text-sm">{t("youtubePrivacy")}
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)} className={field}>
            {(["public", "unlisted", "private"] as const).map((p) => <option key={p} value={p}>{t(`privacy.${p}`)}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">{t("caption")}
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} maxLength={5000} className={`${field} py-2`} aria-describedby="caption-count" />
        <span id="caption-count" className="text-xs text-muted">{t("captionCount", { n: caption.length })}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">{t("when")}
        <input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} className={field} />
      </label>
      <div className="flex flex-col gap-1">
        <p className="text-sm">{t("slots")}</p>
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <button key={s.toISOString()} type="button" onClick={() => setWhen(toLocalInput(s))} aria-pressed={when === toLocalInput(s)}
              className="min-h-10 rounded-[var(--r-full)] border border-border px-3 text-sm aria-pressed:border-primary">
              {f.dateTime(s, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{t("slotsNote")}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending || !selected.length || !when} onClick={() => submit(false)}
          className="min-h-11 rounded-[var(--r-full)] bg-primary px-5 font-semibold text-on-primary disabled:opacity-50">{t("submit")}</button>
        <button type="button" disabled={pending || !selected.length} onClick={() => submit(true)}
          className="min-h-11 rounded-[var(--r-full)] border border-border px-5 disabled:opacity-50">{t("submitNow")}</button>
      </div>
      <p role="status" aria-live="polite" className={`text-sm ${msg && !msg.ok ? "text-danger" : ""}`}>
        {msg?.text} {msg?.ok && <Link href="/calendar" className="underline">{t("seeCalendar")}</Link>}
      </p>
    </section>
  );
}
