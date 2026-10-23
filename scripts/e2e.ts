// End-to-end check of the real pipeline: URL → import → transcription → clips → previews.
//   pnpm e2e              full run (spends a little GPU + LLM: one 4-minute public-domain video)
//   pnpm e2e:preflight    services and configuration only, nothing paid is called
// Writes reports/e2e/<timestamp>.md + .json and reports/e2e/latest.md on every run, pass or fail.
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { e2eOptions } from "./e2e-options";
import type { Transcript } from "@/lib/clip-selection";
import { readFileSync } from "node:fs";
import { envSchema } from "@/lib/env-schema";
import { Report, errorText } from "./report";
import { DEMO, seedDemo } from "./seed";

try { process.loadEnvFile(".env.local"); } catch { /* env from the shell / CI secrets */ }
const preflightOnly = process.argv.includes("--preflight");
const report = new Report(preflightOnly ? "preflight" : "full");

const FILES = {
  env: ["src/lib/env-schema.ts", ".env.example", "docs/E2E.md#comptes-et-clés"],
  db: ["src/db/schema.ts", "drizzle/", "docs/E2E.md#base"],
  r2: ["src/lib/storage.ts", "docs/E2E.md#r2"],
  anthropic: ["src/lib/clip-selection.ts"],
  worker: ["worker/app.py", "src/lib/worker.ts", "docs/E2E.md#worker"],
  app: ["src/app/api/inngest/route.ts", "docs/E2E.md#app-joignable"],
  inngest: ["src/inngest/client.ts", "docs/E2E.md#inngest"],
  import: ["src/lib/imports.ts", "src/inngest/functions.ts", "src/sources/direct.ts", "src/sources/pipe.ts"],
  transcribe: ["src/inngest/analyze.ts", "worker/app.py", "worker/transcribe.py", "src/app/api/worker/callback/route.ts"],
  select: ["src/lib/clip-selection.ts", "src/inngest/analyze.ts"],
  preview: ["worker/media.py", "worker/app.py", "src/inngest/analyze.ts"],
  security: ["src/sources/safe-fetch.ts"],
  render: ["src/lib/renders.ts", "src/inngest/render.ts", "scripts/e2e-render.ts", "worker/render.py"],
  publish: ["scripts/e2e-publish.ts", "src/lib/posts.ts", "src/inngest/publish.ts", "src/publish/youtube.ts"],
};

