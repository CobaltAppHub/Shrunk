# Session 2026-10-22 — first `pnpm e2e` attempt (blocked)

## What changed

No code changes. Only the run report [reports/e2e/2026-10-22T21-57-24.md](../e2e/2026-10-22T21-57-24.md) was added.

## Verified

- The preflight ran and stopped at configuration: all 18 required variables are missing, and so is the Inngest setting (`INNGEST_DEV` or `INNGEST_EVENT_KEY`). As designed, nothing paid was called.
- On the machine that ran the session:
  - there is no `.env.local` in the project folder or in its parent;
  - nothing answers on `127.0.0.1:3000` (app) or `127.0.0.1:8288` (Inngest dev server);
  - no `cloudflared` or `ngrok` process is running.

## Not verified

- The whole real flow (import, transcription, clips, previews). It is still never executed.

## Open risks

- The configuration may exist in another copy of the repository or on another machine. The E2E has to run where `.env.local`, the app and the tunnel actually are.

## Next steps

1. Put `.env.local` at the root of this repository (next to `package.json`), or say which folder holds the configured copy.
2. Start `pnpm dev`, the tunnel, and `npx inngest-cli@latest dev -u <APP_URL>/api/inngest` (with `INNGEST_DEV=1`).
3. `pnpm db:migrate && pnpm db:seed && pnpm e2e`.
