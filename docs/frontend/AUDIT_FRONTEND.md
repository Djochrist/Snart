# Audit initial du frontend

Base auditée : `main` au commit `e40b3f9`, le 31 octobre 2026. Tous les fichiers de `frontend/` ont été lus en entier, ainsi que les routes et schémas du backend. Les comportements d'API cités ont été vérifiés avec le serveur lancé en local (mode `demo_rules`, sans clé Gemini).

Le dépôt ne contenait aucun test frontend.

## Ce qui marche et doit être conservé

- Création multipart, carte Leaflet 1.9.4, liste, confirmation et résolution branchées sur les bonnes routes.
- Texte utilisateur rendu avec `textContent` : aucun `innerHTML` avec une donnée reçue.
- Clé `localStorage` `snart-anonymous-id` : la garder évite de changer l'identité des navigateurs existants.
- Base IndexedDB `snart-offline-queue`, magasin `reports`, clé `client_id`.
- Palette vert nuit, citron, papier.

## Parcours actuel

```text
Page unique : intro → filtres → formulaire + carte + liste
  Formulaire ─ POST /api/reports ─┬─ succès → message + rechargement
                                  └─ réseau → IndexedDB → synchro au retour
  Filtre ─ tri local du tableau déjà chargé
  Carte ─ popup sans lien vers un détail (il n'y a pas d'écran de détail)
  Liste ─ boutons de vote ─ POST confirm / resolve → rechargement
```

## Appels API existants

| Appel | Lieu | Remarque |
|---|---|---|
| `GET /api/reports` | `loadReports` | Sans paramètre `category` |
| `POST /api/reports` | `sendReport` | `FormData` correct |
| `POST /api/reports/{id}/confirm` et `/resolve` | `submitConfirmation` | Envoie en plus le champ `source`, ignoré par l'API |
| `GET /api/reports/{id}/photo` | `<img>` de la carte de liste | Chaque photo est chargée dans la liste |
| `GET /api/health`, `GET /api/reports/{id}` | non utilisés | Pas d'écran de détail |

## Composants DOM existants

`#reportForm`, `#description`, `#category`, `#locationLabel`, `#locateButton`, `#photo`, `#photoPreview`, `#submitButton`, `#formMessage`, `#networkState`, `#reportsList`, `#emptyState`, `#reportCount`, `#refreshButton`, `#pendingQueue`, `#map`, `.filter-chip`.

## Problèmes constatés

### Fonctionnels

| # | Problème | Cahier |
|---|---|---|
| F1 | Pas d'écran de détail : description originale, heure de création, position et facteurs introuvables | §20 |
| F2 | Pas de navigation accueil / carte / liste / formulaire | §3, §10 |
| F3 | Filtre appliqué en local, sans `?category=` ; pas de garde contre les réponses concurrentes ; `indetermine` non filtrable | §11, §12 |
| F4 | L'épingle n'affiche aucun marqueur et ne se déplace pas ; la position envoyée n'est pas visible | §15 |
| F5 | `location_accuracy_m: 150` inventé pour une épingle manuelle | §13, §15 |
| F6 | Plusieurs signalements au même endroit se recouvrent sans moyen de les atteindre | §11 |
| F7 | `capture="environment"` ouvre directement l'appareil photo sur mobile : la galerie et les captures d'écran deviennent inaccessibles | §16 |
| F8 | `accept="image/*"`, aucune vérification de taille ou de type avant envoi, pas de bouton pour retirer la photo | §16 |
| F9 | Le libellé « Je confirme, résolu » présente la résolution comme acquise | §19 |
| F10 | GPS refusé et GPS absent donnent le même message, sans raison | §14 |
| F11 | Un refus 4xx dans la file bloque tous les éléments suivants (`break`) et n'est jamais affiché | §25 |
| F12 | Une erreur 5xx ne met pas le signalement en file | §26 |
| F13 | Aucun nouvel essai de synchronisation hors de l'événement `online` | §25 |
| F14 | Pas de `timeout` sur les requêtes : une connexion qui traîne laisse le bouton bloqué | §8 |
| F15 | Accueil sans bouton vers la carte ou la liste, pas de réessai quand l'API est indisponible | §10, §12 |

### Bogue confirmé par essai

**B1.** Une erreur 422 de FastAPI renvoie `detail` sous forme de tableau. `new Error(body.detail)` affiche alors `[object Object]` à l'utilisateur. Vérifié avec une description de trois caractères.

### Accessibilité et mobile

