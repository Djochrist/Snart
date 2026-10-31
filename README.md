# Snart

**Plateforme citoyenne de signalement urbain intelligent**
*Tu signales, l’IA structure.*

Snart centralise les observations de terrain relatives aux déchets, aux caniveaux bouchés et aux embouteillages. Chaque signalement associe une description, une catégorie structurée, une heure d’observation, une position et, si disponible, une image. Les observations et confirmations alimentent une carte commune ainsi qu’un indice de fiabilité explicable.

Le projet est conçu comme une Progressive Web App (PWA), avec une interface mobile en HTML, CSS et JavaScript vanilla et une API Python. Le dépôt comprend trois branches de travail :

| Branche | Domaine |
|---|---|
| `feature/pwa-frontend` | Application web mobile, carte, médias, localisation et fonctionnement hors ligne |
| `feature/api-reliability` | API, stockage, confirmations de proximité et indice de fiabilité |
| `feature/ai-structuring` | Adaptateur de modèle, classification et structuration des descriptions |

Les trois branches partent de `main` et reviennent vers `main` sous forme de pull requests. Les forks individuels servent d’espaces de contribution ; le dépôt central reste la source de référence.

## Fonctionnement

1. Un témoin décrit un problème, joint éventuellement une photo ou une capture et fournit sa position GPS ou une épingle manuelle.
2. Le service de structuration propose une catégorie et un résumé. La position et l’heure restent des données fournies ou horodatées par l’application, jamais inventées par le modèle.
3. Le signalement apparaît sur la carte et dans une liste filtrable.
4. D’autres personnes peuvent confirmer qu’il est toujours présent. Une confirmation géographiquement proche compte davantage ; une position trop imprécise ne compte pas comme présence sur place.
5. La fraîcheur dépend de la catégorie : un embouteillage vieillit rapidement, tandis qu’un dépôt de déchets ou un caniveau bouché peut persister plus longtemps.

L’indice affiché est une **estimation de corroboration communautaire**, pas une probabilité certifiée de vérité. Il combine la fraîcheur, les confirmations distinctes, leur proximité et la présence d’un média. Chaque fiche expose aussi les éléments qui expliquent son indice.

## Architecture

```text
PWA (HTML/CSS/JavaScript vanilla)
        │ JSON / multipart
        ▼
API Python (FastAPI)
        ├── Structuration IA : catégorie et résumé
        ├── Fiabilité : fraîcheur et confirmations de proximité
        └── SQLite : signalements, confirmations et médias
```

La PWA met en cache son interface et conserve les signalements hors ligne en attente d’envoi. La carte, l’API et la structuration nécessitent une connexion ; les signalements en attente sont présentés comme tels jusqu’à leur synchronisation. Le service de structuration utilise l’API Google Gemini (`gemini-3.5-flash-lite`) pour proposer une catégorie et un résumé. Seule la description textuelle du problème est transmise à Gemini ; les coordonnées, l’heure et la photo restent côté serveur. La clé sert à authentifier l’appel côté serveur et n’est jamais fournie au navigateur. Les requêtes Gemini sont configurées sans conservation des interactions (`store=false`). Sans clé ou si l’API est indisponible, une structuration locale par règles prend le relais et sa provenance reste visible. Les clés d’accès ne sont pas stockées dans Git.

## Démarrage local

Prérequis : Python pris en charge par le projet et `uv` installé.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Ajouter GEMINI_API_KEY dans .env ; la clé n’est jamais utilisée par le navigateur.
uv sync
uv run uvicorn snart_api.main:app --app-dir backend --reload
```

Si le frontend est hébergé sur une autre origine que l’API, `SNART_CORS_ORIGINS` liste ses origines exactes, séparées par des virgules. Le service accepte également le fichier local `.env.txt` déjà utilisé dans certains environnements. `SNART_MODEL_ID` choisit le modèle ; `AI_MODEL` reste accepté comme alias pour la configuration locale existante. Si aucune clé valide n’est disponible, les signalements restent utilisables avec le structurant local de secours.

Ouvrir ensuite `http://127.0.0.1:8000`. Le serveur fournit l’interface, les ressources PWA et l’API. La base SQLite de développement est créée localement dans `data/` et n’est pas versionnée.

## API initiale

| Méthode | Route | Fonction |
|---|---|---|
| `GET` | `/api/health` | État de l’API |
| `GET` | `/api/reports` | Liste filtrable des signalements |
| `GET` | `/api/reports/{id}` | Détail d’un signalement |
| `POST` | `/api/reports` | Crée un signalement avec texte, position et média facultatif |
| `POST` | `/api/reports/{id}/confirm` | Ajoute une confirmation communautaire |
| `POST` | `/api/reports/{id}/resolve` | Propose la résolution d’un signalement |
| `GET` | `/api/reports/{id}/photo` | Récupère le média d’un signalement |

Le format détaillé, les champs, les limites et la politique de score figurent dans [la vision et l’architecture](docs/01_VISION_ET_ARCHITECTURE.md).

## Documentation des branches

- [Vue d’ensemble et architecture](docs/01_VISION_ET_ARCHITECTURE.md)
- [Contribution `feature/pwa-frontend`](docs/branches/BRANCHE_PWA_FRONTEND.md)
- [Contribution `feature/api-reliability`](docs/branches/BRANCHE_API_FIABILITE.md)
- [Contribution `feature/ai-structuring`](docs/branches/BRANCHE_IA_STRUCTURATION.md)
- [Workflow forks, branches et pull requests](CONTRIBUTING.md)

## État du prototype

### Vérification du backend

```bash
uv sync --frozen
PYTHONPATH=backend uv run --frozen python -m unittest discover -s tests -v
```

Les tests couvrent la structuration, le contrat du SDK Gemini sur transport HTTP
simulé, les erreurs et délais, SQLite, les routes, les votes, la proximité, les
dates et les images. Ils utilisent une base temporaire et ne nécessitent pas de
clé. Ils ne valident pas la qualité d'un modèle en ligne.

`GET /api/reports` accepte aussi le filtre `status=active|stale|resolved`, appliqué
avant `limit`. Seules les confirmations de proximité rafraîchissent l'observation
et `last_confirmed_at`. Les coordonnées de confirmation doivent être fournies
ensemble ; les champs inconnus sont rejetés. Les erreurs de validation renvoient
`422` avec `loc`, `msg` et `type`, sans les valeurs d'entrée.

Le choix manuel de catégorie ne supprime pas un avertissement `needs_review`
émis par Gemini. Les sorties inachevées, non conformes au schéma ou dont le résumé
est vide ou dépasse 240 caractères déclenchent le secours local. Le délai global
est de 15 secondes par défaut, configurable entre 1 et 60 secondes. Les règles
locales restent conservatrices sur les négations et les descriptions ambiguës.

Le dépôt fournit un parcours fonctionnel avec une structuration Gemini et un secours local fondé sur des règles. Le contrat `structure_report()` isole le moteur du reste de l’API. Le modèle propose une catégorie et un résumé ; il ne vérifie ni l’heure, ni la position, ni la vérité terrain. Une description ambiguë est marquée pour révision humaine.

## Licence

Snart est distribué sous licence MIT. Voir [LICENSE](LICENSE).
