# Démo sur Render

Le fichier `render.yaml` prépare un seul service web sur l'offre `free`, sans
disque persistant ni base payante. FastAPI sert l'interface et l'API ensemble.

1. Connecter son compte GitHub à Render et ouvrir **New → Blueprint**.
2. Choisir `Djochrist/Snart`, puis la branche `feature/ai-structuring`.
3. Vérifier que le service `snart-demo` utilise l'offre **Free**, puis lancer le
   déploiement. Aucun secret n'est nécessaire pour le mode local de secours.
4. Attendre l'état **Live**, puis ouvrir l'adresse publique attribuée par Render.
5. Vérifier `/api/health`, puis créer un signalement depuis la page d'accueil.

Les signalements sont stockés dans `/tmp/snart-demo.sqlite3` : ils peuvent
disparaître lors d'un redémarrage ou d'un déploiement. Le service gratuit peut se
mettre en veille. Il convient à une présentation avec des données de démonstration.
Les conditions d'inscription et de vérification de compte restent celles de Render.

## Activer l'appel au modèle

Dans **Environment** du service Render, ajouter `GEMINI_API_KEY` comme secret,
puis appliquer le changement. Ne jamais enregistrer la clé dans `render.yaml` ou Git.

Le modèle demandé est `gemma-4-26b-a4b-it`. Son accès et sa compatibilité avec les
instructions système et les sorties JSON structurées restent à vérifier par un
appel réel. On peut changer `SNART_MODEL_ID` depuis Render.

Créer ensuite un signalement et consulter `/api/reports` : `structuring_mode`
vaut `gemini` si l'appel a réussi, ou `demo_rules` si le secours local a été utilisé.
Une erreur du fournisseur ne bloque pas la création du signalement. Les coûts et
quotas éventuels de l'API Google sont indépendants de l'offre Render.
