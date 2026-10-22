# Rapport E2E — FAIL

- Date : 2026-10-22T21:54:59.850Z
- Mode : préflight seul (aucun service payant appelé)
- Commit : `a71e1fb (modifications non commitées)`
- Durée totale : 0 s
- Résultat : 0 OK, 2 échec(s), 0 avertissement(s), 4 non exécuté(s)

## Préflight (services et configuration)

| Statut | Vérification | Durée | Détail |
|---|---|---|---|
| FAIL | Variables d'environnement |  | manquantes ou invalides : APP_URL, DATABASE_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, DATA_ENCRYPTION_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, ANTHROPIC_API_KEY, WORKER_URL, WORKER_TOKEN, WORKER_CALLBACK_SECRET |
| FAIL | Envoi d'événements Inngest configuré |  | définir INNGEST_DEV=1 (local) ou INNGEST_EVENT_KEY (cloud) |

## Parcours URL → import → transcription → extraits → aperçus

| Statut | Vérification | Durée | Détail |
|---|---|---|---|
| SKIP | Import |  | configuration incomplète |
| SKIP | Transcription |  | configuration incomplète |
| SKIP | Extraits |  | configuration incomplète |
| SKIP | Aperçus |  | configuration incomplète |


## Mesures

_Aucune (parcours non exécuté)._

## Pour Codex

- [ ] **Échec — Variables d'environnement** (`env`)
  - Constat : manquantes ou invalides : APP_URL, DATABASE_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, DATA_ENCRYPTION_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, ANTHROPIC_API_KEY, WORKER_URL, WORKER_TOKEN, WORKER_CALLBACK_SECRET
  - À regarder : `src/lib/env-schema.ts`, `.env.example`, `docs/E2E.md#comptes-et-clés`
- [ ] **Échec — Envoi d'événements Inngest configuré** (`inngest-config`)
  - Constat : définir INNGEST_DEV=1 (local) ou INNGEST_EVENT_KEY (cloud)
  - À regarder : `src/inngest/client.ts`, `docs/E2E.md#inngest`

Règles : ne pas inventer de résultat ni affaiblir une assertion pour faire passer le run ; corriger la cause, relancer `pnpm e2e`, et comparer avec ce rapport. Contexte du dépôt : `AGENTS.md`.