| # | Problème | Cahier |
|---|---|---|
| A1 | Tailles de texte de 8 à 12 px sur presque toute l'interface | §6 |
| A2 | Boutons d'action trop petits (padding 6 px, texte 9 px) | §6 |
| A3 | `outline: none` sur les champs, pas de style de focus sur les boutons | §7 |
| A4 | Texte blanc sur orange de catégorie : contraste insuffisant | §7 |
| A5 | Marqueurs de catégorie réduits à une lettre, statut absent de la carte | §11 |
| A6 | Pas de lien d'évitement ; filtres sans état `aria-pressed` | §7 |
| A7 | `orientation: portrait-primary` verrouille l'application installée en portrait | §31 |

### PWA et performance

| # | Problème | Cahier |
|---|---|---|
| P1 | Icône SVG seule : Android attend du PNG 192 et 512, aucune icône `maskable` | §23 |
| P2 | Chemins absolus partout : l'application casse sous un sous-répertoire cPanel | §23, §32 |
| P3 | L'URL de l'API n'est pas configurable : un hébergement séparé est impossible | §32 |
| P4 | Le service worker met en cache tout GET de même origine, pas seulement le shell | §24 |
| P5 | `skipWaiting` immédiat : une page ouverte peut mélanger deux versions | §24 |
| P6 | Leaflet bloque le rendu de toutes les pages, même sans carte | §27 |
| P7 | Toutes les photos sont chargées dans la liste | §27 |
| P8 | `@import` Google Fonts dans le CSS retarde le premier affichage | §27 |

## Écarts entre la documentation et le code

### À trancher par le propriétaire du dépôt

| # | Écart | Décision appliquée en attendant |
|---|---|---|
| D1 | `BRANCHE_PWA_FRONTEND.md` demande un aperçu du résumé et de la catégorie renvoyés par l'API **avant** envoi. L'API n'a pas de route d'aperçu : `POST /api/reports` publie directement. | Le cahier §13 prime : le résultat est affiché après publication. |
| D2 | Aucune configuration CORS dans le backend (vérifié : pas d'en-tête `Access-Control-Allow-Origin`). Un frontend sur cPanel et une API ailleurs ne peuvent pas communiquer. | Traité ensuite : `SNART_CORS_ORIGINS` liste les origines exactes autorisées. |
| D3 | La file hors ligne ne peut pas garantir l'absence de doublon si la réponse du serveur se perd : l'API n'accepte pas de `client_id`. | Traité ensuite : l'API accepte un `client_id` facultatif et idempotent, envoyé par le frontend. |

### Sans conséquence pour l'utilisateur

| # | Écart | Traitement |
|---|---|---|
| D4 | Le document d'architecture donne `freshness: "recent"` ; l'API renvoie `récent`, `actuel`, `en vieillissement`, `à actualiser`. | Le libellé reçu est affiché tel quel. |
| D5 | `ReportRead` contient `can_confirm` (toujours `true`) et `resolution_confirmations`, absents du document. | `resolution_confirmations` est affiché. `can_confirm` est ignoré, il n'apporte aucune information. |
| D6 | Le document cite un statut `needs_refresh` ; le schéma ne connaît que `active`, `stale`, `resolved`. | Seuls les trois statuts du schéma sont gérés. |
| D7 | Le document parle de « formats image » ; le backend n'accepte que JPEG, PNG et WebP. | La règle du backend est appliquée. |

## Remarques pour la branche backend

Hors périmètre de cette branche, à transmettre :

- `structure_report()` est appelée **avant** la validation de la photo : une photo refusée consomme quand même un appel Gemini.
- `GET /api/reports` ouvre une connexion SQLite par signalement dans `_serialize` (jusqu'à 200 par défaut).
- `GET /api/reports/{id}` et la liste exposent `location_accuracy_m`, ce qui est prévu, mais `can_confirm` ne reflète rien : le client ne peut pas savoir à l'avance qu'il est l'auteur.

## Plan de modification

1. Client API central, tests unitaires sans dépendance (`node --test`), messages d'erreur.
2. Découpage en modules ES natifs, navigation par hash, chemins relatifs, `config.js`.
3. Formulaire, validation, GPS, épingle, photo.
4. Carte et liste filtrées par l'API.
5. Fiche détaillée, indice, votes.
6. Manifest, icônes, service worker.
7. File hors ligne fiabilisée.
8. Accessibilité, performance.
9. Recette réelle et documentation de déploiement.

Le logo et l'identité visuelle arriveront plus tard : couleurs et polices restent regroupées dans `:root`, les icônes dans `frontend/icons/`.
