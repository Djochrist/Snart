"""Product invariants for the explainable community score."""

from datetime import datetime, timedelta, timezone
import unittest

from snart_api.services.reliability import confidence_score, freshness_state, parse_datetime


class ReliabilityTests(unittest.TestCase):
    now = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)

    def test_category_half_lives_and_staleness(self):
        for category, half_life, stale_after in [
            ("embouteillage", 0.5, 2), ("dechets", 24, 72),
            ("caniveau_bouche", 72, 168), ("indetermine", 24, 24),
        ]:
            with self.subTest(category=category):
                observed = (self.now - timedelta(hours=half_life)).isoformat()
                self.assertAlmostEqual(freshness_state(category, observed, self.now)[0], 0.5)
                threshold = (self.now - timedelta(hours=stale_after)).isoformat()
                self.assertTrue(freshness_state(category, threshold, self.now)[2])

    def test_votes_media_age_and_ceiling(self):
        observed = self.now.isoformat()
        score = lambda nearby, remote, photo: confidence_score(
            "dechets", observed, nearby, remote, photo, self.now)[0]
        self.assertGreater(score(1, 0, False), score(0, 1, False))
        self.assertGreater(score(0, 1, False), score(0, 0, False))
        self.assertGreater(score(0, 0, True), score(0, 0, False))
        self.assertLessEqual(score(10_000, 10_000, True), 95)
        self.assertEqual(score(-10, -10, False), score(0, 0, False))
        old = (self.now - timedelta(days=5)).isoformat()
        self.assertLess(confidence_score("dechets", old, 1, 0, False, self.now)[0], score(1, 0, False))

    def test_timezone_normalization_and_future_clock(self):
        self.assertEqual(parse_datetime("2026-10-31T14:00:00+02:00"), self.now)
        self.assertEqual(parse_datetime("2026-10-31T12:00:00"), self.now)
        future = (self.now + timedelta(days=1)).isoformat()
        self.assertEqual(freshness_state("dechets", future, self.now)[0], 1.0)