async function main() {
  const { timeoutMin, youtubeAccountId } = e2eOptions(process.argv.slice(2));
  report.facts["YouTube privé demandé"] = !!youtubeAccountId;
  if (!youtubeAccountId) report.add({ id: "youtube-disabled", section: "flow", title: "Publication YouTube privée", status: "skip", optional: true, detail: "désactivée ; activer avec --publish-youtube=<UUID du compte de test>" });
  const ffprobeOk = await report.run({ id: "ffprobe", section: "preflight", title: "ffprobe disponible pour vérifier le vrai rendu", files: FILES.render }, async () => {
    try { await promisify(execFile)(process.env.FFPROBE_PATH || "ffprobe", ["-version"], { timeout: 10_000 }); }
    catch { throw new Error("Installer ffmpeg ou définir FFPROBE_PATH ; aucun rendu payant ne sera lancé sans ce contrôle"); }
  });
  // ── 1. Configuration ───────────────────────────────────────────────────────
  const parsed = envSchema.safeParse(process.env);
  report.add({
    id: "env", section: "preflight", title: "Variables d'environnement", files: FILES.env,
    status: parsed.success ? "pass" : "fail",
    detail: parsed.success ? "toutes présentes et valides" : `manquantes ou invalides : ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`,
  });
  const inngestDev = process.env.INNGEST_DEV === "1";
  report.add({
    id: "inngest-config", section: "preflight", title: "Envoi d'événements Inngest configuré", files: FILES.inngest,
    status: inngestDev || process.env.INNGEST_EVENT_KEY ? "pass" : "fail",
    detail: inngestDev ? "serveur de dev local (INNGEST_DEV=1)" : process.env.INNGEST_EVENT_KEY ? "Inngest Cloud (INNGEST_EVENT_KEY)" : "définir INNGEST_DEV=1 (local) ou INNGEST_EVENT_KEY (cloud)",
  });
  if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_live")) {
    report.add({ id: "stripe-mode", section: "preflight", title: "Clé Stripe en mode test", status: "warn", detail: "clé live détectée : l'E2E ne touche pas Stripe, mais un environnement de test devrait utiliser sk_test_", files: FILES.env });
  }

  // ── 2. Services (no paid call) ─────────────────────────────────────────────
  // Each service is checked as soon as its own variables are set, so accounts can be added one by one.
  const v = (k: string) => process.env[k] || undefined;
  const needs = async (keys: string[], c: Parameters<Report["run"]>[0], fn: Parameters<Report["run"]>[1]) => {
    const missing = keys.filter((k) => !v(k));
    if (missing.length) return report.add({ ...c, status: "fail", detail: `à renseigner : ${missing.join(", ")}` });
    return report.run(c, fn);
  };

  const dbOk = await needs(["DATABASE_URL"], { id: "db", section: "preflight", title: "Postgres joignable et migrations appliquées", files: FILES.db }, async () => {
    const { default: postgres } = await import("postgres");
    const pg = postgres(v("DATABASE_URL")!, { prepare: false, max: 1, connect_timeout: 15 });
    try {
      await pg`select 1`;
      const expected = (JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
      const [row] = await pg`select count(*)::int as n from drizzle.__drizzle_migrations`.catch(() => [{ n: 0 }]);
      const applied = Number(row?.n ?? 0);
      if (applied < expected) throw new Error(`${applied}/${expected} migrations appliquées : lancer pnpm db:migrate`);
      return { detail: `${applied}/${expected} migrations` };
    } finally {
      await pg.end({ timeout: 5 });
    }
  });

  const r2Ok = await needs(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"], { id: "r2", section: "preflight", title: "R2 : écriture signée, lecture, suppression", files: FILES.r2 }, async () => {
    const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const s3 = new S3Client({ region: "auto", endpoint: `https://${v("R2_ACCOUNT_ID")}.eu.r2.cloudflarestorage.com`, credentials: { accessKeyId: v("R2_ACCESS_KEY_ID")!, secretAccessKey: v("R2_SECRET_ACCESS_KEY")! } });
    const Bucket = v("R2_BUCKET")!;
    const Key = `e2e/preflight-${Date.now()}.txt`;
    const put = await fetch(await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType: "text/plain" }), { expiresIn: 300 }), { method: "PUT", headers: { "content-type": "text/plain" }, body: "ok" });
    if (!put.ok) throw new Error(`PUT signé refusé (${put.status}) : vérifier bucket UE, jeton et nom du bucket`);
    if ((await s3.send(new HeadObjectCommand({ Bucket, Key }))).ContentLength !== 2) throw new Error("objet introuvable après PUT");
    await s3.send(new DeleteObjectCommand({ Bucket, Key }));
  });

  const llmOk = await needs(["ANTHROPIC_API_KEY"], { id: "anthropic", section: "preflight", title: "API Claude : modèle claude-sonnet-5-5 accessible", files: FILES.anthropic }, async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const m = await new Anthropic({ apiKey: v("ANTHROPIC_API_KEY") }).models.retrieve("claude-sonnet-5-5");
    return { detail: m.display_name };
  });

  const workerOk = await needs(["WORKER_URL", "WORKER_TOKEN"], { id: "worker", section: "preflight", title: "Worker Modal joignable, jeton vérifié", files: FILES.worker }, async () => {
    const url = `${v("WORKER_URL")!.replace(/\/$/, "")}/jobs`;
    const anon = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(60_000) });
    if (anon.status !== 401) throw new Error(`sans jeton : ${anon.status} au lieu de 401 (endpoint ouvert ou mauvaise URL)`);
    const authed = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${v("WORKER_TOKEN")}` }, body: JSON.stringify({ kind: "e2e-noop" }), signal: AbortSignal.timeout(60_000) });
    if (authed.status === 401) throw new Error("WORKER_TOKEN refusé : il doit être identique dans le secret Modal");
    if (authed.status !== 400) throw new Error(`avec jeton : ${authed.status} au lieu de 400`);
    return { detail: "401 sans jeton, 400 sur un job inconnu (aucun GPU lancé)" };
  });

  const appUrl = v("APP_URL") ?? "http://localhost:3000";
  const host = new URL(appUrl).hostname;
  const local = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(host) || host.endsWith(".localhost");
  const appOk = await report.run({ id: "app", section: "preflight", title: "App joignable et fonctions Inngest servies", files: FILES.app }, async () => {
    const res = await fetch(`${appUrl}/api/inngest`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GET /api/inngest → ${res.status} (app lancée ?)`);
    const body = (await res.json().catch(() => ({}))) as { function_count?: number };
    return { detail: body.function_count != null ? `${body.function_count} fonctions` : "OK" };
  });
  report.add({
    id: "callback-public", section: "preflight", title: "Callback du worker joignable depuis Internet", files: FILES.app,
    status: !local ? "pass" : preflightOnly ? "warn" : "fail",
    detail: !local ? appUrl : "APP_URL est local : Modal ne pourra pas appeler /api/worker/callback. Utiliser un tunnel (cloudflared) ou un déploiement de preview",
  });
  const inngestOk = !inngestDev ? true : (await report.run({ id: "inngest-dev", section: "preflight", title: "Serveur de dev Inngest lancé", files: FILES.inngest }, async () => {
    const res = await fetch("http://127.0.0.1:8288/", { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`http://127.0.0.1:8288 → ${res.status}`);
  })) === "pass";

  // ── 3. Security spot checks + demo source (free, no account needed) ────────
  const { safeFetch, sniffVideo, validateUrl } = await import("@/sources/safe-fetch");
  const codeOf = (e: unknown) => (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
  await report.run({ id: "ssrf-metadata", section: "security", title: "Lien vers le service de métadonnées cloud bloqué", files: FILES.security }, async () => {
    let r: string | undefined = "accepté";
    try { validateUrl("https://169.254.169.254/latest/meta-data/"); } catch (e) { r = codeOf(e); }
    if (r !== "blocked_destination") throw new Error(`résultat : ${r}`);
  });
  await report.run({ id: "ssrf-dns", section: "security", title: "Nom DNS résolu vers 127.0.0.1 bloqué à la connexion", files: FILES.security }, async () => {
    const r = await safeFetch("https://127.0.0.1.nip.io/x.mp4", { signal: AbortSignal.timeout(10_000) }).then(() => "accepté", codeOf);
    if (r !== "blocked_destination") throw new Error(`résultat : ${r}`);
  });
  const demoOk = await report.run({ id: "demo-inspect", section: "preflight", title: "Vidéo de démo joignable et vraie vidéo (domaine public, NASA SVS)", files: FILES.import }, async () => {
    const { res } = await safeFetch(DEMO.url, { headers: { range: "bytes=0-1023" }, signal: AbortSignal.timeout(20_000) });
    if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const container = sniffVideo(new Uint8Array(await res.arrayBuffer()).subarray(0, 1024));
    const total = Number(res.headers.get("content-range")?.split("/")[1]);
    if (!container) throw new Error("le contenu reçu n'est pas une vidéo");
    return { status: total === DEMO.bytes ? "pass" : "warn", detail: `${container}, ${total} octets (attendu ${DEMO.bytes})` };
  });

  if (!parsed.success) return skipRest("configuration incomplète : le parcours a besoin de toutes les variables");
  const { db } = await import("@/db");
  const storage = await import("@/lib/storage");

  if (preflightOnly) return skipRest("mode préflight");
  const ready = [dbOk, r2Ok, llmOk, workerOk, appOk, demoOk, ffprobeOk].every((s) => s === "pass") && inngestOk && !local;
  if (!ready) return skipRest("préflight en échec : le parcours payant n'est pas lancé");

  // ── 4. Full flow ───────────────────────────────────────────────────────────
  const schema = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { startLinkImport } = await import("@/lib/imports");
  const actor = await seedDemo(db);
  if (youtubeAccountId) {
    const { testYoutubeAccount } = await import("./e2e-publish");
    const accountReady = await report.run({ id: "youtube-account", section: "preflight", title: "Compte YouTube de test connecté dans l'espace E2E", files: FILES.publish }, async () => {
      await testYoutubeAccount(actor, youtubeAccountId);
    });
    if (accountReady !== "pass") return skipRest("compte YouTube indisponible : aucun parcours payant lancé");
  }
  const key = randomUUID();
  const input = { url: DEMO.url, rightsBasis: "licensed" as const, licenseReference: DEMO.license, creditLine: DEMO.credit, attested: true as const, idempotencyKey: key };

  let projectId = "";
  const started = await report.run({ id: "start", section: "flow", title: "Import lancé (même code que l'action serveur)", files: FILES.import }, async () => {
    const r = await startLinkImport(actor, input);
    if (!r.ok) throw new Error(`refusé : ${r.errorCode}`);
    projectId = r.projectId;
    return { detail: `projet ${projectId}` };
  });
  if (started !== "pass") return skipRest("import non lancé");
  await report.run({ id: "idempotent", section: "flow", title: "Double soumission : un seul projet", files: FILES.import }, async () => {
    const again = await startLinkImport(actor, input);
    if (!again.ok || again.projectId !== projectId) throw new Error(`second appel : ${JSON.stringify(again)}`);
  });

  // Poll the real state; record every transition with its elapsed time.
  const t0 = Date.now();
  const seen: string[] = [];
  let project: typeof schema.projects.$inferSelect | undefined;
  while (Date.now() - t0 < timeoutMin * 60_000) {
    [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    const state = `${project!.status}${project!.stage ? `/${project!.stage}` : ""}`;
    if (seen.at(-1)?.split(" @")[0] !== state) seen.push(`${state} @${Math.round((Date.now() - t0) / 1000)} s`);
    if (["ready", "failed", "done"].includes(project!.status)) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  report.facts["Transitions"] = seen.join(" → ");
  report.facts["Projet"] = projectId;

  const [asset] = await db.select().from(schema.sourceAssets).where(eq(schema.sourceAssets.id, project!.sourceAssetId!));
  const stageFiles = FILES[(project!.stage as keyof typeof FILES) ?? "transcribe"] ?? FILES.transcribe;
  report.add({
    id: "terminal", section: "flow", title: `Projet terminé en moins de ${timeoutMin} min`, files: stageFiles,
    status: project!.status === "ready" ? "pass" : "fail",
    detail: project!.status === "ready" ? `${Math.round((Date.now() - t0) / 1000)} s` : `état final ${project!.status}/${project!.stage ?? "-"}, code ${project!.errorCode ?? asset?.importErrorCode ?? "aucun"}`,
  });

  report.add({
    id: "imported", section: "flow", title: "Média réellement importé dans R2 (taille, empreinte, espace de travail)", files: FILES.import,
    status: asset?.importStatus === "imported" && asset.importedBytes === DEMO.bytes && !!asset.contentHash && asset.storageKey?.startsWith(`ws/${actor.workspace.id}/`) ? "pass" : "fail",
    detail: `${asset?.importStatus}, ${asset?.importedBytes ?? 0} octets, sha256 ${asset?.contentHash?.slice(0, 12) ?? "absent"}, clé ${asset?.storageKey ?? "absente"}`,
  });
  const segs = (asset?.transcript as { segments?: { words?: unknown[] }[] } | null)?.segments ?? [];
  report.add({
    id: "transcript", section: "flow", title: "Transcription mot à mot enregistrée", files: FILES.transcribe,
    status: segs.length > 0 && segs.some((s) => (s.words?.length ?? 0) > 0) && Math.abs((asset?.durationS ?? 0) - DEMO.durationS) < 2 ? "pass" : "fail",
    detail: `${segs.length} segments, ${segs.reduce((n, s) => n + (s.words?.length ?? 0), 0)} mots, langue ${asset?.language ?? "?"}, durée ffprobe ${asset?.durationS?.toFixed(1) ?? "?"} s`,
  });

  const list = await db.select().from(schema.clips).where(eq(schema.clips.projectId, projectId));
  const bad = list.filter((c) => c.endS - c.startS < 10 || c.endS - c.startS > 90 || c.score < 0 || c.score > 100 || c.endS > (asset?.durationS ?? 0) + 1);
  report.add({
    id: "clips", section: "flow", title: "Extraits proposés, bornes et scores valides", files: FILES.select,
    // Zero clips is a legitimate outcome for a music-only source, so it is a warning, not a pass.
    status: bad.length ? "fail" : list.length === 0 ? "warn" : "pass",
    detail: list.length === 0 ? "aucun extrait : vérifier que la vidéo de démo contient bien de la parole" : `${list.length} extraits, ${bad.length} invalides, meilleurs scores ${list.map((c) => c.score).sort((a, b) => b - a).slice(0, 3).join(", ")}`,
  });
  if (list.length) {
    const sizes = await Promise.all(list.map((c) => (c.previewKey ? storage.headSize(c.previewKey) : Promise.resolve(null))));
    const okCount = sizes.filter((s) => (s ?? 0) > 0).length;
    report.add({
      id: "previews", section: "flow", title: "Aperçus 480p présents dans R2", files: FILES.preview,
      status: okCount === list.length ? "pass" : okCount > 0 ? "warn" : "fail",
      detail: `${okCount}/${list.length} aperçus, clés ${list.every((c) => !c.previewKey || c.previewKey.startsWith(`ws/${actor.workspace.id}/`)) ? "dans l'espace de travail" : "HORS espace de travail"}`,
    });
  }

  const costs = await db.select({ type: schema.jobs.type, key: schema.jobs.idempotencyKey, cost: schema.jobs.costUsd, status: schema.jobs.status })
    .from(schema.jobs).where(eq(schema.jobs.refId, asset!.id));
  for (const j of costs) report.facts[`Job ${j.key}`] = `${j.status}, coût ${j.cost ?? "inconnu"} $`;
  report.facts["Crédits de rendu consommés"] = "non mesurés (aucun rendu livré vérifié)";
  const best = [...list].sort((a, b) => b.score - a.score)[0];
  if (project!.status !== "ready" || bad.length || !best) return skipRest("aucun extrait valide d'un projet prêt pour le rendu");
  const { renderBestClip } = await import("./e2e-render");
  const words = (asset!.transcript as Transcript).segments.flatMap((segment) => segment.words);
  const renderedClipId = await renderBestClip(report, actor, best, timeoutMin, words);
  if (!renderedClipId) return skipRest("rendu non vérifié : publication non lancée");
  if (youtubeAccountId) {
    const { publishPrivateDemo } = await import("./e2e-publish");
    await publishPrivateDemo(report, actor, renderedClipId, youtubeAccountId, timeoutMin);
  }
}

function skipRest(reason: string) {
  if (process.argv.some((a) => a.startsWith("--publish-youtube")) && !report.checks.some((c) => c.id === "youtube-private")) {
    report.add({ id: "youtube-private", section: "flow", title: "Publication YouTube privée vérifiée", status: "skip", detail: reason, files: FILES.publish });
  }
  for (const [id, title] of [["start", "Import"], ["transcript", "Transcription"], ["clips", "Extraits"], ["previews", "Aperçus"], ["render-request", "Demande de rendu"], ["render-delivered", "Livraison et capture"], ["render-media", "Vérification du MP4"], ["render-replay", "Rejeu sans double débit"]] as const) {
    if (!report.checks.some((c) => c.id === id)) report.add({ id, section: "flow", title, status: "skip", detail: reason });
  }
}

main()
  .catch((e) => report.add({ id: "crash", section: "flow", title: "Le script a planté", status: "fail", detail: errorText(e), files: ["scripts/e2e.ts"] }))
  .finally(() => {
    const path = report.write();
    console.log(`\n${report.verdict} — rapport : ${path} (copie : reports/e2e/latest.md)`);
    process.exit(report.verdict === "FAIL" ? 1 : 0);
  });
