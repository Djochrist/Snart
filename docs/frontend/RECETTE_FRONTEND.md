# Recette du frontend

Tests unitaires, sans dépendance (Node 22.7 ou plus) :

```bash
node --test "tests/frontend/*.test.mjs"
```

Recette de bout en bout dans Chrome, sur une base jetable (Playwright pour Python et `uv sync` requis) :

```bash
python tests/frontend/e2e_pwa.py
```

Données de démonstration synthétiques, à publier uniquement sur une base de test :

```bash
node tests/frontend/seed-demo.mjs http://127.0.0.1:8000
```

Le GPS de ces essais est simulé par Chrome. La recette sur téléphone réel (GPS, appareil photo, réseau instable, installation) reste à faire.
