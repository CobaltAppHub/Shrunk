"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import type { ImportErrorCode } from "@/sources/errors";
import type { Inspection } from "@/sources/types";
import { completeUpload, createUpload, inspectLink, startImport } from "./actions";

type Tab = "link" | "upload";
type Rights = { rightsBasis: "own" | "authorized" | "licensed"; licenseReference?: string; creditLine?: string; attested: true };
const btn = "min-h-11 rounded-[var(--r-full)] bg-primary px-6 font-semibold text-on-primary disabled:opacity-50";

export function NewProject({ initialUrl, initialTab }: { initialUrl: string; initialTab: Tab }) {
  const t = useTranslations("newProject");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [fromLink, setFromLink] = useState<{ url: string; info: Inspection } | null>(null);
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ link: null, upload: null });

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next: Tab = tab === "link" ? "upload" : "link";
    setTab(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label={t("title")} className="flex gap-2" onKeyDown={onKey}>
        {(["link", "upload"] as const).map((k) => (
          <button key={k} ref={(el) => { tabs.current[k] = el; }} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-[var(--r-full)] px-5 ${tab === k ? "bg-surface font-semibold" : "text-muted"}`}>
            {t(k === "link" ? "tabLink" : "tabUpload")}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "link"
          ? <LinkFlow initialUrl={initialUrl} onUploadInstead={(url, info) => { setFromLink(info ? { url, info } : null); setTab("upload"); }} />
          : <UploadFlow fromLink={fromLink} />}
      </div>
      <p className="text-sm text-muted">{t("freeNote")}</p>
    </div>
  );
}

function LinkFlow({ initialUrl, onUploadInstead }: { initialUrl: string; onUploadInstead: (url: string, info: Inspection | null) => void }) {
  const t = useTranslations("newProject");
  const te = useTranslations("import.errors");
  const ti = useTranslations("import");
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [info, setInfo] = useState<Inspection | null>(null);
  const [error, setError] = useState<ImportErrorCode | null>(null);
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID()); // one import per form, whatever the clicks

  const check = () => start(async () => {
    setInfo(null);
    setError(null);
    const r = await inspectLink(url);
    if (r.status === "error") setError(r.errorCode);
    else setInfo(r);
  });
  // Arriving from the landing page with ?url=…: check it right away.
  const auto = useRef(false);
  useEffect(() => { if (initialUrl && !auto.current) { auto.current = true; check(); } });

  const submit = (rights: Rights) => start(async () => {
    const r = await startImport({ url, ...rights, idempotencyKey: key });
    if (r.ok) router.push(`/projects/${r.projectId}`);
    else setError(r.errorCode);
  });

  const help = info?.status === "authentication_required" ? t("authHelp")
    : info?.status === "temporarily_unavailable" ? t("temporaryHelp")
    : info?.status === "unsupported" ? t("unsupportedHelp") : null;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => { e.preventDefault(); check(); }} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="link" className="sr-only">{t("linkLabel")}</label>
        <input id="link" type="url" required inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setInfo(null); setError(null); }}
          className="min-h-12 flex-1 rounded-[var(--r-full)] border border-border bg-surface px-5" />
        <button type="submit" disabled={pending || !url} className={btn}>{pending && !info ? t("checking") : t("check")}</button>
      </form>

      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        {error && <p className="text-danger">{te(error)}</p>}
        {info && info.status !== "supported" && (
          <>
            {info.errorCode && <p className={info.status === "temporarily_unavailable" ? "" : "text-danger"}>{te(info.errorCode)}</p>}
            {help && <p className="text-muted">{help}</p>}
          </>
        )}
      </div>

      {info && <SourceCard info={info} />}

      {info?.status === "temporarily_unavailable" && <button type="button" onClick={check} className="self-start underline">{t("retry")}</button>}
      {(error || (info && info.status !== "supported" && info.status !== "temporarily_unavailable")) && (
        <button type="button" onClick={() => onUploadInstead(url, info)} className="self-start underline">{ti("uploadInstead")}</button>
      )}

      {info?.status === "supported" && <RightsForm creator={info.creatorName} pending={pending} submitLabel={t(pending ? "starting" : "start")} onSubmit={submit} />}
    </div>
  );
}

function SourceCard({ info }: { info: Inspection }) {
  const t = useTranslations("newProject");
  const f = useFormatter();
  return (
    <section aria-label={t("source")} className="flex flex-col gap-4 rounded-[var(--r-md)] bg-surface p-5 sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element -- third-party thumbnail, not optimised by us */}
      {info.thumbnailUrl && <img src={info.thumbnailUrl} alt="" className="aspect-video w-full rounded-[var(--r-sm)] object-cover sm:w-56" referrerPolicy="no-referrer" />}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {info.title && <><dt className="text-muted">{t("source")}</dt><dd className="font-semibold">{info.title}</dd></>}
        <dt className="text-muted">{t("platform")}</dt><dd>{info.platform}</dd>
        {info.creatorName && <><dt className="text-muted">{t("creator")}</dt><dd>{info.creatorUrl ? <a href={info.creatorUrl} target="_blank" rel="noreferrer" className="underline">{info.creatorName}</a> : info.creatorName}</dd></>}
        {info.sizeBytes && <><dt className="text-muted">{t("size")}</dt><dd>{f.number(info.sizeBytes / 1e6, { style: "unit", unit: "megabyte", maximumFractionDigits: 0 })}</dd></>}
        <dt className="text-muted">{t("originalUrl")}</dt><dd className="break-all">{info.canonicalUrl}</dd>
      </dl>
    </section>
  );
}

function RightsForm({ creator, pending, submitLabel, onSubmit }: { creator?: string; pending: boolean; submitLabel: string; onSubmit: (r: Rights) => void }) {
  const t = useTranslations("newProject");
  const ti = useTranslations("import");
  const [basis, setBasis] = useState<Rights["rightsBasis"] | null>(null); // no default: an explicit choice
  const [license, setLicense] = useState("");
  const [credit, setCredit] = useState(creator ?? "");
  const [attested, setAttested] = useState(false);
  const ready = basis && attested && (basis !== "licensed" || license.trim());

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => {
      e.preventDefault();
      if (!ready) return;
      onSubmit({ rightsBasis: basis!, attested: true, licenseReference: license.trim() || undefined, creditLine: basis === "own" ? undefined : credit.trim() || undefined });
    }}>
      <h2 className="text-xl font-semibold">{t("rightsTitle")}</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">{t("basisLegend")}</legend>
        {(["own", "authorized", "licensed"] as const).map((b) => (
          <label key={b} className="flex items-center gap-2">
            <input type="radio" name="basis" value={b} checked={basis === b} onChange={() => setBasis(b)} required />
            {ti(`basis.${b}`)}
          </label>
        ))}
      </fieldset>
      {basis === "licensed" && (
        <label className="flex flex-col gap-1 text-sm">{ti("license")}
          <input value={license} onChange={(e) => setLicense(e.target.value)} required maxLength={500} className="min-h-11 rounded-[var(--r-sm)] border border-border bg-surface px-3" />
          <span className="text-muted">{ti("attribution")}</span>
        </label>
      )}
      {basis && basis !== "own" && (
        <label className="flex flex-col gap-1 text-sm">{ti("credit")}
          <input value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={300} className="min-h-11 rounded-[var(--r-sm)] border border-border bg-surface px-3" />
        </label>
      )}
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} required className="mt-1 size-5" />
        <span>{ti("rightsCheckbox")}</span>
      </label>
      <button type="submit" disabled={!ready || pending} className={`${btn} self-start`}>{submitLabel}</button>
    </form>
  );
}

function UploadFlow({ fromLink }: { fromLink: { url: string; info: Inspection } | null }) {
  const t = useTranslations("newProject");
  const te = useTranslations("import.errors");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());

  const submit = (rights: Rights) => start(async () => {
    if (!file) return;
    setError(null);
    const r = await createUpload({ filename: file.name, size: file.size, ...rights, fromUrl: fromLink?.url, idempotencyKey: key });
    if (!r.ok) { setError(te(r.errorCode)); return; }
    // XHR, not fetch: upload progress is the one percentage we can really measure.
    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", r.putUrl);
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && setPercent(Math.floor((e.loaded / e.total) * 100));
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(file);
    });
    if (!ok) { setError(t("uploadFailed")); setPercent(null); return; }
    await completeUpload(r.projectId);
    router.push(`/projects/${r.projectId}`);
  });

  return (
    <div className="flex flex-col gap-6">
      {fromLink && <><p className="text-muted">{t("attachFor", { title: fromLink.info.title ?? fromLink.info.canonicalUrl })}</p><SourceCard info={fromLink.info} /></>}
      <label className="flex flex-col gap-2">{t("file")}
        <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      </label>
      {file && <RightsForm creator={fromLink?.info.creatorName} pending={pending} submitLabel={t("upload")} onSubmit={submit} />}
      <div role="status" aria-live="polite">
        {percent !== null && <><progress max={100} value={percent} className="w-full" /><p className="text-sm">{t("uploading", { percent })}</p></>}
        {error && <p className="text-danger">{error}</p>}
      </div>
    </div>
  );
}
