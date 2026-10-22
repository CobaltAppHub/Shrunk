# Marge par formule

Aucun chiffre de coût n'est inscrit ici tant qu'il n'a pas été mesuré. Les coûts réels proviennent de `jobs.cost_usd` (renseigné par chaque worker à partir de la facturation Modal, Anthropic, ElevenLabs et Gemini) et de la facture R2.

## Formule

```
revenu_HT(plan)      = prix_TTC / 1,20  − frais Stripe (1,5 % + 0,25 € carte UE)
coût(plan)           = Σ_action  crédits_consommés(action) × coût_unitaire(action)
                     + minutes_analysées × coût_analyse_par_min      (WhisperX + LLM, gratuit pour l'utilisateur)
                     + Go_stockés × prix_R2_Go_mois                   (sources purgées à 30 j)
marge(plan)          = revenu_HT − coût   (au pire cas : 100 % des crédits consommés)
```

## Requête pour les coûts unitaires (à exécuter dès J2)

```sql
select type, count(*), avg(cost_usd) as cout_moyen, sum(credit_cost) as credits
from jobs where status = 'succeeded' and finished_at > now() - interval '30 days'
group by type;
```

Coût LLM par source : ligne `jobs` de clé `select:<asset>` (calculé depuis `usage` au tarif `claude-sonnet-5-5`, 2 $ / 10 $ par MTok). Coût GPU/CPU : lignes `transcribe:<asset>` et `previews:<asset>`.

## Tableau (à remplir avec des mesures)

| Formule | Prix TTC | Revenu HT net | Crédits | Coût pire cas | Marge |
|---|---|---|---|---|---|
| Gratuit | 0 € | 0 € | 3 | _mesure_ | _négative, à plafonner_ |
| Starter | 15 € | _calcul_ | 60 | _mesure_ | _calcul_ |
| Pro | 29 € | _calcul_ | 200 | _mesure_ | _calcul_ |
| Agence | 79 € | _calcul_ | 600 | _mesure_ | _calcul_ |

Point d'attention connu : un crédit Veo standard (30 crédits pour 8 s) doit couvrir le prix Gemini du moment. Vérifie la grille tarifaire officielle avant d'activer l'option premium.
