"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import type { EditState } from "@/lib/edit-state";
import { requestRender, saveEdit } from "./actions";

type RenderInfo = { status: string; lastFailed: boolean; downloadUrl: string | null; cost: number; balance: number; hd: boolean };
type Props = { clipId: string; bounds: { start: number; end: number }; initial: EditState; previewUrl: string | null; hasVision: boolean; canEdit: boolean; render: RenderInfo };
type Word = EditState["captions"]["words"][number];

const field = "min-h-11 rounded-[var(--r-sm)] border border-border bg-surface px-3";
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Same grouping as worker/render.py `group_lines`, so the overlay matches the final burn-in. */
function lineAt(words: Word[], t: number): { line: Word[]; active: number } | null {
  let cur: Word[] = [];
  const lines: Word[][] = [];
  for (const w of words) {
    const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    if (cur.length && (cur.length >= 3 || len > 18 || w.s - cur.at(-1)!.e > 0.6)) { lines.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  const line = lines.find((l) => t >= l[0]!.s && t <= l.at(-1)!.e);
  return line ? { line, active: line.findIndex((w, i) => t >= w.s && t < (line[i + 1]?.s ?? line.at(-1)!.e + 0.01)) } : null;
}

export function Editor({ clipId, bounds, initial, previewUrl, hasVision, canEdit, render }: Props) {
  const t = useTranslations("editor");
  const router = useRouter();
  const [state, setState] = useState<EditState>(initial);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const [now, setNow] = useState(bounds.start);
  const video = useRef<HTMLVideoElement>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const first = useRef(true);

  // Autosave 800 ms after the last change; the server re-validates everything.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!canEdit) return;
    setSave("saving");
    const id = setTimeout(async () => {
      const r = await saveEdit(clipId, state);
      setSave(r.ok ? "saved" : { error: t(`errors.${r.error}`) });
    }, 800);
    return () => clearTimeout(id);
  }, [state, clipId, canEdit, t]);

  const set = <K extends keyof EditState>(k: K, v: EditState[K]) => setState((s) => ({ ...s, [k]: v }));
  const style = state.captions.style;
  const setStyle = (patch: Partial<typeof style>) => set("captions", { ...state.captions, style: { ...style, ...patch } });
  const setWord = (i: number, patch: Partial<Word>) =>
    set("captions", { ...state.captions, words: state.captions.words.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const seek = (srcT: number) => { if (video.current) video.current.currentTime = Math.max(0, srcT - bounds.start); };

  const visibleWords = useMemo(() => state.captions.words.filter((w) => w.s >= state.trim.start && w.e <= state.trim.end), [state]);
  const cue = state.captions.enabled && now >= state.trim.start && now <= state.trim.end ? lineAt(visibleWords, now) : null;
  const pos = { bottom: "bottom-[18%]", center: "top-1/2 -translate-y-1/2", top: "top-[10%]" }[style.position];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col gap-3">
        <div className="relative overflow-hidden rounded-[var(--r-md)] bg-black">
          {previewUrl && (
            <video ref={video} src={previewUrl} controls preload="metadata" className="aspect-video w-full"
              onTimeUpdate={(e) => setNow(bounds.start + e.currentTarget.currentTime)} />
          )}
          {cue && (
            <p aria-hidden className={`pointer-events-none absolute inset-x-4 text-center font-black ${pos}`}
              style={{ color: style.color, fontSize: `${style.size / 4}px`, textShadow: "0 0 4px #000, 0 0 4px #000" }}>
              {cue.line.map((w, i) => (
                <span key={i} style={i === cue.active || w.emphasis ? { color: style.highlight } : undefined}>
                  {(style.uppercase ? w.w.toUpperCase() : w.w) + " "}
                </span>
              ))}
            </p>
          )}
        </div>
        <p className="text-sm text-muted">{t("previewNote")}</p>
        <RenderPanel clipId={clipId} info={render} canEdit={canEdit} saving={save === "saving"} onRendered={() => router.refresh()} />
      </section>

      <fieldset disabled={!canEdit} className="flex flex-col gap-8">
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {save === "saving" ? t("saving") : save === "saved" ? t("saved") : typeof save === "object" ? t("saveError", { reason: save.error }) : ""}
        </p>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("trim")}</h2>
          <div className="flex flex-wrap items-end gap-3">
            {(["start", "end"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-sm">{t(k)}
                <input type="number" step={0.1} min={bounds.start} max={bounds.end} value={round1(state.trim[k])} className={`${field} w-28`}
                  onChange={(e) => set("trim", { ...state.trim, [k]: Math.min(bounds.end, Math.max(bounds.start, Number(e.target.value))) })} />
              </label>
            ))}
            <button type="button" className={field} onClick={() => set("trim", { ...state.trim, start: round1(now) })}>{t("setStart")}</button>
            <button type="button" className={field} onClick={() => set("trim", { ...state.trim, end: round1(now) })}>{t("setEnd")}</button>
          </div>
          <p className="text-sm text-muted">{t("duration", { seconds: round1(state.trim.end - state.trim.start) })}</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("captions")}</h2>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={state.captions.enabled} onChange={(e) => set("captions", { ...state.captions, enabled: e.target.checked })} />
            {t("captionsEnabled")}
          </label>
          <p className="text-sm text-muted">{t("wordsHelp")}</p>
          <ol className="flex flex-wrap gap-2">
            {state.captions.words.map((w, i) => (w.s < state.trim.start || w.e > state.trim.end ? null : (
              <li key={i} className={`flex items-center rounded-[var(--r-sm)] border ${now >= w.s && now < w.e ? "border-primary" : "border-border"}`}>
                <input ref={(el) => { inputs.current[i] = el; }} aria-label={t("word", { n: i + 1 })} value={w.w} maxLength={40}
                  size={Math.max(2, w.w.length)} className="min-h-10 bg-transparent px-2"
                  onFocus={() => seek(w.s)}
                  onChange={(e) => e.target.value.trim() && setWord(i, { w: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); inputs.current.slice(i + 1).find(Boolean)?.focus(); } }} />
                <button type="button" aria-pressed={!!w.emphasis} aria-label={`${t("emphasis")} — ${w.w}`} onClick={() => setWord(i, { emphasis: !w.emphasis })}
                  className={`min-h-10 px-2 text-sm ${w.emphasis ? "text-primary" : "text-muted"}`}>★</button>
              </li>
            )))}
          </ol>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">{t("style")}</h2>
          <label className="flex flex-col gap-1 text-sm">{t("presetLabel")}
            <select value={style.preset} onChange={(e) => setStyle({ preset: e.target.value as typeof style.preset })} className={field}>
              {(["bold", "clean", "karaoke"] as const).map((p) => <option key={p} value={p}>{t(`preset.${p}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">{t("positionLabel")}
            <select value={style.position} onChange={(e) => setStyle({ position: e.target.value as typeof style.position })} className={field}>
              {(["bottom", "center", "top"] as const).map((p) => <option key={p} value={p}>{t(`position.${p}`)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} />{t("color")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="color" value={style.highlight} onChange={(e) => setStyle({ highlight: e.target.value })} />{t("highlight")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} />{t("uppercase")}</label>
          <label className="flex flex-col gap-1 text-sm">{t("size")}
            <input type="range" min={40} max={120} value={style.size} onChange={(e) => setStyle({ size: Number(e.target.value) })} />
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("crop")}</h2>
          {!hasVision && <p className="text-sm text-muted">{t("noVision")}</p>}
          <div role="radiogroup" aria-label={t("crop")} className="flex flex-wrap gap-4">
            {(["auto", "center", "manual"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="crop" checked={state.crop.mode === m} disabled={m === "auto" && !hasVision} onChange={() => set("crop", { ...state.crop, mode: m })} />
                {t(`cropMode.${m}`)}
              </label>
            ))}
          </div>
          {state.crop.mode === "manual" && (
            <label className="flex flex-col gap-1 text-sm">{t("cropX")}
              <input type="range" min={0} max={1} step={0.01} value={state.crop.x} onChange={(e) => set("crop", { ...state.crop, x: Number(e.target.value) })} />
            </label>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("music")}</h2>
          <p className="text-sm text-muted">{t("musicUnavailable")}</p>
        </section>
      </fieldset>
    </div>
  );
}

function RenderPanel({ clipId, info, canEdit, saving, onRendered }: { clipId: string; info: RenderInfo; canEdit: boolean; saving: boolean; onRendered: () => void }) {
  const t = useTranslations("editor");
  const [key, setKey] = useState(() => crypto.randomUUID()); // one render per click sequence
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rendering = info.status === "rendering";

  // While a render runs, refresh the server page every 5 s to pick up the real status.
  useEffect(() => {
    if (!rendering) return;
    const id = setInterval(onRendered, 5000);
    return () => clearInterval(id);
  }, [rendering, onRendered]);

  const go = () => start(async () => {
    setError(null);
    const r = await requestRender(clipId, key);
    if (!r.ok) setError(t(`errors.${r.error}`));
    setKey(crypto.randomUUID());
    onRendered();
  });

  return (
    <section aria-labelledby="render-title" className="flex flex-col gap-2 rounded-[var(--r-md)] bg-surface p-4">
      <h2 id="render-title" className="font-semibold">{t("renderTitle")}</h2>
      <p className="text-sm">{t("cost", { quality: t(info.hd ? "qualityHd" : "qualitySd"), credits: info.cost })}</p>
      <p className="text-sm text-muted">{t("balance", { credits: info.balance })}</p>
      {info.lastFailed && !rendering && <p className="text-sm text-danger">{t("failed")}</p>}
      <div role="status" aria-live="polite" className="text-sm">
        {rendering ? t("rendering") : info.downloadUrl ? t("rendered") : null}
        {error && <span className="text-danger">{error}</span>}
      </div>
      <div className="flex flex-wrap gap-3">
        {canEdit && (
          <button type="button" disabled={pending || rendering || saving || info.balance < info.cost} onClick={go}
            className="min-h-11 rounded-[var(--r-full)] bg-primary px-5 font-semibold text-on-primary disabled:opacity-50">{t("renderBtn")}</button>
        )}
        {info.downloadUrl && <a href={info.downloadUrl} className="min-h-11 rounded-[var(--r-full)] border border-border px-5 py-2.5">{t("download")}</a>}
        {info.balance < info.cost && <Link href="/billing" className="self-center text-sm underline">{t("buyCredits")}</Link>}
      </div>
    </section>
  );
}
