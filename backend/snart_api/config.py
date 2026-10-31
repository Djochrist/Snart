"""Runtime configuration for Snart."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"
if not ENV_FILE.exists():
    ENV_FILE = PROJECT_ROOT / ".env.txt"
load_dotenv(ENV_FILE)


def _path_from_env(name: str, default: str) -> Path:
    value = Path(os.getenv(name, default)).expanduser()
    return value if value.is_absolute() else PROJECT_ROOT / value


DATABASE_PATH = _path_from_env("SNART_DATABASE", "data/snart.sqlite3")
NEARBY_RADIUS_M = float(os.getenv("SNART_NEARBY_RADIUS_M", "150"))
MAX_GPS_ACCURACY_M = float(os.getenv("SNART_MAX_GPS_ACCURACY_M", "100"))
MAX_PHOTO_BYTES = int(os.getenv("SNART_MAX_PHOTO_BYTES", str(8 * 1024 * 1024)))
# Exact frontend origins, comma-separated. A wildcard is deliberately ignored.
CORS_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("SNART_CORS_ORIGINS", "").split(",")
    if origin.strip() and origin.strip() != "*"
]
