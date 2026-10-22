# Shrunk

Une vidéo longue devient plusieurs extraits courts sous-titrés. Next.js 15, Drizzle/Postgres (Neon, UE), Better-Auth, Stripe, Inngest, Cloudflare R2.

## Démarrer

```bash
pnpm install
cp .env.example .env.local   # remplir les variables requises
pnpm db:migrate
pnpm dev                     # puis, dans un autre terminal :
pnpm inngest:dev
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

`pnpm test` : 74 tests (barème, ledger, idempotence Stripe sur un vrai Postgres embarqué via PGlite, SSRF, détection de contenu, fenêtrage/score/dédoublonnage des extraits, signature du worker compatible Python). Ils ne nécessitent ni réseau ni base de données, sauf le test DNS anti-rebinding qui résout `127.0.0.1.nip.io`.

## Configuration Stripe (une fois)

1. Produits `starter`, `pro`, `agency` avec deux prix chacun, en EUR, **tax behavior = inclusive**, et les lookup keys `starter_month`, `starter_year`, `pro_month`… (annuel = mensuel × 12 × 0,8).
2. Activer Stripe Tax (enregistrement TVA FR + guichet OSS UE).
3. Portail client : autoriser la résiliation, le changement de formule et l'accès aux factures.
4. Billing › Subscriptions › « Upcoming renewal events » réglé sur **7 jours**. Le webhook `invoice.upcoming` déclenche l'e-mail de rappel annuel.
5. Webhook `/api/stripe/webhook` avec les événements `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` et `invoice.upcoming`.

## Worker vidéo (Modal, région UE)

```bash
pip install modal && modal setup
modal secret create shrunk-worker WORKER_TOKEN=... CALLBACK_SECRET=... CALLBACK_URL=https://<app>/api/worker/callback HF_TOKEN=...
modal deploy worker/app.py      # → WORKER_URL = l'URL de la fonction `api`
python -I worker/test_media.py  # vérif locale ffprobe / audio / aperçu (ffmpeg requis)
pip install -r worker/requirements-dev.txt && python -I worker/test_render.py  # scènes, recadrage, sous-titres, rendu 9:16
```

- Le sandbox ne reçoit **aucun identifiant de stockage ni de base** : seulement des URL R2 signées (lecture de la source, écriture des sorties) et le secret de callback. ffmpeg est limité aux protocoles `file,https,tls,tcp,crypto`.
- `HF_TOKEN` (facultatif) active la diarisation pyannote ; il faut accepter les conditions du modèle sur Hugging Face. Sans lui, pas de locuteurs.
- `GPU_USD_PER_S` / `CPU_USD_PER_S` (facultatifs) : tarif Modal en vigueur, pour remplir `jobs.cost_usd`. Absents, le coût reste `null` (inconnu) plutôt qu'inventé.
- Pipeline : ffprobe (3 h max, quota de minutes d'analyse) → WhisperX large-v3 + alignement mot à mot → fenêtres de 60-90 s envoyées à `claude-sonnet-5-5` (sortie JSON validée par Zod) → 10-30 meilleurs extraits → aperçus 480p gratuits.
- Le résultat de chaque worker est écrit en base par `/api/worker/callback` (HMAC + horodatage, fenêtre 5 min). L'événement Inngest ne sert qu'à réveiller le pipeline, la base fait foi.

## R2 : CORS pour l'upload direct

Le navigateur envoie le fichier directement sur R2 (URL signée PUT, 4 Go max). Règle CORS du bucket : origine `APP_URL`, méthode `PUT`, en-tête `content-type`.

## Règles d'argent (dans `src/lib`)

- Le solde est égal à `SUM(credit_ledger.delta)`. Aucune ligne n'est jamais modifiée. Chaque écriture porte une `idempotency_key` unique.
- Un job réserve `-n` crédits. Il est ensuite réglé **une seule fois** : `capture` (0) ou `release` (+n). Les deux partagent la clé `settle:<job>`, donc un job ne peut jamais être à la fois débité et remboursé.
- Un job bloqué depuis plus de 15 min est libéré par un cron toutes les 5 min, avec l'e-mail « crédits rendus ».
- Les crédits mensuels expirent au 1er du mois M+2. La consommation se fait dans l'ordre des expirations (les packs, qui n'expirent pas, en dernier).
- Chaque webhook Stripe est appliqué dans une transaction qui contient aussi la ligne `stripe_events`. Un rejeu est ignoré, et un échec est entièrement annulé pour que le renvoi de Stripe le rejoue.

## Variables d'environnement

Voir `.env.example`. Validées au démarrage par Zod (`src/lib/env.ts`). Les connecteurs optionnels sans clés sont masqués dans l'interface : aucun faux import n'est simulé.

## Test de bout en bout et rapports

`pnpm e2e:preflight` puis `pnpm e2e` : voir [docs/E2E.md](docs/E2E.md). Chaque exécution écrit `reports/e2e/latest.md`. Chaque session de travail laisse un rapport dans `reports/sessions/` (règles pour les agents dans [AGENTS.md](AGENTS.md)).

## Sources

Voir [docs/SOURCES.md](docs/SOURCES.md) : matrice, conditions vérifiées, dépendance bloquante pour YouTube.

## Jalons

- [x] **J1** : auth (Google + magic link, case CGU explicite), Stripe (abonnements, packs, portail, résiliation en un écran, rétractation 14 j, rappel annuel), ledger de crédits ; cœur d'import par URL (SSRF, flux vers R2, job idempotent)
- [x] **J2** : worker Modal (ffprobe → WhisperX → sélection Claude → aperçus 480p), écran Nouveau projet (lien → fiche source → droits → import, ou fichier), upload direct R2, progression SSE, grille d'extraits avec score détaillé
- [x] **J2 bis** : scènes (PySceneDetect), visages (MediaPipe Tasks), pics audio → trajectoire de recadrage 9:16 par scène
- [x] **J3** (cœur) : éditeur (découpe, sous-titres éditables mot à mot avec mise en avant, style, cadrage auto/centré/fixe, aperçu des sous-titres en direct), rendu payant 1 crédit (réservé, débité seulement si le fichier est livré), 1080p ou 720p + filigrane selon la formule, -14 LUFS, téléchargement
- [ ] J3 reste : timeline visuelle, B-roll, emoji, brand kits (Pro), bibliothèque musicale sous licence (le rendu sait déjà atténuer une musique sous la voix)
- [x] **J4** : publication TikTok (brouillon dans l'inbox tant que l'app n'est pas auditée, puis directe), YouTube (file qui respecte le quota du projet), Instagram Reels ; interface `PublisherProvider` ; OAuth PKCE ; jetons chiffrés et rafraîchis ; statut des comptes + alerte e-mail ; calendrier semaine/mois avec glisser-déposer et alternative clavier ; créneaux libres. Voir [docs/PUBLISHING.md](docs/PUBLISHING.md)
- [ ] J5 faceless + Veo · J6 analytics (dont métriques des publications) + équipes
