# Héberger Snart sur cPanel

Une seule application Python sert l'interface et l'API sur un même sous-domaine, par exemple `snart.mondomaine.org`. Il n'y a alors rien à régler pour CORS, et `apiBaseUrl` reste vide dans `frontend/config.js`.

## Avant de commencer

Dans cPanel, vérifier :

- **Setup Python App** existe, et propose **Python 3.11 ou plus**. Sans cela, passer à « Si cPanel n'a pas Python 3.11 » plus bas.
- **SSL/TLS Status** peut couvrir le sous-domaine : le GPS et l'installation de la PWA exigent HTTPS.
- **Git Version Control** existe. Sinon, téléverser une archive du dépôt avec le gestionnaire de fichiers.

## Mise en ligne

1. **Sous-domaine.** Dans *Domains*, créer `snart.mondomaine.org`, puis activer le certificat dans *SSL/TLS Status*.
2. **Code.** Dans *Git Version Control*, cloner `https://github.com/Jprintemps/Snart.git`, branche `feature/pwa-frontend`, vers un dossier **hors de** `public_html`, par exemple `/home/compte/snart`. La base SQLite et le fichier `.env` restent ainsi hors du web.
3. **Application Python.** Dans *Setup Python App*, cliquer sur *Create Application* :
   - Python version : 3.11 ou plus récent
   - Application root : `snart`
   - Application URL : `snart.mondomaine.org`
   - Application startup file : `passenger_wsgi.py`
   - Application Entry point : `application`
4. **Dépendances.** Toujours dans la page de l'application, indiquer `requirements-cpanel.txt` dans *Configuration files*, puis cliquer sur *Run Pip Install*.
5. **Variables.** Dans *Environment variables*, ajouter :

   | Nom | Valeur |
   |---|---|
   | `GEMINI_API_KEY` | la clé, jamais dans Git |
   | `SNART_MODEL_PROVIDER` | `gemini` |
   | `SNART_MODEL_ID` | `gemma-4-26b-a4b-it` |
   | `SNART_DATABASE` | `/home/compte/snart-data/snart.sqlite3` |

   La clé se crée dans Google AI Studio : Gemma 4 passe par l'API Google Gemini, d'où le nom du fournisseur. Sans clé valide, l'application utilise les règles locales et l'affiche sur chaque fiche.
6. **Démarrage.** Cliquer sur *Restart*. Si cPanel a remplacé `passenger_wsgi.py` à la création, le restaurer avec *Pull or Deploy* ou `git checkout passenger_wsgi.py`, puis relancer.
7. **Force HTTPS.** Dans *Domains*, activer *Force HTTPS Redirect* pour le sous-domaine.

## Contrôles après mise en ligne

Remplacer le domaine, puis vérifier dans un navigateur :

1. `https://snart.mondomaine.org/api/health` renvoie `{"status":"ok","service":"snart-api"}`.
2. La page d'accueil s'affiche avec le logo, et la pastille indique « En ligne ».
3. Un signalement avec photo se publie, et sa fiche affiche la photo.
   Sa fiche doit indiquer « proposés par l'IA Gemma 4 ». Si elle indique « règles simples », l'appel à Gemma 4 a échoué : voir `stderr.log`.
4. La carte se charge.
5. Passer ensuite à `RECETTE_TELEPHONE.md`.

## Mettre à jour le site

1. Avant de pousser une nouvelle version, changer `CACHE_VERSION` dans `frontend/service-worker.js`. Sans cela, les visiteurs gardent l'ancienne interface.
2. *Git Version Control* → *Pull or Deploy* → *Update from Remote*.
3. *Setup Python App* → *Restart*.

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| Erreur 503 ou page Passenger | Dépendance manquante ou mauvais point d'entrée | Relancer *Run Pip Install*, lire `stderr.log` dans le dossier de l'application |
| `ModuleNotFoundError: a2wsgi` | Le fichier de dépendances n'a pas été utilisé | Refaire l'étape 4 |
| Échec de compilation de Pillow | Hébergeur sans paquet précompilé | Demander à l'hébergeur, ou essayer une autre version de Python |
| « Pas de réseau » alors que le site répond | `apiBaseUrl` renseigné à tort, ou API sur une autre origine | Laisser `apiBaseUrl` vide, ou régler `SNART_CORS_ORIGINS` |
| Erreur 500 à la création | Dossier de la base non accessible en écriture | Vérifier le chemin de `SNART_DATABASE` |
| Interface ancienne après mise à jour | `CACHE_VERSION` inchangée | La changer, redéployer |

## Si cPanel n'a pas Python 3.11

Le frontend reste sur cPanel, l'API part ailleurs.

1. Héberger l'API sur un service Python, avec `SNART_CORS_ORIGINS=https://snart.mondomaine.org` : l'origine exacte, sans barre finale. Le joker `*` est ignoré.
2. Dans `frontend/config.js`, mettre l'adresse HTTPS de l'API dans `apiBaseUrl`.
3. Copier le **contenu** de `frontend/` dans le dossier du sous-domaine. Un sous-répertoire fonctionne aussi, tous les chemins sont relatifs.

## Limites

- SQLite convient à une démonstration ou un pilote, pas à une forte charge : Passenger peut lancer plusieurs processus, et les écritures passent une par une. Prévoir une sauvegarde régulière de `snart-data`.
- L'API et la carte demandent le réseau. Hors ligne, seuls l'interface et la file d'attente fonctionnent.
- Le GPS dépend du navigateur et de HTTPS.
- Le pseudonyme local n'est pas vérifié et change si le stockage du navigateur est effacé.
- Les tuiles OpenStreetMap suivent leur politique d'usage et ne sont pas préchargées.
- Un signalement hors ligne n'est pas publié avant synchronisation. Si une réponse se perd, le renvoi ne crée pas de doublon grâce au `client_id`.
- Les photos de l'accueil sont des images d'illustration générées par IA, à remplacer par des photos de terrain avant toute communication publique.
