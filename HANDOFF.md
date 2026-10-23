# HANDOFF — Shrunk, 2026-10-23 — reprise Codex depuis `2681f09` (changements non commités)

You are taking over a Next.js 15 + Python SaaS that turns long videos into short clips. Read this file fully, then `AGENTS.md` (rules), then act. Everything below is checked against the repository, not assumed.

## 1. Product in one paragraph

A user pastes a video link (or uploads a file), confirms they hold the rights, and Shrunk imports the media. It transcribes it (WhisperX), detects scenes and faces, asks Claude (`claude-sonnet-5-5`) for the best 10–30 moments with an explained 0–100 score, and makes free 480p previews. The user edits a clip (trim, word-by-word captions, style, 9:16 framing) and pays 1 credit for an HD render, which is charged only if the file is delivered. They can then publish or schedule it on TikTok, YouTube or Instagram. The UI is French by default, also EN/ES/IT/DE. Spec constraints that must never be broken are in `AGENTS.md`, under "Non-negotiable rules".

## 2. Milestones

| Milestone | State | Where |
|---|---|---|
| Design gaming / tech et Studio | intégré dans les composants Next.js ; aperçu sans session `/preview` | `src/components/`, `src/app/studio.css`, pages `/studio`, `/projects` |
| J1: auth, Stripe, credit ledger, URL import core | done | `src/lib/{auth,credits,ledger,pricing,stripe*}.ts`, `src/sources/*` |
| J2: Modal worker, Claude clip selection, New project screen, live progress | done | `worker/{app,media,transcribe}.py`, `src/lib/clip-selection.ts`, `src/inngest/analyze.ts` |
| J2 bis: scenes, faces, audio peaks → crop track | done | `worker/vision.py` |
| J3 core: editor + paid 9:16 render | done | `worker/render.py`, `src/lib/edit-state.ts`, `src/inngest/render.ts`, `src/app/[locale]/(app)/projects/[id]/clips/[clipId]/*` |
| J3 rest: visual timeline, B-roll, emoji, brand kits, licensed music library | **todo** | — |
| Harness rendu HD + YouTube privé explicite | implémenté, testé localement ; aucun run réel | `src/lib/renders.ts`, `scripts/e2e-{render,publish,media,options}.ts` |
| J4: publishing + calendar | done | `src/publish/*`, `src/inngest/publish.ts`, `src/lib/posts.ts`, pages `accounts`, `calendar` |
| J5: faceless mode (script → TTS → Veo behind `VideoGenProvider` → assembly), C2PA + AI label | **todo** | — |
| J6: post metrics (every 6 h for 7 days, then daily), statistics page, teams (Agency = 5 seats), multiple brand kits | **todo** | — |
| Not built yet from the spec | **todo** | Onboarding (3 questions), Help centre, Status page, legal pages (mentions légales, CGV, confidentialité, cookies), cookie banner (no tracking before consent), PostHog/Sentry, GDPR data export/deletion, public DSA report form (`content_reports` table exists, no UI), landing sections beyond the hero, Vimeo/Drive/Dropbox connectors (`docs/SOURCES.md`) |

## 3. What has been verified, and what has not

**Reprise Codex du 23/10/2026 (copie de travail, aucun secret transféré) :**
- `pnpm lint`, `pnpm typecheck`, `pnpm test` : **128/128** (24 nouveaux tests). Le test DNS existant échoue dans le réseau restreint (`ENOTFOUND`) et passe avec accès réseau autorisé, sans modifier son assertion.
- Build Next.js 15 réussi avec des variables factices limitées au processus ; elles ne donnent accès à aucun service. Le compilateur natif Windows nécessite une exécution hors du bac à sable sur cette machine.
- `probeFile` + `assertHdRender` testés sur un vrai fichier local synthétique de 2 s : MP4, 1080×1920, 30 i/s et audio. Ce fichier est un fixture technique, pas une vidéo utilisateur ni un résultat du worker.
- Aucun E2E réel lancé ; `reports/e2e/latest.md` inchangé. Voir `reports/sessions/2026-10-23-e2e-render-publish.md`.

**Vérifications historiques de Claude (non relancées pour le worker dans cette reprise) :**
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (104 tests; Stripe idempotency, the ledger and scheduling run on a real Postgres via PGlite) and `next build`.
- `python -I worker/test_media.py` and `python -I worker/test_render.py` (real ffmpeg: 1080x1920, 30 fps, -14 LUFS ±1.5, moving crop, captions burnt in, watermark).
- `pnpm e2e:preflight`: the SSRF blocks and the demo-video check pass for real.

**Never run against real services. There are no API keys yet:**
- Neon/Postgres, R2, Claude, Modal (WhisperX, MediaPipe face detection), Inngest, Stripe, Resend, and TikTok/YouTube/Instagram.
- The full `pnpm e2e` flow. The latest report, `reports/e2e/latest.md`, is a FAIL caused by missing configuration only.
- No page has been opened in a browser: every app page needs a database session.

