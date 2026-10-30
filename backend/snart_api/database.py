"""SQLite persistence for the first Snart deployment profile."""

from __future__ import annotations

import sqlite3
from contextlib import closing

from .config import DATABASE_PATH


def connect() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_database() -> None:
    with closing(connect()) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                location_accuracy_m REAL,
                reporter_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                photo BLOB,
                photo_mime TEXT,
                structuring_mode TEXT NOT NULL,
                model_id TEXT,
                needs_review INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS confirmations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                vote TEXT NOT NULL CHECK (vote IN ('still_present', 'resolved')),
                nearby INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                UNIQUE (report_id, user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_reports_created_at
                ON reports(created_at);
            CREATE INDEX IF NOT EXISTS idx_reports_category
                ON reports(category);
            CREATE INDEX IF NOT EXISTS idx_confirmations_report
                ON confirmations(report_id);
            """
        )
        connection.commit()
