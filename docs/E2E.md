# Test de bout en bout

`pnpm e2e` fait passer une vraie vidéo par tout le pipeline et écrit un rapport à chaque exécution, réussie ou non : `reports/e2e/<horodatage>.md` (+ `.json`) et `reports/e2e/latest.md`.

| Commande | Ce qu'elle fait | Coût |
|---|---|---|
| `pnpm e2e:preflight` | Vérifie la configuration et chaque service (base, R2, Claude, worker, app, Inngest) et les blocages SSRF. Aucun appel payant. | ~0 |
| `pnpm e2e` | Préflight, import → transcription → extraits → aperçus → rendu du meilleur extrait, contrôle du MP4 et rejeu sans double débit. Ne démarre pas si le préflight échoue. | Transcription GPU + appels Claude + rendu CPU ; 1 crédit si livré |
| `pnpm e2e --publish-youtube=<UUID>` | Même parcours, puis upload **privé** sur le compte YouTube de test explicitement choisi ; vérification du statut auprès de Google. | Même coût + quota d'upload YouTube |
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

`ffprobe` (fourni avec ffmpeg) doit être accessible dans le PATH de la machine qui lance l'E2E. Sinon, définir `FFPROBE_PATH` avec son chemin absolu. Son absence bloque le parcours payant au préflight.

### Rendu payant et rejeu

Le test appelle `requestClipRender` dans `src/lib/renders.ts`, le même cœur que l'éditeur. Il conserve les sous-titres réels et les réglages enregistrés, ou utilise les réglages par défaut de l'éditeur. Il attend la livraison dans R2 **et** la capture dans le ledger, télécharge temporairement le fichier sous `work/e2e/`, puis vérifie avec ffprobe : MP4, 1080×1920, 30 i/s, audio présent et durée conforme à la découpe (±1 s). Le fichier local est ensuite supprimé.

Un deuxième appel avec la même clé doit renvoyer le même job. Le ledger doit contenir exactement une réservation de -1 et une capture de 0, sans restitution, et le solde doit avoir baissé de 1. Utiliser un espace E2E isolé, sans autre activité de crédits pendant le test. Le seed attribue 10 crédits **une seule fois** : après épuisement, il faut ajouter explicitement des crédits dans la base de test. Il ne crédite pas chaque run.

`--timeout=30` règle le délai maximal de **chaque phase** d'attente (analyse, rendu, publication), pas de l'ensemble du script. Valeurs acceptées : plus de 0 et au plus 120 minutes.

### YouTube privé (facultatif)

Sans `--publish-youtube=<UUID>`, aucun upload ni appel à YouTube n'est effectué. Le rapport signale cette extension comme non exécutée et facultative ; le parcours principal peut réussir. Une extension demandée mais non exécutée rend le résultat incomplet, ou en échec si un prérequis échoue.

Préparer une **base et une chaîne de test** :

1. Configurer `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` et le callback OAuth, selon [PUBLISHING.md](PUBLISHING.md).
2. Lancer `pnpm db:seed`. Le compte doit être connecté dans l'espace du seed, pas dans un autre espace. Pour ouvrir cet espace dans l'application, affecter dans la base de test une adresse email que vous contrôlez à l'utilisateur `e2e-user`, puis se connecter par magic link. L'adresse par défaut `e2e@shrunk.test` ne reçoit pas de messages. Le seed ne remplace pas l'adresse d'un utilisateur existant.
3. Depuis cet espace, connecter la chaîne YouTube via la page Comptes. Relever l'UUID de la ligne `social_accounts` correspondante (ce n'est pas l'identifiant de chaîne Google).
4. Lancer `pnpm e2e --publish-youtube=<UUID>`. Le script refuse un compte déconnecté, une autre plateforme ou un compte appartenant à un autre espace **avant de lancer l'import payant**. `--preflight` ne publie jamais, même si l'option est présente.

La publication passe par `schedulePosts` et la fonction Inngest existante ; elle impose `privacy: private`, reprend le crédit NASA et vérifie l'idempotence de la programmation. Une fois l'upload déclaré terminé, le script relit `videos.list(part=status,snippet)` avec les jetons du compte : identifiant de vidéo, chaîne attendue, confidentialité privée et statut d'upload valide sont contrôlés. Références : [videos.list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), [ressource vidéo](https://developers.google.com/youtube/data/reference/rest/v3/videos).

La vidéo reste privée sur la chaîne et doit être supprimée manuellement après inspection. En cas de délai dépassé, le job ou la publication peut encore aboutir : vérifier le calendrier, le job et la chaîne avant de relancer. Le script ne publie jamais automatiquement sur TikTok ou Instagram.

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
