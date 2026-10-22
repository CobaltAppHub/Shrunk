# Publication

Docs des trois API vérifiées le 23/10/2026. Le code est dans `src/publish/` : une interface `PublisherProvider` et un fichier par plateforme.

| | TikTok | YouTube | Instagram |
|---|---|---|---|
| API | Content Posting API | Data API v3 `videos.insert` (upload reprenable) | Instagram API avec Instagram Login (`graph.instagram.com`) |
| Mode tant que l'app n'est pas auditée/validée | **Boîte de réception (brouillon)** : la vidéo arrive dans l'inbox TikTok, le créateur finit la publication dans l'app. L'écran Comptes le dit. | Publication directe | Publication directe (les permissions demandent la validation de l'app par Meta) |
| Après audit | `TIKTOK_AUDITED=1` : publication directe ; niveau de confidentialité choisi parmi ceux renvoyés par `creator_info` | — | — |
| Scopes | `user.info.basic`, `video.upload` (puis `video.publish`) | `youtube.upload`, `youtube.readonly` | `instagram_business_basic`, `instagram_business_content_publish` |
| Envoi du fichier | `FILE_UPLOAD` par morceaux depuis R2 (5-64 Mo, dernier ≤ 128 Mo, ≤ 1000) | PUT unique sur la session reprenable | URL R2 signée 2 h (Meta va chercher le fichier) |
| Limites appliquées par Shrunk avant l'appel | 5 envois en attente / 24 h par compte (inbox) ; 6 req/min par jeton | **File unique** pour toute l'app : `YOUTUBE_DAILY_UPLOADS` (100 par défaut, quota « Video Uploads » du projet), remise à zéro à minuit heure du Pacifique | 100 publications / 24 h glissantes par compte |
| Jetons | accès 24 h, refresh 365 j (le refresh peut renvoyer un nouveau refresh token, toujours stocké) | accès 1 h, refresh longue durée | jeton long de 60 j, rafraîchi pendant sa dernière semaine |
| Label IA | `is_aigc` (publication directe) | `status.containsSyntheticMedia` | mention dans la légende |
| Comptes éligibles | tout compte | compte Google avec une chaîne | compte professionnel (Business ou Créateur) |

## Garanties

- **Jamais deux fois la même vidéo.** `attempted_at` est écrit juste avant le premier appel à la plateforme. Si une exécution plante ensuite, la publication passe en `failed / uncertain_state` et l'interface demande de vérifier sur la plateforme avant de relancer. Seules les erreurs qui prouvent que rien n'a été créé (429, 5xx, quota) sont relancées automatiquement.
- **Double clic** : la clé `scheduled_posts.idempotency_key` (`<clé du formulaire>:<compte>`) est unique.
- **Déplacement dans le calendrier** : un nouvel événement est envoyé. L'ancienne exécution se réveille, voit que la date a changé et s'arrête.
- **Compte déconnecté** : un refresh refusé (ou un 401) passe le compte en `expired` et prévient le propriétaire par e-mail. Les publications sur ce compte échouent avec `account_disconnected` au lieu de réessayer à l'infini. Un cron toutes les 6 h rafraîchit les jetons proches de l'expiration et détecte les révocations.
- **Jetons** chiffrés en AES-256-GCM (`DATA_ENCRYPTION_KEY`), effacés à la déconnexion.
- **OAuth** : PKCE S256 (TikTok, Google). L'état est signé en HMAC, lié à l'utilisateur et à la plateforme, et expire après 10 min (cookie httpOnly).

## À faire côté comptes développeur (bloquant pour la production)

1. **TikTok for Developers** : créer l'app, activer Login Kit + Content Posting API, déclarer `<APP_URL>/api/social/tiktok/callback`, puis **demander l'audit** pour sortir du mode brouillon.
2. **Google Cloud** : activer YouTube Data API v3, écran de consentement OAuth (scopes sensibles → vérification Google), redirection `<APP_URL>/api/social/youtube/callback`. Demander une hausse du quota « Video Uploads » si 100/jour ne suffit pas, puis l'indiquer dans `YOUTUBE_DAILY_UPLOADS`.
3. **Meta for Developers** : app avec le produit « Instagram API with Instagram Login », redirection `<APP_URL>/api/social/instagram/callback`, **App Review** des deux permissions. Les URL d'OAuth Instagram du code suivent la doc Meta : à revérifier à la création de l'app.

## Non couvert

- Agrégateur de secours (Ayrshare, Upload-Post) : il suffira d'ajouter une implémentation de `PublisherProvider`.
- Récupération des métriques toutes les 6 h puis quotidienne : J6 (analytics).
- Les créneaux proposés sont simplement **libres**, pas « optimaux » : aucune donnée d'engagement n'existe encore pour les classer.
