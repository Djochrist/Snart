"""Backend contract tests with a real temporary SQLite database and ASGI requests."""

from contextlib import closing
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from snart_api import database
from snart_api.main import app
from snart_api.routes import reports
from snart_api.services import structuring

NOW = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


def photo_bytes(format="JPEG", size=(32, 32)):
    output = BytesIO()
    image = Image.new("RGB", size, "red")
    exif = Image.Exif()
    exif[270] = "Private metadata"
    image.save(output, format=format, exif=exif)
    return output.getvalue()


class ReportApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.enterContext(patch.object(database, "DATABASE_PATH", Path(self.directory.name) / "snart.sqlite3"))
        self.enterContext(patch.object(structuring, "PROVIDER", "demo_rules"))
        self.enterContext(patch.object(reports, "datetime", FixedDatetime))
        self.client = self.enterContext(TestClient(app))

    def create(self, **changes):
        data = {"description": "Des déchets s'accumulent devant le marché.",
                "reporter_id": "author-0001", "latitude": "-11.66", "longitude": "27.48"}
        data.update(changes)
        response = self.client.post("/api/reports", data=data)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def vote(self, report_id, user="witness-0001", route="confirm", **changes):
        data = {"user_id": user, "latitude": -11.66, "longitude": 27.48, "accuracy_m": 10}
        data.update(changes)
        return self.client.post(f"/api/reports/{report_id}/{route}", json=data)

    def test_health_and_pwa_are_served(self):
        self.assertEqual(self.client.get("/api/health").json()["status"], "ok")
        self.assertIn("text/html", self.client.get("/").headers["content-type"])
        self.assertEqual(self.client.get("/manifest.webmanifest").status_code, 200)

    def test_create_read_list_and_database_persistence(self):
        description = "  Des déchets\n s'accumulent devant le marché.  "
        created = self.create(description=description)
        self.assertEqual(created["description"], description.strip())
        self.assertEqual(created["category"], "dechets")
        self.assertEqual(created["structuring_mode"], "demo_rules")
        self.assertIsNone(created["model_id"])
        self.assertEqual(created["status"], "active")
        self.assertFalse(created["has_photo"])
        self.assertNotIn("reporter_id", created)
        self.assertEqual(self.client.get(f'/api/reports/{created["id"]}').json(), created)
        self.assertEqual(self.client.get("/api/reports").json(), [created])
        database.init_database()  # Initialization may run again without losing data.
        with closing(database.connect()) as connection:
            self.assertEqual(connection.execute("SELECT description FROM reports").fetchone()[0], description.strip())

    def test_invalid_creation_has_no_side_effects(self):
        base = {"description": "Des déchets dans la rue.", "reporter_id": "author-0001"}
        cases = [
            {"description": "court"}, {"description": " " * 8}, {"description": "x" * 2001},
            {"reporter_id": " " * 8}, {"category_override": "unknown"},
            {"latitude": "-11.66"}, {"longitude": "27.48"},
            {"latitude": "91", "longitude": "27"},
            {"latitude": "-11", "longitude": "181"},
            {"latitude": "nan", "longitude": "27"}, {"location_accuracy_m": "-1"},
            {"observed_at": "invalid"}, {"observed_at": "0001-01-01T00:00:00+23:00"},
        ]
        with patch.object(reports, "structure_report", AsyncMock()) as model:
            for change in cases:
                with self.subTest(change=change):
                    response = self.client.post("/api/reports", data=base | change)
                    self.assertEqual(response.status_code, 422, response.text)
            model.assert_not_called()
        self.assertEqual(self.client.get("/api/reports").json(), [])

    def test_manual_category_remains_authoritative(self):
        created = self.create(category_override="embouteillage")
        self.assertEqual(created["category"], "embouteillage")

    def test_optional_location_and_ambiguous_description(self):
        created = self.create(latitude=None, longitude=None, description="Un problème à préciser.")
        self.assertIsNone(created["latitude"])
        self.assertEqual(created["category"], "indetermine")
        self.assertTrue(created["needs_review"])
        voted = self.vote(created["id"]).json()
        self.assertEqual(voted["confidence_factors"]["nearby_confirmations"], 0)
        self.assertEqual(voted["confidence_factors"]["remote_confirmations"], 1)

    def test_dates_are_normalized_and_clamped(self):
        for value, expected in [
            ("2026-10-31T14:00:00+02:00", NOW),
            ("2099-01-01T12:00:00Z", NOW),
            ("2000-01-01T12:00:00Z", NOW - timedelta(days=30)),
        ]:
            with self.subTest(value=value):
                created = self.create(observed_at=value)
                self.assertEqual(created["observed_at"], expected.isoformat(timespec="seconds").replace("+00:00", "Z"))

    def test_author_cannot_confirm_even_with_surrounding_whitespace(self):
        created = self.create(reporter_id="  author-0001  ")
        for user in ("author-0001", " author-0001 "):
            self.assertEqual(self.vote(created["id"], user=user).status_code, 409)

    def test_vote_update_is_unique_and_does_not_store_coordinates(self):
        created = self.create()
        for _ in range(2):
            voted = self.vote(created["id"]).json()
            self.assertEqual(voted["confidence_factors"]["nearby_confirmations"], 1)
        updated = self.vote(created["id"], route="resolve").json()
        self.assertEqual(updated["confidence_factors"]["nearby_confirmations"], 0)
        self.assertEqual(updated["confidence_factors"]["resolution_confirmations"], 1)
        with closing(database.connect()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM confirmations").fetchone()[0], 1)
            columns = {row[1] for row in connection.execute("PRAGMA table_info(confirmations)")}
            self.assertFalse({"latitude", "longitude", "accuracy_m"} & columns)

    def test_proximity_requires_distance_and_sufficient_accuracy(self):
        created = self.create()
        for index, changes in enumerate([
            {"latitude": 0, "longitude": 0}, {"accuracy_m": 101},
            {"accuracy_m": None}, {"latitude": None, "longitude": None},
        ]):
            response = self.vote(created["id"], user=f"witness-{index:04d}", **changes)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["confidence_factors"]["nearby_confirmations"], 0)
        self.assertEqual(response.json()["confidence_factors"]["remote_confirmations"], 4)

    def test_invalid_confirmations_are_rejected(self):
        created = self.create()
        for changes in [
            {"user_id": " " * 8}, {"vote": "invalid"}, {"latitude": None},
            {"longitude": None}, {"latitude": 91}, {"accuracy_m": -1},
            {"accuracy_m": float("inf")}, {"nearby": True},
        ]:
            with self.subTest(changes=changes):
                # Non-finite JSON is deliberately sent as raw JSON for server validation.
                if changes.get("accuracy_m") == float("inf"):
                    response = self.client.post(f'/api/reports/{created["id"]}/confirm',
                        content='{"user_id":"witness-0001","accuracy_m":1e999}',
                        headers={"content-type": "application/json"})
                else:
                    response = self.vote(created["id"], **changes)
                self.assertEqual(response.status_code, 422, response.text)

    def test_remote_votes_do_not_refresh_stale_report(self):
        created = self.create(category_override="embouteillage", observed_at=(NOW - timedelta(hours=3)).isoformat())
        self.assertEqual(created["status"], "stale")
        remote = self.vote(created["id"], latitude=0, longitude=0).json()
        self.assertEqual(remote["status"], "stale")
        self.assertIsNone(remote["last_confirmed_at"])
        nearby = self.vote(created["id"], user="witness-0002").json()
        self.assertEqual(nearby["status"], "active")
        self.assertIsNotNone(nearby["last_confirmed_at"])
        self.assertGreater(nearby["confidence_percent"], remote["confidence_percent"])

    def test_resolution_requires_two_independent_nearby_votes(self):
        created = self.create()
        self.vote(created["id"], user="remote-0001", route="resolve", accuracy_m=999)
        once = self.vote(created["id"], user="nearby-0001", route="resolve").json()
        self.assertEqual(once["status"], "active")
        twice = self.vote(created["id"], user="nearby-0002", route="resolve").json()
        self.assertEqual(twice["status"], "resolved")
        reverted = self.vote(created["id"], user="nearby-0002").json()
        self.assertEqual(reverted["status"], "active")

    def test_filters_apply_before_limit_and_order_is_deterministic(self):
        stale = self.create(category_override="embouteillage", observed_at=(NOW - timedelta(hours=3)).isoformat())
        active = self.create()
        resolved = self.create()
        self.vote(resolved["id"], user="nearby-0001", route="resolve")
        self.vote(resolved["id"], user="nearby-0002", route="resolve")
        for status, expected in (("stale", stale), ("active", active), ("resolved", resolved)):
            result = self.client.get("/api/reports", params={"status": status, "limit": 1}).json()
            self.assertEqual([row["id"] for row in result], [expected["id"]])
        filtered = self.client.get("/api/reports", params={"category": "embouteillage"}).json()
        self.assertEqual([row["id"] for row in filtered], [stale["id"]])
        ordered = self.client.get("/api/reports", params={"limit": 1}).json()
        self.assertEqual(ordered[0]["id"], resolved["id"])
        for params in ({"status": "unknown"}, {"category": "unknown"}, {"limit": 0}, {"limit": 501}):
            self.assertEqual(self.client.get("/api/reports", params=params).status_code, 422)

    def test_photo_is_validated_resized_and_stripped_of_metadata(self):
        content = photo_bytes(size=(2500, 100))
        response = self.client.post("/api/reports", data={
            "description": "Des déchets dans la rue.", "reporter_id": "author-0001"},
            files={"photo": ("private.jpg", content, "image/jpeg")})
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertTrue(created["has_photo"])
        self.assertTrue(created["confidence_factors"]["has_photo"])
        photo = self.client.get(f'/api/reports/{created["id"]}/photo')
        self.assertEqual(photo.headers["content-type"], "image/jpeg")
        self.assertEqual(photo.headers["x-content-type-options"], "nosniff")
        with Image.open(BytesIO(photo.content)) as image:
            self.assertLessEqual(max(image.size), 2048)
            self.assertEqual(len(image.getexif()), 0)

    def test_invalid_photos_are_rejected_before_model_call(self):
        data = {"description": "Des déchets dans la rue.", "reporter_id": "author-0001"}
        for name, content, mime in [
            ("bad.txt", b"text", "text/plain"), ("bad.jpg", b"not an image", "image/jpeg"),
            ("bad.gif", photo_bytes(format="GIF"), "image/gif"),
        ]:
            with self.subTest(name=name), patch.object(reports, "structure_report", AsyncMock()) as model:
                response = self.client.post("/api/reports", data=data, files={"photo": (name, content, mime)})
                self.assertEqual(response.status_code, 415, response.text)
                model.assert_not_called()
        with patch.object(reports, "MAX_PHOTO_BYTES", 8):
            response = self.client.post("/api/reports", data=data,
                files={"photo": ("large.jpg", b"x" * 9, "image/jpeg")})
            self.assertEqual(response.status_code, 413)

    def test_missing_reports_and_missing_photos_return_404(self):
        created = self.create()
        self.assertEqual(self.client.get(f'/api/reports/{created["id"]}/photo').status_code, 404)
        for suffix in ("", "/photo"):
            self.assertEqual(self.client.get(f"/api/reports/99999{suffix}").status_code, 404)
        self.assertEqual(self.vote(99999).status_code, 404)
        self.assertEqual(self.vote(99999, route="resolve").status_code, 404)

    def test_gemini_failure_still_creates_a_persistent_report(self):
        with patch.object(structuring, "PROVIDER", "gemini"), \
             patch.object(structuring, "GEMINI_API_KEY", "test-only"), \
             patch.object(structuring, "_gemini_structure", AsyncMock(side_effect=TimeoutError)):
            with self.assertLogs(structuring.LOGGER, level="WARNING"):
                created = self.create()
        self.assertEqual(created["structuring_mode"], "demo_rules")
        self.assertEqual(self.client.get(f'/api/reports/{created["id"]}').json(), created)

    def test_gemini_provenance_and_review_survive_storage(self):
        suggestion = structuring.GeminiSuggestion(
            category="caniveau_bouche", summary="Possible obstruction du caniveau.", needs_review=True)
        with patch.object(structuring, "PROVIDER", "gemini"), \
             patch.object(structuring, "GEMINI_API_KEY", "test-only"), \
             patch.object(structuring, "_gemini_structure", AsyncMock(return_value=suggestion)):
            created = self.create(description="Le caniveau est peut-être bouché.")
        self.assertEqual(created["structuring_mode"], "gemini")
        self.assertEqual(created["model_id"], structuring.MODEL_ID)
        self.assertTrue(created["needs_review"])
        self.assertEqual(self.client.get(f'/api/reports/{created["id"]}').json(), created)
