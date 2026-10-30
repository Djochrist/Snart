# Contribution et intégration

## Dépôt de référence

`Djochrist/Snart` est le dépôt central. Sa branche `main` contient l’état intégré et sert de base aux trois branches de travail. Les contributions externes sont proposées par pull request ; la fusion dans `main` est réservée aux mainteneurs du dépôt.

Pour qu’un fork existe par contributeur, le dépôt de référence peut être détenu par une organisation GitHub. Si le dépôt appartient au compte d’un membre, ce propriétaire travaille sur une branche du dépôt central ; les autres contributeurs peuvent le forker.

## Cycle de contribution

1. Forker le dépôt central et cloner le fork localement.
2. Ajouter le dépôt central sous le nom `upstream`.
3. Synchroniser `main` depuis `upstream/main` avant de commencer.
4. Créer une branche correspondant à un seul périmètre.
5. Publier une pull request vers `Djochrist/Snart:main` en liant la tâche GitHub correspondante.
6. Après fusion, synchroniser le fork avant le prochain travail.

```bash
git clone https://github.com/<compte>/Snart.git
cd Snart
git remote add upstream https://github.com/Djochrist/Snart.git
git fetch upstream
git switch main
git merge upstream/main
```

Une branche de travail est créée à partir d’un `main` synchronisé :

```bash
git switch -c feature/pwa-frontend
```

Après le commit, la branche est envoyée vers le fork personnel :

```bash
git add <fichiers-concernés>
git commit -m "feat: décrire le changement"
git push -u origin feature/pwa-frontend
```

La pull request cible ensuite `Djochrist/Snart:main`. Le comparatif doit afficher le fork personnel et la branche de contribution comme source, et le dépôt central `main` comme destination.

## Trois branches de travail

| Branche | Répertoire principal | Interface contractuelle |
|---|---|---|
| `feature/pwa-frontend` | `frontend/` | Routes `/api/reports` et schémas de `docs/01_VISION_ET_ARCHITECTURE.md` |
| `feature/api-reliability` | `backend/snart_api/` | Schémas Pydantic et routes publiées par l’API |
| `feature/ai-structuring` | `backend/snart_api/services/structuring.py` | Fonction `structure_report(text, category_override)` |

Les branches sont des espaces de travail parallèles, pas trois produits indépendants. Les changements doivent respecter les contrats communs et revenir dans `main` par pull request.

## Gestion des dépendances et secrets

- `pyproject.toml` et `uv.lock` sont versionnés ; les environnements locaux sont préparés avec `uv sync`.
- Les modifications de dépendances sont coordonnées par un mainteneur afin de réduire les conflits de lockfile.
- Les variables locales sont conservées dans `.env`, ignoré par Git. `.env.example` ne contient que des noms de variables et des valeurs d’exemple non sensibles.
- Les poids de modèles, bases locales, médias téléversés et secrets ne sont pas ajoutés au dépôt.
- Le frontend reste en JavaScript vanilla ; aucun gestionnaire de paquets JavaScript n’est requis pour la version initiale.

## Critères de pull request

- Le périmètre correspond à une tâche identifiable.
- Les fichiers touchés restent dans le domaine de la branche autant que possible.
- Les changements de format d’API ou de schéma sont annoncés dans la pull request et répercutés dans la documentation.
- Aucun secret, média privé ou base locale n’est inclus.
- La description précise le comportement livré, les limites connues et les éléments à intégrer dans les autres branches.
