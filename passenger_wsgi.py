"""Point d'entrée cPanel : Passenger parle WSGI, l'application FastAPI parle ASGI."""

from __future__ import annotations

import sys
from pathlib import Path

from a2wsgi import ASGIMiddleware

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from snart_api.database import init_database  # noqa: E402
from snart_api.main import app  # noqa: E402

# a2wsgi ne déclenche pas le lifespan de FastAPI : la base est préparée ici.
init_database()
application = ASGIMiddleware(app)
