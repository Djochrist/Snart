"""Gemma 4 is the default model, reached through the Gemini API."""

from __future__ import annotations

import unittest

from snart_api.services import structuring as ai


class GemmaTests(unittest.TestCase):
    def test_default_model_is_gemma_4(self) -> None:
        self.assertEqual(ai.MODEL_ID, "gemma-4-26b-a4b-it")

    def test_stray_closing_fence_is_ignored(self) -> None:
        # Reply observed from gemma-4-26b-a4b-it on 2026-10-31.
        reply = '{\n  "category": "embouteillage",\n  "needs_review": false\n}\n```'
        self.assertEqual(ai._json_object(reply)["category"], "embouteillage")

    def test_full_code_fence_is_ignored(self) -> None:
        self.assertEqual(ai._json_object('```json\n{"a": 1}\n```'), {"a": 1})

    def test_reply_without_object_is_rejected(self) -> None:
        for reply in ("not json", "[]", "null", "}{"):
            with self.subTest(reply=reply), self.assertRaises(ValueError):
                ai._json_object(reply)

    def test_obstructed_drain_has_priority_over_waste(self) -> None:
        self.assertIn("PRIORITÉ", ai.GEMINI_SYSTEM_INSTRUCTION)
