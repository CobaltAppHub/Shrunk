# AGENTS.md — Shrunk

Instructions for coding agents (Codex and others). The product spec and decisions live in `README.md`, `docs/SOURCES.md`, `docs/E2E.md` and `COSTS.md`. The UI and docs are in French.

## Start here

1. Read the latest session handoff: the newest file in `reports/sessions/`.
2. Read the latest E2E result: `reports/e2e/latest.md`. Its "Pour Codex" section lists open failures and the files to check for each.

## Commands

```bash
pnpm install          # pnpm only; .npmrc uses node-linker=hoisted (Windows path length)
pnpm lint && pnpm typecheck && pnpm test   # must all pass before a commit
python -I worker/test_media.py             # worker media self-check (needs ffmpeg)
pnpm e2e:preflight    # configuration + services, nothing paid
pnpm e2e              # real pipeline on the public-domain demo video; writes reports/e2e/*
```

## Non-negotiable rules

- **Money**: the credit balance is `SUM(credit_ledger.delta)`. Never update or delete ledger rows. Every write has a unique `idempotency_key`. A job is settled once (`settle:<job>`). Tests are in `tests/credits.test.ts`.
- **Sources**: never add a way to download third-party YouTube videos, and never bypass DRM, paywalls or logins (see `docs/SOURCES.md`). Every outbound fetch of a user-supplied URL goes through `src/sources/safe-fetch.ts`.
- **Honesty**: no fake progress, no invented clips, metrics or testimonials. Unknown costs stay `null`. Show a percentage only when it is measured.
- **Tenancy**: every query is scoped to the caller's workspace. R2 keys start with `ws/<workspaceId>/`.
- **i18n**: no hard-coded UI strings. Every key exists in `messages/{fr,en,es,it,de}.json`.
- **Secrets**: never log or report secret values, signed URLs or source URLs (they may carry tokens). `source_assets.original_url_enc` is encrypted.
- **Tests**: do not weaken an assertion to make a run pass. Fix the cause, re-run, and say what changed.

## After every work session

Write `reports/sessions/<YYYY-MM-DD>-<topic>.md` with these sections: what changed (files), verified (commands and results), not verified, open risks, next steps. Link the E2E report you ran, if any.
