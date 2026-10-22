# Session 2026-10-23 — J4 publishing, without API keys

No E2E run (no keys); [reports/e2e/latest.md](../e2e/latest.md) is unchanged. The three platform docs were re-checked today. Summary and production blockers: [docs/PUBLISHING.md](../../docs/PUBLISHING.md).

## What changed

| File | Change |
|---|---|
| `src/publish/types.ts` | The `PublisherProvider` interface (authorize, exchange, refresh, publish, checkStatus) and `PublishError` (`auth_expired`, `rate_limited`, `quota_exceeded`, `rejected`, `temporary`). |
| `src/publish/tiktok.ts` | Inbox upload (draft) by default; direct post with `TIKTOK_AUDITED=1`, a privacy level validated against `creator_info`, and `is_aigc`. Chunked `FILE_UPLOAD` from R2. Status mapping, with `SEND_TO_USER_INBOX` meaning draft sent. PKCE. |
| `src/publish/youtube.ts` | Resumable upload, privacy setting, `containsSyntheticMedia`. Refresh keeps the refresh token that Google omits. |
| `src/publish/instagram.ts` | Reels container on the account id, status polling, then `media_publish`. Only professional accounts are accepted. |
| `src/publish/schedule.ts`, `slots.ts` | Pacific-time quota day (DST-safe), rolling 24 h limits, caption with source credit and AI label, free slots in the viewer's time zone, HMAC-signed OAuth state, PKCE, calendar grids. |
| `src/publish/index.ts` | Provider registry from env, AES-GCM token storage, `freshTokens` (refresh + persist; a refusal marks the account `expired`). |
| `src/app/api/social/[platform]/{connect,callback}` | OAuth with plan limit on account count, CSRF state bound to user and platform, upsert of the account. |
| `src/lib/posts.ts` | Schedule, reschedule, cancel, retry. Shared core for the server actions (and later the E2E). |
| `src/inngest/publish.ts` | `publish-post`: sleeps until the date; claims the post, skipping stale, cancelled or uncertain ones; quota gate (YouTube shared queue, Instagram 100/24 h, TikTok 5 pending/24 h); publishes; polls up to ~10 min. Error policy: retry only when nothing was created. `refresh-social-tokens` cron every 6 h, with an email when an account gets disconnected. |
| Pages `accounts`, `calendar`, `clips/[clipId]/schedule.tsx` | Account status and reconnection; TikTok draft-mode explanation and YouTube quota note. Week/month calendar with drag-and-drop (time of day kept) and a keyboard alternative (date field, cancel, retry). Schedule form in the editor after a render. |
| `drizzle/0003_j4_publish.sql` | `scheduled_posts`: `workspace_id`, `idempotency_key` unique, `options`, `ai_generated`, `attempted_at`, `published_at`, `cancelled` status. `social_accounts`: `last_error`, `connected_by`, `connected_at`. |
| `messages/*.json` | `accounts.*`, `schedule.*`, `calendar.*`, `email.accountDisconnected`, in 5 languages (parity checked). |

## Verified

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (104/104, of which 23 are new) and `next build` pass.
- Providers against a fake `fetch` that checks the exact requests:
  - TikTok: contiguous `Content-Range` chunks; the privacy level is refused when the creator does not offer it.
  - YouTube: metadata, including `containsSyntheticMedia`.
  - Instagram: container → polling → publish.
  - Error-code mapping.
- Scheduling on PGlite (real Postgres):
  - free-plan refusal, unrendered clip, another workspace's account, caption too long, past date;
  - double submit = 0 extra posts and 0 extra events;
  - reschedule, cancel, and retry refused on `uncertain_state`;
  - tenant isolation on cancel.
- PKCE verified against RFC 7636 appendix B, after fixing a wrong test vector I had misremembered (Node and OpenSSL agreed on the computed value).

## Not verified

- **Every real platform call.** There are no developer accounts yet; the TikTok and Instagram apps need an audit or review (see PUBLISHING.md).
- The Instagram OAuth endpoints (`api.instagram.com/oauth/access_token`, `ig_exchange_token`, `ig_refresh_token`) are written from Meta's documented flow but were not re-fetched this session.
- The `publish-post` Inngest function as a whole, since it needs Inngest and R2. Only its parts are tested.
- The accounts and calendar pages in a browser, since they need a database session.

## Open risks

- The YouTube upload is a single PUT of the whole render (fine for shorts; chunked resume if renders grow past ~500 MB).
- The TikTok "5 pending shares / 24 h" limit is approximated by what we sent: TikTok does not tell us when the creator finishes a draft.
- Calendar drag-and-drop is mouse-only by nature; the keyboard path is the date field inside each post.

## Next steps

1. Create the three developer apps (PUBLISHING.md), fill `.env.local`, run `pnpm db:migrate`.
2. Add a publishing step to `scripts/e2e.ts`: a private YouTube upload of the demo render, guarded by a flag.
3. Then J5 (faceless + Veo, C2PA label) or J6 (analytics with metric fetching, teams).
