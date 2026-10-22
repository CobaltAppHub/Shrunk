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

`pnpm test` : 58 tests (barème, ledger, idempotence Stripe sur un vrai Postgres embarqué via PGlite, SSRF, détection de contenu). Ils ne nécessitent ni réseau ni base de données, sauf le test DNS anti-rebinding qui résout `127.0.0.1.nip.io`.

## Configuration Stripe (une fois)

1. Produits `starter`, `pro`, `agency` avec deux prix chacun, en EUR, **tax behavior = inclusive**, et les lookup keys `starter_month`, `starter_year`, `pro_month`… (annuel = mensuel × 12 × 0,8).
2. Activer Stripe Tax (enregistrement TVA FR + guichet OSS UE).
3. Portail client : autoriser la résiliation, le changement de formule et l'accès aux factures.
4. Billing › Subscriptions › « Upcoming renewal events » réglé sur **7 jours**. Le webhook `invoice.upcoming` déclenche l'e-mail de rappel annuel.
5. Webhook `/api/stripe/webhook` avec les événements `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` et `invoice.upcoming`.

## Règles d'argent (dans `src/lib`)

- Le solde est égal à `SUM(credit_ledger.delta)`. Aucune ligne n'est jamais modifiée. Chaque écriture porte une `idempotency_key` unique.
- Un job réserve `-n` crédits. Il est ensuite réglé **une seule fois** : `capture` (0) ou `release` (+n). Les deux partagent la clé `settle:<job>`, donc un job ne peut jamais être à la fois débité et remboursé.
- Un job bloqué depuis plus de 15 min est libéré par un cron toutes les 5 min, avec l'e-mail « crédits rendus ».
- Les crédits mensuels expirent au 1er du mois M+2. La consommation se fait dans l'ordre des expirations (les packs, qui n'expirent pas, en dernier).
- Chaque webhook Stripe est appliqué dans une transaction qui contient aussi la ligne `stripe_events`. Un rejeu est ignoré, et un échec est entièrement annulé pour que le renvoi de Stripe le rejoue.

## Variables d'environnement

Voir `.env.example`. Validées au démarrage par Zod (`src/lib/env.ts`). Les connecteurs optionnels sans clés sont masqués dans l'interface : aucun faux import n'est simulé.

## Sources

Voir [docs/SOURCES.md](docs/SOURCES.md) : matrice, conditions vérifiées, dépendance bloquante pour YouTube.

## Jalons

- [x] **J1** : auth (Google + magic link, case CGU explicite), Stripe (abonnements, packs, portail, résiliation en un écran, rétractation 14 j, rappel annuel), ledger de crédits ; cœur d'import par URL (SSRF, flux vers R2, job idempotent)
- [ ] **J2** : worker Modal (ffprobe → WhisperX → scènes et visages → sélection Claude → aperçus 480p), écran Nouveau projet, upload multipart, progression SSE
- [ ] J3 éditeur · J4 publication · J5 faceless + Veo · J6 analytics + équipes
