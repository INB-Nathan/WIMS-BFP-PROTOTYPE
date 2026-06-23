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
        """Severity 1→LOW, 2→MEDIUM, 3→HIGH, 4→CRITICAL; default MEDIUM if missing."""
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
                {**base, "alert": {"signature_id": 1, "severity": 4}}, raw_payload=""
            )["severity_level"]
            == "CRITICAL"
        )
        assert (
            eve_to_threat_log_row({**base, "alert": {"signature_id": 1}}, raw_payload="")[
                "severity_level"
            ]
            == "MEDIUM"
        )

    def test_et_open_sid_maps_correctly(self):
        """ET Open SID in the 2000000+ range maps correctly."""
        ev = {
            "event_type": "alert",
            "src_ip": "10.0.0.1",
            "dest_ip": "10.0.0.2",
            "alert": {"signature_id": 2010935, "severity": 1},
        }
        raw = json.dumps(ev)
        row = eve_to_threat_log_row(ev, raw_payload=raw)
        assert row["source_ip"] == "10.0.0.1"
        assert row["suricata_sid"] == 2010935
        assert row["severity_level"] == "LOW"
        assert row["raw_payload"] == raw


class TestEveClassifier:
    """eve_to_threat_log_row now returns classification/suricata_signature/suricata_category."""

    def test_scanner_detected_from_signature(self):
        """Tracer bullet: LOW EVE alert with 'ET SCAN Potential SSH Scan' signature
        returns classification='scanner' and copies signature/category."""
        ev = {
            "event_type": "alert",
            "src_ip": "198.51.100.77",
            "dest_ip": "10.10.0.20",
            "alert": {
                "signature_id": 2010935,
                "signature": "ET SCAN Potential SSH Scan",
                "category": "Attempted Information Leak",
                "severity": 1,
            },
        }
        row = eve_to_threat_log_row(ev, raw_payload=json.dumps(ev))
        assert row["classification"] == "scanner", (
            f"Expected 'scanner', got {row.get('classification')!r}"
        )
        assert row["suricata_signature"] == "ET SCAN Potential SSH Scan"
        assert row["suricata_category"] == "Attempted Information Leak"

    def test_high_signal_wins_over_text_matches(self):
        """HIGH SQL injection alert returns high_signal_threat even though
        signature contains probe-like words (e.g. 'Attempt')."""
        ev = {
            "event_type": "alert",
            "src_ip": "203.0.113.44",
            "dest_ip": "10.10.0.15",
            "alert": {
                "signature_id": 2024218,
                "signature": "ET WEB_SERVER Possible SQL Injection Attempt UNION SELECT",
                "category": "Web Application Attack",
                "severity": 3,
            },
        }
        row = eve_to_threat_log_row(ev, raw_payload=json.dumps(ev))
        # severity 3 => HIGH (default high_threshold=3)
        assert row["severity_level"] == "HIGH"
        # Rule 1: HIGH must win over all text matches
        assert row["classification"] == "high_signal_threat"

    def test_bot_probe_from_user_agent(self):
        """curl/user-agent policy alert returns bot_probe."""
        ev = {
            "event_type": "alert",
            "src_ip": "198.51.100.23",
            "dest_ip": "10.10.0.15",
            "alert": {
                "signature_id": 2027758,
                "signature": "ET POLICY curl User-Agent Outbound",
                "category": "Potential Corporate Privacy Violation",
                "severity": 2,
            },
        }
        row = eve_to_threat_log_row(ev, raw_payload=json.dumps(ev))
        assert row["severity_level"] == "MEDIUM"
        assert row["classification"] == "bot_probe"

    def test_credential_probe_when_low_medium(self):
        """SSH/login/password probe returns credential_probe when LOW/MEDIUM
        and not caught by scanner detection first."""
        ev = {
            "event_type": "alert",
            "src_ip": "10.0.0.55",
            "dest_ip": "10.10.0.17",
            "alert": {
                "signature_id": 2500050,
                "signature": "ET POLICY SSH Brute Force Login Attempt",
                "category": "Attempted Administrator Privilege Gain",
                "severity": 2,
            },
        }
        row = eve_to_threat_log_row(ev, raw_payload=json.dumps(ev))
        assert row["severity_level"] == "MEDIUM"
        # This signature contains 'ssh' but not scan/scanner/nmap/masscan/zmap => so
        # scanner rule 2 does NOT match; credential rule 4 matches via 'ssh' + 'login'
        assert row["classification"] == "credential_probe"

    def test_missing_alert_metadata_returns_unclassified(self):
        """Missing alert.signature and alert.category returns unclassified without raising."""
        ev = {
            "event_type": "alert",
            "src_ip": "10.0.0.1",
            "dest_ip": "10.0.0.2",
            "alert": {
                "signature_id": 9999999,
                "severity": 1,
            },
        }
        row = eve_to_threat_log_row(ev, raw_payload=json.dumps(ev))
        assert row["severity_level"] == "LOW"
        assert row["classification"] == "internet_background_noise"
        assert row["suricata_signature"] is None
        assert row["suricata_category"] is None

    def test_classification_in_valid_set(self):
        """Every classification returned is one of the valid normalized values."""
        from services.suricata_ingestion import _VALID_CLASSIFICATIONS

        cases = [
            # (alert dict, expected_classification)
            ({"signature": "ET SCAN Nmap", "category": "Scan", "severity": 1}, "scanner"),
            ({"signature": "ET POLICY curl", "category": "Policy", "severity": 2}, "bot_probe"),
            ({"signature": "SSH login", "category": "Admin", "severity": 2}, "credential_probe"),
            (
                {"signature": "SQL Injection", "category": "Web Attack", "severity": 3},
                "high_signal_threat",
            ),
            (
                {"signature": "Generic alert", "category": "Misc", "severity": 1},
                "internet_background_noise",
            ),
            (
                {"signature": "SQL Injection", "category": "Web Attack", "severity": 4},
                "high_signal_threat",
            ),
        ]
        for alert_override, expected in cases:
            ev = {
                "event_type": "alert",
                "src_ip": "10.0.0.1",
                "dest_ip": "10.0.0.2",
                "alert": {"signature_id": 1, **alert_override},
            }
            row = eve_to_threat_log_row(ev, raw_payload="")
            assert row["classification"] == expected, (
                f"Alert {alert_override} => expected {expected}, got {row['classification']}"
            )
            assert row["classification"] in _VALID_CLASSIFICATIONS


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

    def test_ingest_persists_classification_signature_category(self, db_session):
        """After ingest with signature-bearing alert, classification,
        suricata_signature, and suricata_category are NOT NULL in DB."""
        ev = {
            "event_type": "alert",
            "src_ip": "203.0.113.44",
            "dest_ip": "10.10.0.15",
            "timestamp": "2025-03-14T12:00:00.123456+0000",
            "alert": {
                "signature_id": 2024218,
                "signature": "ET WEB_SERVER Possible SQL Injection Attempt UNION SELECT",
                "category": "Web Application Attack",
                "severity": 3,
            },
        }
        line = json.dumps(ev)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(line + "\n")
            path = f.name
        try:
            ingest_eve_file(path, db_session=db_session)
            db_session.commit()

            row = db_session.execute(
                text("""
                    SELECT classification, suricata_signature, suricata_category
                    FROM wims.security_threat_logs
                    ORDER BY log_id DESC
                    LIMIT 1
                """)
            ).fetchone()

            assert row is not None, "Row should exist after ingest"
            assert row[0] is not None, "classification should NOT be NULL"
            assert row[0] == "high_signal_threat", f"Expected high_signal_threat, got {row[0]}"
            assert row[1] is not None, "suricata_signature should NOT be NULL"
            assert row[1] == "ET WEB_SERVER Possible SQL Injection Attempt UNION SELECT"
            assert row[2] is not None, "suricata_category should NOT be NULL"
            assert row[2] == "Web Application Attack"
        finally:
            os.unlink(path)
