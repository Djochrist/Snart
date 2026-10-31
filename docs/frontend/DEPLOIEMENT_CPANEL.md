# Déploiement du frontend sur cPanel

Le frontend est statique : aucun runtime Node n'est requis.

1. Activer HTTPS sur le domaine : le GPS et la PWA en ont besoin.
2. Dans `frontend/config.js`, renseigner `apiBaseUrl` avec l'adresse HTTPS de l'API, sans barre finale. Laisser vide si l'API sert aussi le frontend.
3. Téléverser le **contenu** de `frontend/` dans le dossier du domaine. Un sous-répertoire fonctionne : tous les chemins sont relatifs.
4. Si l'API est sur une autre origine, le backend doit autoriser l'origine exacte du frontend en CORS. Ce réglage n'existe pas encore dans `backend/snart_api` : sans lui, l'application affichera « Connexion impossible ».
5. À chaque mise en ligne, changer `CACHE_VERSION` dans `service-worker.js`. Sans ce changement, les visiteurs gardent l'ancienne version.

Contrôles après envoi : page d'accueil, `GET /api/health`, absence d'erreur CORS en console, création avec photo, installation PWA, seconde visite hors ligne, signalement en attente puis synchronisation.

## Limites

- L'API et la carte demandent le réseau ; seuls l'interface et la file d'attente fonctionnent hors ligne.
- Le GPS dépend du navigateur et de HTTPS.
- Le pseudonyme local n'est pas vérifié et change si le stockage du navigateur est effacé.
- Les tuiles OpenStreetMap suivent leur politique d'usage et ne sont pas préchargées.
- Un signalement hors ligne n'est pas publié avant synchronisation. Si la réponse du serveur se perd, un doublon reste possible : l'API n'accepte pas encore de `client_id`.
