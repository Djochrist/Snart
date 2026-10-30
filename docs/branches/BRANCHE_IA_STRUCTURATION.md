# Branche `feature/ai-structuring` — structuration des signalements

## Périmètre

Intégrer Google Gemini au service de structuration, sans coupler le fournisseur aux routes HTTP ni au code d’interface.

## Capacités attendues

1. Recevoir la description et une éventuelle catégorie choisie par l’utilisateur.
2. Retourner un objet validable contenant `category`, `summary`, `needs_review`, `provider` et `model_id`.
3. Choisir parmi `dechets`, `caniveau_bouche`, `embouteillage` ou `indetermine`.
4. Préserver le texte original et permettre la correction humaine avant ou après l’envoi.
5. Traiter les réponses invalides, les délais d’attente et l’indisponibilité du modèle par une réponse locale de secours clairement identifiée.
6. Garder la clé, le fournisseur, le délai et l’identifiant du modèle configurables par environnement.

## Fichier principal et interface

```text
backend/snart_api/services/structuring.py
```

```python
await structure_report(text: str, category_override: str | None = None) -> StructuredReport
```

`StructuredReport` contient la catégorie, le résumé, le besoin de vérification et la provenance de structuration. Les formats sont définis dans `docs/01_VISION_ET_ARCHITECTURE.md`.

## Responsabilités du modèle

Le modèle structure le texte, propose une catégorie et résume la description. Il ne détermine pas la position, l’heure réelle, la présence d’une personne sur les lieux ni la fiabilité du signalement. Le score est calculé par le service API à partir des confirmations et de la fraîcheur.

## Configuration et données

- Fournisseur : Google Gemini via le SDK officiel `google-genai`.
- Modèle par défaut : `gemini-3.5-flash-lite`, remplaçable avec `SNART_MODEL_ID`.
- Clé : `GEMINI_API_KEY`, côté serveur uniquement. `AI_MODEL` reste accepté comme alias de modèle pour la configuration locale existante.
- `.env` est le fichier local recommandé ; `.env.txt` est aussi chargé si `.env` est absent.
- Les interactions sont envoyées avec `store=false`. Seule la description textuelle est transmise, sans image, coordonnées ni heure.
- Le fournisseur et le modèle réellement utilisés figurent dans la réponse. En cas d’absence de clé ou d’échec, `demo_rules` est indiqué.
- La sortie Gemini est validée côté serveur ; la catégorie manuelle prévaut et le modèle ne décide jamais de la fiabilité ou de la véracité.

## Résultat de branche

Un adaptateur de modèle remplaçable et un contrat JSON stable. L’intégration doit rester compatible avec l’API et le parcours de vérification humaine définis sur `main`.
