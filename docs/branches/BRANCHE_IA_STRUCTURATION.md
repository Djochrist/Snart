# Branche `feature/ai-structuring` — structuration des signalements

## Périmètre

Intégrer le modèle ouvert retenu au service de structuration, sans coupler le modèle aux routes HTTP ni au code d’interface.

## Capacités attendues

1. Recevoir la description et une éventuelle catégorie choisie par l’utilisateur.
2. Retourner un objet validable contenant `category`, `summary`, `needs_review`, `provider` et `model_id`.
3. Choisir parmi `dechets`, `caniveau_bouche`, `embouteillage` ou `indetermine`.
4. Préserver le texte original et permettre la correction humaine avant ou après l’envoi.
5. Traiter les réponses invalides, les délais d’attente et l’indisponibilité du modèle par une réponse de démonstration clairement identifiée.
6. Garder les chemins, paramètres et identifiants de modèle configurables par environnement.

## Fichier principal et interface

```text
backend/sinart_api/services/structuring.py
```

```python
structure_report(text: str, category_override: str | None = None) -> StructuredReport
```

`StructuredReport` contient la catégorie, le résumé, le besoin de vérification et la provenance de structuration. Les formats sont définis dans `docs/01_VISION_ET_ARCHITECTURE.md`.

## Responsabilités du modèle

Le modèle structure le texte, propose une catégorie et résume la description. Il ne détermine pas la position, l’heure réelle, la présence d’une personne sur les lieux ni la fiabilité du signalement. Le score est calculé par le service API à partir des confirmations et de la fraîcheur.

## Configuration et données

- Aucun poids de modèle n’est ajouté au dépôt.
- Le README décrit l’identifiant, les prérequis matériels, la licence et la procédure de récupération du modèle retenu.
- Les clés et chemins privés sont fournis par variables d’environnement, documentées dans `.env.example` sans valeurs secrètes.
- La provenance du moteur (`demo_rules`, `local_model` ou autre identifiant explicite) est incluse dans la réponse.

## Résultat de branche

Un adaptateur de modèle remplaçable et un contrat JSON stable. L’intégration doit rester compatible avec l’API et le parcours de vérification humaine définis sur `main`.