## 4. Unblocking the real run (owner actions)

1. Fill `.env.local` (template `.env.example`, account list in `docs/E2E.md`). It is git-ignored. The original Claude workspace held generated secrets; this source delivery intentionally includes no `.env.local`.
2. Run `pnpm db:migrate && pnpm db:seed`. There are 4 migrations (`drizzle/0000`–`0003`).
3. `modal secret create shrunk-worker ...`, then `modal deploy worker/app.py`. `WORKER_TOKEN` and `CALLBACK_SECRET` must match `.env.local`.
4. Make `APP_URL` public: tunnel or Vercel preview. Then start `pnpm dev` and the Inngest dev server.
5. Run `pnpm e2e`. It writes `reports/e2e/<stamp>.md` and `latest.md`. Fix what its "Pour Codex" section lists, then re-run until PASS.
6. Publishing needs developer apps plus audits or reviews: TikTok audit, Google OAuth verification, Meta App Review (`docs/PUBLISHING.md`).

## 5. Recommended next tasks, in order

1. **Exécuter le parcours réel après configuration** : `pnpm e2e:preflight`, puis `pnpm e2e` (inclut maintenant le rendu payant, contrôle du MP4 et rejeu sans double débit). Les services et les secrets restent à fournir ; aucun succès réel n'est revendiqué.
2. **Valider YouTube sur une chaîne de test** : `pnpm e2e --publish-youtube=<UUID>`. Compte connecté dans l'espace du seed, confidentialité privée imposée, vérification par lecture de l'API Google ; voir `docs/E2E.md`. Sans option, aucun appel YouTube.
3. **Écrans de lancement** : pages légales, consentement cookies, export/suppression RGPD, formulaire DSA, puis Onboarding. Les coordonnées légales de l'éditeur doivent être fournies ; ne pas les inventer.
4. **J6**, puis **J5**, puis la suite de J3. J5 doit ajouter C2PA et renseigner `scheduled_posts.ai_generated`.

## 6. Known risks and deliberate simplifications (grep `ponytail:`)

- **Crop target**: the 9:16 framing follows the largest face, a proxy for the active speaker (`worker/vision.py` `crop_track`).
- **Loudness**: `loudnorm` runs single pass (about ±1 LU).
- **Big uploads**:
  - one signed PUT for browser uploads up to 4 GB (no resume);
  - YouTube upload in a single PUT.
- **Clip selection**: Claude is called per window with an in-process concurrency pool; the Batches API would cut that cost by 50%.
- **TikTok inbox limit**: "5 pending shares / 24 h" is approximated by what we sent.
- **Inngest wake-ups**: `waitForEvent` can miss an early event, so pipelines re-read the DB at most every 5–10 min.
- **Import, analysis and quotas**: import and analysis quotas are first guesses (`src/lib/pricing.ts`). `COSTS.md` contains formulas but no measured cost yet.
- **Unverified by fetch**: the Instagram OAuth endpoints. MediaPipe is pinned to 1.1.1 (Tasks API; there is no `mp.solutions`).

- **Envoi du rendu** : le job et la réservation sont atomiques ; après un échec d’envoi Inngest, le même identifiant de requête renvoie le même événement. Il n’y a pas encore d’outbox durable : sans rejeu, un job peut rester en attente.

## 7. Environment gotchas (Windows dev machine)

- The repository path is very long, so `.npmrc` uses `node-linker=hoisted`, and `package.json` pins a single esbuild version.
- Python venvs must live on a short path (for example `%TEMP%\shrunk-venv`), or Pillow and MediaPipe DLLs fail to load.
- TypeScript is pinned to 6, because typescript-eslint does not support 7.
- `next-env.d.ts` is generated and ignored by ESLint.

## 8. Reports trail

Sessions in chronological order: `reports/sessions/2026-10-22-e2e-harness.md` → `2026-10-22-e2e-first-run.md` → `2026-10-23-e2e-config-fixes.md` → `2026-10-23-j2bis-j3-editor-render.md` → `2026-10-23-j4-publishing.md`.

**After your own session**, write `reports/sessions/<date>-<topic>.md` with these sections: what changed, verified, not verified, risks, next. Update sections 2, 3 and 5 of this file.

Dernière reprise : `reports/sessions/2026-10-23-e2e-render-publish.md`.

Reprise design du 23/10 : interface intégrée, 129 tests réussis, voir `reports/sessions/2026-10-23-neon-ui-integration.md`. Le dépôt d’origine reçoit les changements de la reprise, sans modification de `.env.local`.

Logo du propriétaire intégré dans la navigation et l'accueil : `public/brand/shrunk-logo.png`, composant partagé `Brand`. Voir `reports/sessions/2026-10-23-logo-integration.md`.
