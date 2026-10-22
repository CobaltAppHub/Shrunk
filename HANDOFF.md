# HANDOFF — Shrunk, state as of 2026-10-23 (commit after `a45f467`)

You are taking over a Next.js 15 + Python SaaS that turns long videos into short clips. Read this file fully, then `AGENTS.md` (rules), then act. Everything below is checked against the repository, not assumed.

## 1. Product in one paragraph

A user pastes a video link (or uploads a file), confirms they hold the rights, and Shrunk imports the media. It transcribes it (WhisperX), detects scenes and faces, asks Claude (`claude-sonnet-5-5`) for the best 10–30 moments with an explained 0–100 score, and makes free 480p previews. The user edits a clip (trim, word-by-word captions, style, 9:16 framing) and pays 1 credit for an HD render, which is charged only if the file is delivered. They can then publish or schedule it on TikTok, YouTube or Instagram. The UI is French by default, also EN/ES/IT/DE. Spec constraints that must never be broken are in `AGENTS.md`, under "Non-negotiable rules".

## 2. Milestones

| Milestone | State | Where |
|---|---|---|
| J1: auth, Stripe, credit ledger, URL import core | done | `src/lib/{auth,credits,ledger,pricing,stripe*}.ts`, `src/sources/*` |
| J2: Modal worker, Claude clip selection, New project screen, live progress | done | `worker/{app,media,transcribe}.py`, `src/lib/clip-selection.ts`, `src/inngest/analyze.ts` |
| J2 bis: scenes, faces, audio peaks → crop track | done | `worker/vision.py` |
| J3 core: editor + paid 9:16 render | done | `worker/render.py`, `src/lib/edit-state.ts`, `src/inngest/render.ts`, `src/app/[locale]/(app)/projects/[id]/clips/[clipId]/*` |
| J3 rest: visual timeline, B-roll, emoji, brand kits, licensed music library | **todo** | — |
| J4: publishing + calendar | done | `src/publish/*`, `src/inngest/publish.ts`, `src/lib/posts.ts`, pages `accounts`, `calendar` |
| J5: faceless mode (script → TTS → Veo behind `VideoGenProvider` → assembly), C2PA + AI label | **todo** | — |
| J6: post metrics (every 6 h for 7 days, then daily), statistics page, teams (Agency = 5 seats), multiple brand kits | **todo** | — |
| Not built yet from the spec | **todo** | Dashboard, Onboarding (3 questions), Help centre, Status page, legal pages (mentions légales, CGV, confidentialité, cookies), cookie banner (no tracking before consent), PostHog/Sentry, GDPR data export/deletion, public DSA report form (`content_reports` table exists, no UI), landing sections beyond the hero, Vimeo/Drive/Dropbox connectors (`docs/SOURCES.md`) |

## 3. What has been verified, and what has not

**Verified locally (all green at the last commit):**
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (104 tests; Stripe idempotency, the ledger and scheduling run on a real Postgres via PGlite) and `next build`.
- `python -I worker/test_media.py` and `python -I worker/test_render.py` (real ffmpeg: 1080x1920, 30 fps, -14 LUFS ±1.5, moving crop, captions burnt in, watermark).
- `pnpm e2e:preflight`: the SSRF blocks and the demo-video check pass for real.

**Never run against real services. There are no API keys yet:**
- Neon/Postgres, R2, Claude, Modal (WhisperX, MediaPipe face detection), Inngest, Stripe, Resend, and TikTok/YouTube/Instagram.
- The full `pnpm e2e` flow. The latest report, `reports/e2e/latest.md`, is a FAIL caused by missing configuration only.
- No page has been opened in a browser: every app page needs a database session.

## 4. Unblocking the real run (owner actions)

1. Fill `.env.local` (template `.env.example`, account list in `docs/E2E.md`). It is git-ignored and already holds 4 generated secrets plus `INNGEST_DEV=1`.
2. Run `pnpm db:migrate && pnpm db:seed`. There are 4 migrations (`drizzle/0000`–`0003`).
3. `modal secret create shrunk-worker ...`, then `modal deploy worker/app.py`. `WORKER_TOKEN` and `CALLBACK_SECRET` must match `.env.local`.
4. Make `APP_URL` public: tunnel or Vercel preview. Then start `pnpm dev` and the Inngest dev server.
5. Run `pnpm e2e`. It writes `reports/e2e/<stamp>.md` and `latest.md`. Fix what its "Pour Codex" section lists, then re-run until PASS.
6. Publishing needs developer apps plus audits or reviews: TikTok audit, Google OAuth verification, Meta App Review (`docs/PUBLISHING.md`).

## 5. Recommended next tasks, in order

1. **Extend `scripts/e2e.ts`** with:
   - (a) a paid render of the best clip. Move the core of `requestRender` from `clips/[clipId]/actions.ts` into `src/lib/`, the same way `startLinkImport` was moved. Assert capture, a 1080x1920 MP4 and no double charge on replay.
   - (b) a guarded private YouTube upload.
2. **Spec screens not yet built**, legal and compliance first, because they block the launch: legal pages, cookie banner, GDPR export/delete, DSA form, then Dashboard and Onboarding.
3. **J6**, then **J5**, then the rest of J3. J5 must add the C2PA label and set `scheduled_posts.ai_generated`. The caption builder already supports an AI label.

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

## 7. Environment gotchas (Windows dev machine)

- The repository path is very long, so `.npmrc` uses `node-linker=hoisted`, and `package.json` pins a single esbuild version.
- Python venvs must live on a short path (for example `%TEMP%\shrunk-venv`), or Pillow and MediaPipe DLLs fail to load.
- TypeScript is pinned to 6, because typescript-eslint does not support 7.
- `next-env.d.ts` is generated and ignored by ESLint.

## 8. Reports trail

Sessions in chronological order: `reports/sessions/2026-10-22-e2e-harness.md` → `2026-10-22-e2e-first-run.md` → `2026-10-23-e2e-config-fixes.md` → `2026-10-23-j2bis-j3-editor-render.md` → `2026-10-23-j4-publishing.md`.

**After your own session**, write `reports/sessions/<date>-<topic>.md` with these sections: what changed, verified, not verified, risks, next. Update sections 2, 3 and 5 of this file.
