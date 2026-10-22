# Matrice des sources

Vérifiée le 22/10/2026. Trois questions distinctes par source : **reconnaître** le lien, **lire les métadonnées**, **récupérer réellement le fichier**.

| Source | Reconnaissance | Métadonnées | Récupération du média | Identifiants requis | Limites / conditions vérifiées | État dans le code |
|---|---|---|---|---|---|---|
| **URL directe** (fichier .mp4/.mov/.webm…, URL signée S3/R2/GCS) | toute URL https non prise par un autre connecteur | nom de fichier, taille (Content-Length / Content-Range) | `GET` en streaming via `safeFetch` → R2 | aucun | 4 Go, contenu vérifié par octets magiques puis ffprobe (J2) ; 401/403 sur URL signée = `link_expired` | ✅ implémenté (`src/sources/direct.ts`) |
| **YouTube** | `youtube.com`, `youtu.be`, `/shorts/`, `/embed/`, `/live/` | oEmbed public (titre, chaîne, miniature) | ❌ **aucun mécanisme conforme** | — | CGU YouTube : interdiction d'« accéder à, reproduire, télécharger » sauf si le Service le permet explicitement ou avec autorisation écrite préalable de YouTube ; accès automatisé restreint. La Data API n'a pas d'endpoint de téléchargement média. | ✅ métadonnées seulement → `source_file_required` (`src/sources/youtube.ts`) |
| **Vimeo** | `vimeo.com/<id>`, `player.vimeo.com` | oEmbed public | champ `download` de l'API (liens expirant à 24 h, redirections 302 vers CDN) | OAuth utilisateur, scopes `public private video_files` | Liens fournis seulement si le propriétaire a un plan payant et autorise le téléchargement, ou s'il s'agit de ses propres vidéos | ⏳ à faire (après le flux OAuth) |
| **Google Drive** | `drive.google.com/file/d/<id>` | `files.get` | `files.get?alt=media` (Range supporté) | OAuth, scope `drive.readonly` (restreint → vérification Google + audit CASA) ou `drive.file` + Google Picker | respecter `capabilities.canDownload` et les restrictions de téléchargement posées par le propriétaire | ⏳ à faire |
| **Dropbox** | `dropbox.com/s/…`, `/scl/fi/…` | `sharing/get_shared_link_metadata` | `sharing/get_shared_link_file` (contenu brut) | app Dropbox, scope `sharing.read` (à reconfirmer dans la doc officielle : rapports contradictoires sur le forum) | support des liens `/scl/fi/` à valider en test | ⏳ à faire |
| **Upload local** | — | ffprobe (worker) | PUT direct vers R2 (URL signée 6 h) ; taille revérifiée côté serveur sur l'objet stocké | aucun | 4 Go / 3 h | ✅ J2 |

## Ce qui bloque l'import YouTube en production

1. **Les CGU YouTube** interdisent le téléchargement par un service tiers, sauf permission explicite ou autorisation écrite de YouTube. Aucune API publique de Google ne fournit le fichier vidéo, même pour la chaîne du propriétaire (YouTube Studio et Google Takeout sont des téléchargements manuels).
2. **Les « API YouTube download » tierces** (services de scraping) reposent sur le contournement de ces conditions : aucune n'a pu être vérifiée comme conforme. Elles ne sont donc pas intégrées.
3. **Seules voies conformes** : (a) un accord écrit avec YouTube/Google ; (b) l'utilisateur ou son client fournit le fichier (upload, Drive, Dropbox, URL directe). C'est le recours proposé à l'écran : la fiche source est conservée (titre, créateur, URL d'origine) et l'utilisateur joint le fichier correspondant.

## Sécurité (implémentée)

`src/sources/safe-fetch.ts` : https seul en production, pas d'identifiants dans l'URL, ports 80/443 uniquement. Les IP littérales sont validées avant la connexion, les noms DNS au moment même de la connexion (hook `lookup` du socket : l'adresse validée est celle utilisée, ce qui neutralise le DNS rebinding). Plages bloquées en IPv4 et en IPv6, y compris ::ffff:x et NAT64. Redirections limitées à 5, revalidées à chaque saut, avec suppression d'`Authorization` et de `Cookie` en cas de changement d'origine. Délai de connexion 10 s, en-têtes 15 s, inactivité 60 s. Limite d'octets appliquée pendant le flux. Concurrence : 2 imports par espace de travail et 20 au total (Inngest). Inspections : 10 par minute et par utilisateur.
