"""Snart FastAPI application and PWA static-file host."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import init_database
from .routes.reports import router as reports_router

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_database()
    yield


app = FastAPI(
    title="Snart API",
    description="Signalement citoyen et corroboration des observations urbaines.",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(reports_router)


@app.exception_handler(RequestValidationError)
async def invalid_request(_: Request, error: RequestValidationError) -> JSONResponse:
    # Raw inputs can include non-finite numbers or private data. Return only the
    # error description so even invalid JSON numbers produce a valid 422 response.
    details = [
        {key: item[key] for key in ("loc", "msg", "type")}
        for item in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": details})


@app.get("/api/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "snart-api"}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
