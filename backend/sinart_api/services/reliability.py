"""Explainable, configurable community corroboration score."""

from __future__ import annotations

import math
from datetime import datetime, timezone

# Initial half-life values are product defaults and require local calibration.
HALF_LIFE_HOURS = {
    "embouteillage": 0.5,
    "dechets": 24.0,
    "caniveau_bouche": 72.0,
    "indetermine": 24.0,
}
STALE_AFTER_HOURS = {
    "embouteillage": 2.0,
    "dechets": 72.0,
    "caniveau_bouche": 168.0,
    "indetermine": 24.0,
}


def parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def freshness_state(category: str, observed_at: str, now: datetime | None = None) -> tuple[float, str, bool]:
    now = now or datetime.now(timezone.utc)
    age_hours = max(0.0, (now - parse_datetime(observed_at)).total_seconds() / 3600)
    half_life = HALF_LIFE_HOURS.get(category, 24.0)
    freshness = 2 ** (-age_hours / half_life)
    stale = age_hours >= STALE_AFTER_HOURS.get(category, 24.0)
    if age_hours < 0.25:
        label = "récent"
    elif stale:
        label = "à actualiser"
    elif freshness < 0.5:
        label = "en vieillissement"
    else:
        label = "actuel"
    return freshness, label, stale


def confidence_score(
    category: str,
    observed_at: str,
    nearby_confirmations: int,
    remote_confirmations: int,
    has_photo: bool,
    now: datetime | None = None,
) -> tuple[int, str, bool]:
    freshness, label, stale = freshness_state(category, observed_at, now)
    nearby = 1 - math.exp(-max(0, nearby_confirmations) / 3)
    remote = 1 - math.exp(-max(0, remote_confirmations) / 8)
    corroboration = 0.85 * nearby + 0.15 * remote
    media = 1.0 if has_photo else 0.0
    raw = 100 * (0.60 * corroboration + 0.25 * freshness + 0.15 * media)
    return min(95, max(0, round(raw))), label, stale
