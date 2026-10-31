"""Signalement, consultation, corroboration and media endpoints."""

from __future__ import annotations

import math
import sqlite3
import warnings
from datetime import timedelta
from contextlib import closing
from datetime import datetime, timezone
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import MAX_GPS_ACCURACY_M, MAX_PHOTO_BYTES, NEARBY_RADIUS_M
from ..database import connect
from ..schemas import Category, ConfirmationRequest, ReportRead, StructuredReport
from ..services.reliability import confidence_score, parse_datetime
from ..services.structuring import structure_report

router = APIRouter(prefix="/api/reports", tags=["reports"])
VALID_CATEGORIES = {"dechets", "caniveau_bouche", "embouteillage", "indetermine"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(min(1.0, a)))


def _load_report(report_id: int) -> sqlite3.Row:
    with closing(connect()) as connection:
        row = connection.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Signalement introuvable")
    return row


def _find_by_client_id(reporter_id: str, client_id: str) -> sqlite3.Row | None:
    with closing(connect()) as connection:
        return connection.execute(
            "SELECT * FROM reports WHERE reporter_id = ? AND client_id = ?",
            (reporter_id, client_id),
        ).fetchone()


def _serialize(row: sqlite3.Row) -> ReportRead:
    with closing(connect()) as connection:
        counts = connection.execute(
            """
            SELECT
                SUM(CASE WHEN vote = 'still_present' AND nearby = 1 THEN 1 ELSE 0 END) AS nearby,
                SUM(CASE WHEN vote = 'still_present' AND nearby = 0 THEN 1 ELSE 0 END) AS remote,
                SUM(CASE WHEN vote = 'resolved' AND nearby = 1 THEN 1 ELSE 0 END) AS resolved_nearby,
                SUM(CASE WHEN vote = 'resolved' AND nearby = 0 THEN 1 ELSE 0 END) AS resolved_remote,
                MAX(CASE WHEN vote = 'still_present' THEN created_at END) AS last_confirmed_at
            FROM confirmations WHERE report_id = ?
            """,
            (row["id"],),
        ).fetchone()

    nearby = int(counts["nearby"] or 0)
    remote = int(counts["remote"] or 0)
    resolved_nearby = int(counts["resolved_nearby"] or 0)
    resolved_remote = int(counts["resolved_remote"] or 0)
    last_confirmed_at = counts["last_confirmed_at"]
    effective_observed_at = row["observed_at"]
    if last_confirmed_at and parse_datetime(last_confirmed_at) > parse_datetime(effective_observed_at):
        effective_observed_at = last_confirmed_at
    score, freshness, stale = confidence_score(
        row["category"], effective_observed_at, nearby, remote, bool(row["photo"])
    )
    if resolved_nearby >= 2:
        status = "resolved"
    elif stale:
        status = "stale"
    else:
        status = "active"

    return ReportRead(
        id=row["id"],
        category=row["category"],
        summary=row["summary"],
        description=row["description"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        location_accuracy_m=row["location_accuracy_m"],
        created_at=row["created_at"],
        observed_at=row["observed_at"],
        last_confirmed_at=last_confirmed_at,
        status=status,
        confidence_percent=score,
        confidence_factors={
            "nearby_confirmations": nearby,
            "remote_confirmations": remote,
            "resolution_confirmations": resolved_nearby + resolved_remote,
            "has_photo": bool(row["photo"]),
            "freshness": freshness,
        },
        structuring_mode=row["structuring_mode"],
        model_id=row["model_id"],
        needs_review=bool(row["needs_review"]),
        has_photo=bool(row["photo"]),
    )


async def _read_photo(upload: UploadFile | None) -> tuple[bytes | None, str | None]:
    if upload is None or not upload.filename:
        return None, None
    content_type = (upload.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Le fichier joint doit être une image")
    content = await upload.read(MAX_PHOTO_BYTES + 1)
    if len(content) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Image trop volumineuse (8 Mo maximum)")
    if not content:
        return None, None
    try:
        Image.MAX_IMAGE_PIXELS = 20_000_000
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(status_code=415, detail="Formats acceptés : JPEG, PNG et WebP")
                source.load()
                image_format = source.format
                clean = ImageOps.exif_transpose(source).copy()
                clean.thumbnail((2048, 2048))
                clean.info.clear()
                output = BytesIO()
                if image_format == "JPEG" and clean.mode not in {"RGB", "L"}:
                    clean = clean.convert("RGB")
                save_options = {"optimize": True}
                if image_format in {"JPEG", "WEBP"}:
                    save_options["quality"] = 84
                clean.save(output, format=image_format, **save_options)
                sanitized = output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(status_code=415, detail="Image illisible ou dimensions non prises en charge") from error
    if len(sanitized) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Image trop volumineuse après traitement")
    safe_mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[image_format]
    return sanitized, safe_mime


def _insert_report(values: tuple[object, ...]) -> int:
    with closing(connect()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO reports (
                category, summary, description, latitude, longitude,
                location_accuracy_m, reporter_id, created_at, observed_at,
                photo, photo_mime, structuring_mode, model_id, needs_review, client_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values,
        )
        connection.commit()
        return int(cursor.lastrowid)


@router.get("", response_model=list[ReportRead])
def list_reports(
    category: Annotated[Category | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[ReportRead]:
    sql = "SELECT * FROM reports"
    params: list[object] = []
    if category:
        sql += " WHERE category = ?"
        params.append(category)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with closing(connect()) as connection:
        rows = connection.execute(sql, params).fetchall()
    return [_serialize(row) for row in rows]


@router.post("", response_model=ReportRead, status_code=201)
async def create_report(
    response: Response,
    description: Annotated[str, Form(min_length=8, max_length=2000)],
    reporter_id: Annotated[str, Form(min_length=8, max_length=80)],
    category_override: Annotated[str, Form()] = "auto",
    latitude: Annotated[float | None, Form(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Form(ge=-180, le=180)] = None,
    location_accuracy_m: Annotated[float | None, Form(ge=0, le=100_000)] = None,
    observed_at: Annotated[str | None, Form()] = None,
    client_id: Annotated[str | None, Form(min_length=8, max_length=80)] = None,
    photo: Annotated[UploadFile | None, File()] = None,
) -> ReportRead:
    description = description.strip()
    if len(description) < 8:
        raise HTTPException(status_code=422, detail="La description doit contenir au moins 8 caractères")
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="Latitude et longitude doivent être fournies ensemble")
    if category_override != "auto" and category_override not in VALID_CATEGORIES - {"indetermine"}:
        raise HTTPException(status_code=422, detail="Catégorie inconnue")

    # A resend after a lost response returns the first report instead of a duplicate.
    if client_id:
        existing = _find_by_client_id(reporter_id, client_id)
        if existing is not None:
            response.status_code = 200
            return _serialize(existing)

    try:
        observed = parse_datetime(observed_at) if observed_at else datetime.now(timezone.utc)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Heure d’observation invalide") from error
    now = datetime.now(timezone.utc)
    if observed > now:
        observed = now
    # Protect the freshness score from extreme client clock errors.
    if (now - observed).total_seconds() > 30 * 24 * 3600:
        observed = now - timedelta(days=30)

    structured: StructuredReport = await structure_report(description, category_override)
    photo_bytes, photo_mime = await _read_photo(photo)
    created = _now_iso()
    try:
        report_id = _insert_report(
            (
                structured.category,
                structured.summary,
                description,
                latitude,
                longitude,
                location_accuracy_m,
                reporter_id,
                created,
                observed.isoformat(timespec="seconds").replace("+00:00", "Z"),
                photo_bytes,
                photo_mime,
                structured.provider,
                structured.model_id,
                int(structured.needs_review),
                client_id,
            )
        )
    except sqlite3.IntegrityError:
        # Two concurrent resends: the first one wins.
        response.status_code = 200
        return _serialize(_find_by_client_id(reporter_id, client_id))
    return _serialize(_load_report(report_id))


@router.get("/{report_id}", response_model=ReportRead)
def get_report(report_id: int) -> ReportRead:
    return _serialize(_load_report(report_id))


def _save_vote(report_id: int, payload: ConfirmationRequest, vote: str | None = None) -> ReportRead:
    row = _load_report(report_id)
    if row["reporter_id"] == payload.user_id:
        raise HTTPException(status_code=409, detail="Le signalement initial ne peut pas être confirmé par son auteur")

    nearby = False
    coordinates_present = payload.latitude is not None and payload.longitude is not None
    if (
        coordinates_present
        and row["latitude"] is not None
        and row["longitude"] is not None
        and payload.accuracy_m is not None
        and payload.accuracy_m <= MAX_GPS_ACCURACY_M
    ):
        distance = _distance_m(row["latitude"], row["longitude"], payload.latitude, payload.longitude)
        nearby = distance <= NEARBY_RADIUS_M

    with closing(connect()) as connection:
        connection.execute(
            """
            INSERT INTO confirmations (report_id, user_id, vote, nearby, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(report_id, user_id) DO UPDATE SET
                vote = excluded.vote,
                nearby = excluded.nearby,
                created_at = excluded.created_at
            """,
            (report_id, payload.user_id, vote or payload.vote, int(nearby), _now_iso()),
        )
        connection.commit()
    return _serialize(_load_report(report_id))


@router.post("/{report_id}/confirm", response_model=ReportRead)
def confirm_report(report_id: int, payload: ConfirmationRequest) -> ReportRead:
    return _save_vote(report_id, payload)


@router.post("/{report_id}/resolve", response_model=ReportRead)
def propose_resolution(report_id: int, payload: ConfirmationRequest) -> ReportRead:
    return _save_vote(report_id, payload, vote="resolved")


@router.get("/{report_id}/photo")
def get_photo(report_id: int) -> Response:
    row = _load_report(report_id)
    if not row["photo"] or not row["photo_mime"]:
        raise HTTPException(status_code=404, detail="Aucune image pour ce signalement")
    return Response(
        content=row["photo"],
        media_type=row["photo_mime"],
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )
