# Snart — vision fonctionnelle et architecture

## 1. Mission

Snart est une plateforme citoyenne de signalement et de corroboration des problèmes urbains. Elle organise les observations de terrain en informations horodatées, localisées, catégorisées et suivies dans le temps.

### Catégories initiales

| Code | Libellé | Comportement temporel attendu |
|---|---|---|
| `dechets` | Dépôt ou accumulation de déchets | Persistance moyenne ; actualisation recommandée par confirmations |
| `caniveau_bouche` | Caniveau obstrué ou débordement associé | Persistance longue jusqu’à résolution ou confirmation contraire |
| `embouteillage` | Circulation ralentie ou bloquée | Forte décroissance de fraîcheur ; réactualisation fréquente |
| `indetermine` | Description insuffisante ou ambiguë | Vérification humaine requise |

## 2. Parcours de signalement

1. L’interface recueille une description libre, une catégorie facultative, une position GPS ou une épingle manuelle, ainsi qu’une photo ou capture facultative.
2. L’API enregistre l’heure de réception. Le client peut transmettre une heure d’observation lorsqu’un signalement a été mis en attente hors ligne ; cette valeur reste indicative.
3. Le service de structuration propose une catégorie et un résumé. Les données structurées sont présentées comme une proposition révisable.
4. Le signalement apparaît sur la carte avec catégorie, heure, fraîcheur, statut et indice de corroboration.
5. Une confirmation peut déclarer le problème toujours présent ou proposer sa résolution.

Les captures d’écran sont sélectionnées explicitement par l’utilisateur. La PWA n’effectue pas de capture silencieuse d’une autre application. Les permissions de géolocalisation sont demandées au moment du signalement ou de la confirmation.

## 3. Contrat de données

### Signalement

```json
{
  "id": 42,
  "category": "caniveau_bouche",
  "summary": "Caniveau bouché près du marché, avec débordement d’eau.",
  "description": "Le caniveau est bouché près du marché et l’eau déborde.",
  "latitude": -11.66,
  "longitude": 27.48,
  "location_accuracy_m": 32,
  "created_at": "2026-10-31T12:00:00Z",
  "observed_at": "2026-10-31T11:58:00Z",
  "last_confirmed_at": "2026-10-31T12:03:00Z",
  "status": "active",
  "confidence_percent": 74,
  "confidence_factors": {
    "nearby_confirmations": 4,
    "remote_confirmations": 1,
    "has_photo": true,
    "freshness": "recent"
  },
  "structuring_mode": "gemini",
  "needs_review": false,
  "has_photo": true
}
```

### Création — `POST /api/reports`

Requête `multipart/form-data` :

| Champ | Type | Obligatoire | Règle |
|---|---|---|---|
| `description` | texte | oui | 8–2 000 caractères |
| `category_override` | code de catégorie | non | vide ou catégorie déclarée |
| `latitude`, `longitude` | nombres | non | coordonnées GPS ou épingle ; doivent être fournies ensemble |
| `location_accuracy_m` | nombre | non | précision communiquée par le navigateur |
| `observed_at` | ISO-8601 | non | heure déclarée par le client ; indicatif |
| `reporter_id` | identifiant pseudonyme | oui | déduplication du dépôt dans le prototype |
| `photo` | image | non | formats image ; limite de taille côté API |

### Confirmation — `POST /api/reports/{id}/confirm`

```json
{
  "user_id": "identifiant-pseudonyme",
  "vote": "still_present",
  "latitude": -11.6602,
  "longitude": 27.4801,
  "accuracy_m": 26
}
```

`vote` accepte `still_present` ou `resolved`. La position exacte du confirmeur sert au calcul de distance et n’est pas renvoyée dans les données publiques.

## 4. Position et confirmations de proximité

Le serveur compare la position ponctuelle de confirmation à celle du signalement. Une confirmation est qualifiée de « proche » uniquement si les deux positions sont disponibles, la précision GPS respecte le seuil configuré et la distance est dans le rayon configuré. Les valeurs initiales sont des paramètres de prototype à ajuster avec des observations locales.

Le GPS ne prouve pas qu’une personne a réellement observé l’incident. Une position simulée, un appareil partagé ou une erreur de localisation restent possibles. L’indice décrit une corroboration, pas une certitude. Les coordonnées des personnes qui confirment ne sont pas publiées ; le système conserve le statut de proximité et les informations minimales nécessaires au suivi.

## 5. Indice de fiabilité communautaire

Le pourcentage est une échelle explicable de 0 à 95, nommée **indice de corroboration**. La limite à 95 évite de présenter un incident comme certain sur la seule base de votes.

### Facteurs initiaux

| Facteur | Poids de départ | Définition |
|---|---:|---|
| Confirmations indépendantes | 60 % | Confirmations distinctes ; les confirmations proches ont davantage de poids que les confirmations distantes |
| Fraîcheur | 25 % | Décroissance spécifique à la catégorie ; les embouteillages vieillissent le plus rapidement |
| Média joint | 15 % | Présence d’une pièce visuelle ; le média renforce le contexte mais ne prouve pas à lui seul le contenu |

Les composantes sont normalisées entre 0 et 1. Le calcul de départ est :

```text
indice = min(95, arrondi(100 × (0,60 × corroboration
                               + 0,25 × fraîcheur
                               + 0,15 × média)))
```

Une confirmation proche apporte plus à `corroboration` qu’une confirmation distante. Le plafonnement, les poids et les durées de fraîcheur sont des paramètres de lancement, documentés et susceptibles d’être réévalués après validation terrain.

### Présentation

Une fiche expose le score et ses causes, par exemple :

> Fiabilité estimée : 74/100 · 4 confirmations proches · photo jointe · actualisé il y a 6 min

Les signalements anciens sont conservés avec un statut `stale` ou `needs_refresh`. Ils restent consultables, mais leur fraîcheur et leur indice diminuent. Une résolution est elle-même une observation, qui peut recevoir des confirmations.

### Anti-abus — prototype

- Une identité pseudonyme ne peut confirmer un signalement qu’une fois ; un nouveau vote met à jour le vote existant.
- Le compte ayant créé le signalement ne le confirme pas lui-même.
- Les confirmations sans position restent possibles, mais ne comptent pas comme confirmations proches.
- Les limites par identité sont une protection de prototype, pas une défense robuste contre des comptes artificiels.

Une version de production requiert une stratégie de comptes, de limitation d’abus, de conservation des médias, de signalement de contenu et de modération adaptée au contexte de déploiement.

## 6. Vie privée, sécurité et médias

- La position est demandée à l’action et n’est pas suivie en continu.
- Les coordonnées des confirmeurs sont utilisées pour la proximité puis supprimées ; le résultat de proximité est conservé.
- Les métadonnées EXIF des photos peuvent contenir des coordonnées et doivent être supprimées avant une diffusion publique.
- Les images ne sont accessibles que par l’API et passent par validation de type et de taille.
- Les descriptions et médias doivent être considérés comme des contenus non vérifiés.
- Seule la description textuelle est envoyée à l’API Google Gemini pour proposer une catégorie et un résumé ; les coordonnées, l’heure, l’image et les identifiants ne sont pas inclus dans cette requête. `store=false` désactive la conservation des interactions côté API. La clé Gemini reste dans la configuration du serveur.
- Les fichiers `.env`, bases SQLite, caches et poids de modèle sont exclus du dépôt.

## 7. PWA et mode hors ligne

Le manifeste définit le nom, les icônes et l’affichage autonome. Le service worker met en cache l’interface de base. Le formulaire conserve une soumission en attente dans le stockage local lorsque le réseau est indisponible et l’envoie à la reconnexion ; la carte et les services serveur restent dépendants du réseau.

Les médias en attente sont conservés dans IndexedDB. Une soumission hors ligne est marquée comme telle. Pour les embouteillages, l’interface avertit qu’un signalement ancien doit être reconfirmé avant d’être affiché comme actuel.

## 8. Structuration Gemini

Le service utilise `google-genai` et le modèle `gemini-3.5-flash-lite` par défaut. La sortie JSON est limitée à la catégorie, au résumé et au marqueur `needs_review`, puis validée côté serveur. Le choix de catégorie effectué par l’utilisateur reste prioritaire. En l’absence de clé, en cas d’erreur, de délai dépassé ou de réponse invalide, le structurant local `demo_rules` prend le relais sans bloquer le signalement.

Variables : `GEMINI_API_KEY`, `SNART_MODEL_PROVIDER`, `SNART_MODEL_ID` et `SNART_MODEL_TIMEOUT_SECONDS`. `AI_MODEL` est toléré comme alias de compatibilité. Les paramètres secrets sont locaux (`.env` ou `.env.txt`) et ne sont jamais transmis à la PWA.

## 9. Limites de la version initiale

- Gemini structure le texte ; la photo jointe n’est pas encore analysée par le modèle.
- Le calcul de fiabilité est une heuristique communautaire à calibrer, sans données de vérité terrain.
- Les tuiles cartographiques et le traitement serveur nécessitent une connexion.
- Les identifiants pseudonymes du navigateur ne garantissent pas l’unicité réelle d’une personne.
