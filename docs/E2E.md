# Test de bout en bout

`pnpm e2e` fait passer une vraie vidéo par tout le pipeline et écrit un rapport à chaque exécution, réussie ou non : `reports/e2e/<horodatage>.md` (+ `.json`) et `reports/e2e/latest.md`.

| Commande | Ce qu'elle fait | Coût |
|---|---|---|
| `pnpm e2e:preflight` | Vérifie la configuration et chaque service (base, R2, Claude, worker, app, Inngest) et les blocages SSRF. Aucun appel payant. | ~0 |
| `pnpm e2e` | Préflight, puis import → transcription → extraits → aperçus sur la vidéo de démo. Ne démarre pas si le préflight échoue. | 1 transcription GPU de 4 min + ~5 appels Claude |
| `pnpm db:seed` | Crée l'utilisateur `e2e@shrunk.test` et son espace de travail (formule Agence pour ne pas buter sur les quotas). | 0 |

**Vidéo de démo** : « Hubble Science: Multiwavelength Astronomy, The Big Picture » (NASA Scientific Visualization Studio, SVS 14328). Elle est dans le domaine public selon les métadonnées de Wikimedia Commons, vérifiées le 22/10/2026. Elle dure 237 s, pèse 32 Mo (WebM VP8 + Opus) et contient une piste audio. Ce qui est réellement dit dedans n'a pas été vérifié avant le premier run : si le rapport indique 0 extrait, c'est le premier point à contrôler.

## Comptes et clés

À créer une fois, puis à reporter dans `.env.local` (jamais commité) :

| Service | À créer | Variables |
|---|---|---|
| Neon (région UE) | projet + base `shrunk` | `DATABASE_URL` |
| Cloudflare R2 | bucket en juridiction UE + jeton API (lecture/écriture sur ce bucket) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Anthropic | clé API avec accès à `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` |
| Modal | compte + `modal setup`, secret `shrunk-worker`, `modal deploy worker/app.py` | `WORKER_URL`, `WORKER_TOKEN`, `WORKER_CALLBACK_SECRET` |
| Hugging Face (facultatif) | jeton + accepter les conditions de `pyannote/speaker-diarization` | `HF_TOKEN` (dans le secret Modal uniquement) |
| Inngest | rien en local (`INNGEST_DEV=1`) ; en ligne : app Inngest Cloud | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| Google OAuth, Resend, Stripe (mode test) | requis pour démarrer l'app, pas utilisés par le parcours E2E | voir `.env.example` |

Valeurs aléatoires : `openssl rand -base64 32` pour `BETTER_AUTH_SECRET`, `WORKER_TOKEN`, `WORKER_CALLBACK_SECRET` et `DATA_ENCRYPTION_KEY`.

### Base

```bash
pnpm db:migrate && pnpm db:seed
```

### R2

Le préflight écrit, relit puis supprime `e2e/preflight-*.txt`. L'upload depuis le navigateur demande en plus la règle CORS décrite dans le README ; le script, lui, n'en a pas besoin.

### Worker

```bash
modal secret create shrunk-worker WORKER_TOKEN=<même valeur> CALLBACK_SECRET=<= WORKER_CALLBACK_SECRET> CALLBACK_URL=<APP_URL>/api/worker/callback
modal deploy worker/app.py
```

Le préflight attend un `401` sans jeton et un `400` avec jeton sur un job inconnu. Aucun GPU n'est lancé.

### App joignable

Le worker tourne chez Modal et rappelle `APP_URL/api/worker/callback` : `APP_URL` doit donc être public. Deux options :

1. **Local + tunnel** : `pnpm dev`, puis `cloudflared tunnel --url http://localhost:3000`. Mettre l'URL `https://…trycloudflare.com` dans `APP_URL` et dans le secret Modal `CALLBACK_URL`, puis relancer `pnpm dev`.
2. **Preview Vercel** avec les mêmes variables, et `APP_URL` = l'URL de preview.

### Inngest

En local : `INNGEST_DEV=1` dans `.env.local`, puis `npx inngest-cli@latest dev -u <APP_URL>/api/inngest`.

## Lecture du rapport

- **PASS** : tout a tourné et toutes les assertions sont vraies.
- **FAIL** : au moins un contrôle a échoué. La section « Pour Codex » liste chaque problème avec les fichiers à regarder.
- **INCOMPLETE** : préflight seul, ou parcours non lancé parce qu'un prérequis manque.

Les rapports ne contiennent jamais de valeur secrète : seulement des noms de variables, des statuts, des identifiants et des mesures.
