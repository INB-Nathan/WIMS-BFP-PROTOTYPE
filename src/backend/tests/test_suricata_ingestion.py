"""
Suricata EVE log ingestion tests.

Validates that EVE alert lines are parsed and inserted into wims.security_threat_logs
with correct source_ip, destination_ip, suricata_sid, severity_level, and raw_payload.

Run (from src/):
  docker compose run --rm backend pytest tests/test_suricata_ingestion.py -v

Manual verification:
  To verify end-to-end: `docker compose up -d wims-suricata`, wait for alerts to be
  generated, then ensure celery-worker is running (with beat). Query:
    SELECT * FROM wims.security_threat_logs ORDER BY log_id DESC LIMIT 5
  and confirm new rows appear as Suricata produces alerts.
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest
from sqlalchemy import text, create_engine
from sqlalchemy.orm import sessionmaker

# Import ingestion logic (will be created)
from services.suricata_ingestion import (
    parse_eve_alert_line,
    eve_to_threat_log_row,
    ingest_eve_file,
)


def _get_engine():
    """Return sync engine for integration tests."""
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@postgres:5432/wims",
    )
    return create_engine(url)


@pytest.fixture
def db_session():
    """Provide a database session for tests."""
    engine = _get_engine()
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = Session()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _minimal_eve_alert_line() -> str:
    """Return a minimal valid EVE alert line (NDJSON)."""
    ev = {
        "event_type": "alert",
        "src_ip": "192.168.1.100",
        "dest_ip": "10.0.0.50",
        "timestamp": "2025-03-14T12:00:00.123456+0000",
        "alert": {
            "signature_id": 2000001,
            "severity": 2,
        },
    }
    return json.dumps(ev)


class TestParseEveAlertLine:
    """parse_eve_alert_line returns parsed dict or None."""

    def test_alert_line_returns_dict(self):
        """event_type=alert returns parsed dict."""
        line = _minimal_eve_alert_line()
        result = parse_eve_alert_line(line)
        assert result is not None
        assert result["event_type"] == "alert"
        assert result["src_ip"] == "192.168.1.100"
        assert result["dest_ip"] == "10.0.0.50"
        assert result["alert"]["signature_id"] == 2000001
        assert result["alert"]["severity"] == 2

    def test_non_alert_returns_none(self):
        """Non-alert event types return None."""
        line = json.dumps({"event_type": "flow", "src_ip": "1.2.3.4"})
        assert parse_eve_alert_line(line) is None

    def test_invalid_json_returns_none(self):
        """Invalid JSON returns None."""
        assert parse_eve_alert_line("not json") is None


class TestEveToThreatLogRow:
    """eve_to_threat_log_row maps EVE fields to security_threat_logs columns."""

    def test_maps_all_fields(self):
        """Maps src_ip, dest_ip, suricata_sid, severity, raw_payload."""
        ev = {
            "event_type": "alert",
            "src_ip": "192.168.1.100",
            "dest_ip": "10.0.0.50",
            "timestamp": "2025-03-14T12:00:00.123456+0000",
            "alert": {"signature_id": 2000001, "severity": 2},
        }
        raw = json.dumps(ev)
        row = eve_to_threat_log_row(ev, raw_payload=raw)
        assert row["source_ip"] == "192.168.1.100"
        assert row["destination_ip"] == "10.0.0.50"
        assert row["suricata_sid"] == 2000001
        assert row["severity_level"] == "MEDIUM"
        assert row["raw_payload"] == raw

    def test_severity_mapping(self):
        """Severity 1→LOW, 2→MEDIUM, 3→HIGH; default MEDIUM if missing."""
        base = {"event_type": "alert", "src_ip": "1.1.1.1", "dest_ip": "2.2.2.2"}
        assert (
            eve_to_threat_log_row(
                {**base, "alert": {"signature_id": 1, "severity": 1}}, raw_payload=""
            )["severity_level"]
            == "LOW"
        )
        assert (
            eve_to_threat_log_row(
                {**base, "alert": {"signature_id": 1, "severity": 2}}, raw_payload=""
            )["severity_level"]
            == "MEDIUM"
        )
        assert (
            eve_to_threat_log_row(
                {**base, "alert": {"signature_id": 1, "severity": 3}}, raw_payload=""
            )["severity_level"]
            == "HIGH"
        )
        assert (
            eve_to_threat_log_row(
                {**base, "alert": {"signature_id": 1}}, raw_payload=""
            )["severity_level"]
            == "MEDIUM"
        )


@pytest.mark.skipif(
    os.environ.get("SKIP_DB_TESTS") == "1",
    reason="Skip when DB not available (e.g. CI without compose)",
)
class TestIngestEveFile:
    """ingest_eve_file inserts rows into wims.security_threat_logs."""

    def test_ingest_inserts_row(self, db_session):
        """After ingest, a row exists with correct columns."""
        line = _minimal_eve_alert_line()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(line + "\n")
            path = f.name
        try:
            ingest_eve_file(path, db_session=db_session)
            db_session.commit()

            row = db_session.execute(
                text("""
                    SELECT source_ip, destination_ip, suricata_sid, severity_level, raw_payload
                    FROM wims.security_threat_logs
                    ORDER BY log_id DESC
                    LIMIT 1
                """)
            ).fetchone()

            assert row is not None
            assert row[0] == "192.168.1.100"
            assert row[1] == "10.0.0.50"
            assert row[2] == 2000001
            assert row[3] == "MEDIUM"
            assert "192.168.1.100" in row[4]
        finally:
            os.unlink(path)
