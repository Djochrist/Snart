# Branche `feature/api-reliability` — API et corroboration

## Périmètre

Développer l’API Python, les schémas, le stockage, la validation des entrées, la gestion des médias et le calcul explicable de l’indice de corroboration.

## Capacités attendues

1. `GET /api/health` indique l’état de disponibilité.
2. `POST /api/reports` valide le texte, les catégories, les coordonnées, la précision et les images, puis enregistre le signalement.
3. `GET /api/reports` renvoie les fiches et facteurs de fiabilité ; filtres de catégorie et statut disponibles.
4. `POST /api/reports/{id}/confirm` vérifie la cohérence du vote et calcule la proximité côté serveur.
5. `POST /api/reports/{id}/resolve` enregistre une observation de résolution.
6. `GET /api/reports/{id}/photo` diffuse le média après validation.
7. Les horodatages, le vieillissement et le score sont cohérents entre listes et fiches détaillées.

## Fichiers principaux

```text
backend/snart_api/
  main.py
  config.py
  database.py
  models.py
  schemas.py
  routes/reports.py
  services/reliability.py
```

## Contrats partagés

Les routes et champs sont définis dans `docs/01_VISION_ET_ARCHITECTURE.md`. Le service d’indice prend un signalement, ses votes et son heure d’observation en entrée et renvoie un score plafonné à 95 ainsi que ses facteurs explicatifs. Les règles de proximité sont appliquées côté serveur ; la position exacte du confirmeur n’est pas incluse dans les réponses publiques.

Le schéma initial utilise SQLite, avec la possibilité d’une migration vers une base serveur pour un déploiement à grande échelle. Les médias sont limités en taille et en type. Les secrets, fichiers SQLite et médias locaux ne sont pas versionnés.

## Résultat de branche

Une API documentée et persistante qui peut recevoir les requêtes de la PWA et exposer des résultats cohérents à la carte. L’indice reste présenté comme une estimation communautaire, jamais comme une preuve certifiée.
