# Rapport E2E — FAIL

- Date : 2026-10-22T22:01:16.175Z
- Mode : préflight seul (aucun service payant appelé)
- Commit : `2d28e0e (modifications non commitées)`
- Durée totale : 1 s
- Résultat : 4 OK, 7 échec(s), 1 avertissement(s), 4 non exécuté(s)

## Préflight (services et configuration)

| Statut | Vérification | Durée | Détail |
|---|---|---|---|
| FAIL | Variables d'environnement |  | manquantes ou invalides : DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, ANTHROPIC_API_KEY, WORKER_URL |
| PASS | Envoi d'événements Inngest configuré |  | serveur de dev local (INNGEST_DEV=1) |
| FAIL | Postgres joignable et migrations appliquées |  | à renseigner : DATABASE_URL |
| FAIL | R2 : écriture signée, lecture, suppression |  | à renseigner : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET |
| FAIL | API Claude : modèle claude-sonnet-5-5 accessible |  | à renseigner : ANTHROPIC_API_KEY |
| FAIL | Worker Modal joignable, jeton vérifié |  | à renseigner : WORKER_URL |
| FAIL | App joignable et fonctions Inngest servies | 0.1 s | fetch failed / ECONNREFUSED |
| WARN | Callback du worker joignable depuis Internet |  | APP_URL est local : Modal ne pourra pas appeler /api/worker/callback. Utiliser un tunnel (cloudflared) ou un déploiement de preview |
| FAIL | Serveur de dev Inngest lancé | 0.0 s | fetch failed / ECONNREFUSED |
| PASS | Vidéo de démo joignable et vraie vidéo (domaine public, NASA SVS) | 0.3 s | matroska, 32242743 octets (attendu 32242743) |

## Parcours URL → import → transcription → extraits → aperçus

| Statut | Vérification | Durée | Détail |
|---|---|---|---|
| SKIP | Import |  | configuration incomplète : le parcours a besoin de toutes les variables |
| SKIP | Transcription |  | configuration incomplète : le parcours a besoin de toutes les variables |
| SKIP | Extraits |  | configuration incomplète : le parcours a besoin de toutes les variables |
| SKIP | Aperçus |  | configuration incomplète : le parcours a besoin de toutes les variables |

## Contrôles de sécurité

| Statut | Vérification | Durée | Détail |
|---|---|---|---|
| PASS | Lien vers le service de métadonnées cloud bloqué | 0.0 s |  |
| PASS | Nom DNS résolu vers 127.0.0.1 bloqué à la connexion | 0.0 s |  |

## Mesures

_Aucune (parcours non exécuté)._

## Pour Codex

- [ ] **Échec — Variables d'environnement** (`env`)
  - Constat : manquantes ou invalides : DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, ANTHROPIC_API_KEY, WORKER_URL
  - À regarder : `src/lib/env-schema.ts`, `.env.example`, `docs/E2E.md#comptes-et-clés`
- [ ] **Échec — Postgres joignable et migrations appliquées** (`db`)
  - Constat : à renseigner : DATABASE_URL
  - À regarder : `src/db/schema.ts`, `drizzle/`, `docs/E2E.md#base`
- [ ] **Échec — R2 : écriture signée, lecture, suppression** (`r2`)
  - Constat : à renseigner : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  - À regarder : `src/lib/storage.ts`, `docs/E2E.md#r2`
- [ ] **Échec — API Claude : modèle claude-sonnet-5-5 accessible** (`anthropic`)
  - Constat : à renseigner : ANTHROPIC_API_KEY
  - À regarder : `src/lib/clip-selection.ts`
- [ ] **Échec — Worker Modal joignable, jeton vérifié** (`worker`)
  - Constat : à renseigner : WORKER_URL
  - À regarder : `worker/app.py`, `src/lib/worker.ts`, `docs/E2E.md#worker`
- [ ] **Échec — App joignable et fonctions Inngest servies** (`app`)
  - Constat : fetch failed / ECONNREFUSED
  - À regarder : `src/app/api/inngest/route.ts`, `docs/E2E.md#app-joignable`
- [ ] **Échec — Serveur de dev Inngest lancé** (`inngest-dev`)
  - Constat : fetch failed / ECONNREFUSED
  - À regarder : `src/inngest/client.ts`, `docs/E2E.md#inngest`
- [ ] **Avertissement — Callback du worker joignable depuis Internet** (`callback-public`)
  - Constat : APP_URL est local : Modal ne pourra pas appeler /api/worker/callback. Utiliser un tunnel (cloudflared) ou un déploiement de preview
  - À regarder : `src/app/api/inngest/route.ts`, `docs/E2E.md#app-joignable`

Règles : ne pas inventer de résultat ni affaiblir une assertion pour faire passer le run ; corriger la cause, relancer `pnpm e2e`, et comparer avec ce rapport. Contexte du dépôt : `AGENTS.md`.
