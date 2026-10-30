"""Replaceable signal structuring adapter.

The current provider is deliberately marked as a deterministic demonstration.
An open-weight model can replace this implementation without changing the API.
"""

from __future__ import annotations

import os
import re
import unicodedata

from ..schemas import Category, StructuredReport

PROVIDER = os.getenv("SINART_MODEL_PROVIDER", "demo_rules")
MODEL_ID = os.getenv("SINART_MODEL_ID") or None

KEYWORDS: dict[Category, tuple[str, ...]] = {
    "embouteillage": (
        "embouteillage",
        "bouchon de circulation",
        "circulation bloquee",
        "circulation ralentie",
        "trafic bloque",
        "voitures bloquees",
        "route bloquee",
    ),
    "caniveau_bouche": (
        "caniveau",
        "caniveau bouche",
        "canal bouche",
        "egout bouche",
        "eau deborde",
        "eaux debordent",
        "drain bouche",
    ),
    "dechets": (
        "dechet",
        "ordure",
        "salete",
        "immondice",
        "poubelle pleine",
        "tas de plastique",
    ),
}


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold().replace("’", "'"))
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = re.sub(r"[^a-z0-9\s']", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def structure_report(text: str, category_override: str | None = None) -> StructuredReport:
    """Return a structured proposal, preserving uncertainty for human review."""

    cleaned = re.sub(r"\s+", " ", text).strip()
    if category_override and category_override != "auto":
        category: Category = category_override  # validated by the API route
        needs_review = False
    else:
        normalized = _normalize(cleaned)
        matches = [
            (category, sum(1 for word in words if word in normalized))
            for category, words in KEYWORDS.items()
        ]
        matches.sort(key=lambda item: item[1], reverse=True)
        if not matches or matches[0][1] == 0 or (
            len(matches) > 1 and matches[0][1] == matches[1][1]
        ):
            category = "indetermine"
            needs_review = True
        else:
            category = matches[0][0]
            needs_review = False

    summary = cleaned[:237].rstrip()
    if len(cleaned) > 237:
        summary += "..."

    return StructuredReport(
        category=category,
        summary=summary or "Signalement à préciser.",
        needs_review=needs_review,
        provider=PROVIDER,
        model_id=MODEL_ID,
    )
