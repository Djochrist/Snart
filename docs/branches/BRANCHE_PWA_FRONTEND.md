# Branche `feature/pwa-frontend` — application web progressive

## Périmètre

Construire l’expérience mobile Sinart en HTML, CSS et JavaScript vanilla. La branche possède les écrans, la carte et les interactions navigateur ; elle consomme l’API définie dans `docs/01_VISION_ET_ARCHITECTURE.md`.

## Capacités attendues

1. Accueil avec carte et liste, filtres par déchets, caniveaux bouchés et embouteillages.
2. Formulaire : description libre, catégorie proposée/modifiable, pièce visuelle facultative, position GPS ou épingle manuelle.
3. Aperçu avant envoi du résumé et de la catégorie renvoyés par l’API.
4. Fiche signalement : heure, fraîcheur, statut, score et facteurs explicatifs.
5. Action de confirmation demandant la position à la demande ; solution de repli sans GPS, classée comme confirmation distante.
6. Manifest, icône et service worker pour installation et cache de l’interface.
7. File IndexedDB des soumissions hors ligne, synchronisée lorsque l’application revient en ligne.

## Fichiers principaux

```text
frontend/
  index.html
  styles.css
  app.js
  manifest.webmanifest
  service-worker.js
  icons/sinart.svg
```

## Contrat d’intégration

- `POST /api/reports` via `FormData` avec `description`, `category_override`, position, précision, heure d’observation, identifiant pseudonyme et image facultative.
- `GET /api/reports` pour remplir la carte et la liste.
- `POST /api/reports/{id}/confirm` avec vote et position ponctuelle si disponible.
- Les champs de réponse sont ceux du schéma de signalement dans la vision d’architecture.

## Limites et principes

- Aucun framework JavaScript ni bundler n’est requis.
- Aucun suivi de position en arrière-plan.
- Le texte provenant des utilisateurs est rendu comme texte, jamais comme HTML exécutable.
- L’interface distingue les données hors ligne, périmées et confirmées.
- La carte affiche l’attribution du fournisseur de tuiles.
- La capture d’écran est jointe par sélection explicite ; l’interface ne prétend pas capturer l’écran d’une autre application.

## Résultat de branche

Une PWA mobile cohérente qui permet de créer, consulter, filtrer et confirmer des signalements, avec un parcours d’attente hors ligne clairement identifié.
