"""Integration tests for _detect_suspicious_query_pattern.

Runs against a real PostgreSQL instance (SYSTEM_ADMIN RLS context via
get_session with the seeded admin_test user).  Each test function gets a
fresh session that is rolled back on teardown — no committed side-effects.

Run from within the backend container:
    python -m pytest tests/integration/test_anomaly_suspicious_query.py -v
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

_backend_root = Path(__file__).resolve().parent.parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import pytest
from sqlalchemy import text

from database import get_session
from tasks.anomaly_detection import (
    _PII_EXPORT_ACTION,
    _SUSPICIOUS_QUERY_THRESHOLD,
    _detect_suspicious_query_pattern,
    _write_anomaly,
)

# Seeded by 03_users.sql — always present after bootstrap.
_SVC_SURICATA_ID = "00000000-0000-0000-0000-000000000001"  # NATIONAL_ANALYST
_ADMIN_TEST_ID = "55555555-5555-4555-8555-555555555555"   # SYSTEM_ADMIN
_ADMIN_TEST_UUID = uuid.UUID(_ADMIN_TEST_ID)


@pytest.fixture
def task_db():
    """Real DB session with SYSTEM_ADMIN RLS context; rolls back on teardown."""
    db = get_session(_ADMIN_TEST_UUID)
    try:
        yield db
    finally:
        db.rollback()
        db.close()


def _seed_pii_exports(db, user_id: str, count: int) -> None:
    """Insert ``count`` PII_EXPORT audit rows for ``user_id`` at now()."""
    for _ in range(count):
        db.execute(
            text("""
                INSERT INTO wims.system_audit_trails
                    (user_id, action_type, table_affected, ip_address, timestamp)
                VALUES (
                    CAST(:uid AS uuid),
                    :action,
                    'wims.users',
                    '192.168.1.100',
                    now()
                )
            """),
            {"uid": user_id, "action": _PII_EXPORT_ACTION},
        )


@pytest.mark.integration
class TestSuspiciousQueryPatternIntegration:
    def test_positive_eleven_exports_detected(self, task_db):
        """11 PII_EXPORT events in a 5-min window → detector flags the user."""
        _seed_pii_exports(task_db, _SVC_SURICATA_ID, _SUSPICIOUS_QUERY_THRESHOLD + 1)

        results = _detect_suspicious_query_pattern(task_db)
        our = [r for r in results if r["subject_user_id"] == _SVC_SURICATA_ID]

        assert len(our) == 1
        assert our[0]["anomaly_type"] == "SUSPICIOUS_QUERY_PATTERN"
        assert our[0]["severity"] == "HIGH"
        assert our[0]["details"]["count"] > _SUSPICIOUS_QUERY_THRESHOLD

    def test_write_anomaly_inserts_and_dedups(self, task_db):
        """First _write_anomaly returns True (new row); second returns False (dedup)."""
        _seed_pii_exports(task_db, _SVC_SURICATA_ID, _SUSPICIOUS_QUERY_THRESHOLD + 1)

        results = _detect_suspicious_query_pattern(task_db)
        our = [r for r in results if r["subject_user_id"] == _SVC_SURICATA_ID]
        assert len(our) == 1, "precondition: detector must fire before testing write"

        anomaly = our[0]
        first = _write_anomaly(task_db, **anomaly)
        second = _write_anomaly(task_db, **anomaly)

        assert first is True
        assert second is False

        # anomaly_detections has exactly 1 row for this dedup_key in this txn
        ad_count = task_db.execute(
            text("""
                SELECT COUNT(*) FROM wims.anomaly_detections
                WHERE dedup_key = :dk
            """),
            {"dk": anomaly["dedup_key"]},
        ).scalar()
        assert ad_count == 1

        # security_threat_logs has at least 1 row from this write (source_ip is
        # specific to our seed rows so false-positives from Celery are unlikely)
        stl_count = task_db.execute(
            text("""
                SELECT COUNT(*) FROM wims.security_threat_logs
                WHERE raw_payload LIKE '%SUSPICIOUS_QUERY_PATTERN%'
                  AND source_ip = :ip
            """),
            {"ip": anomaly["source_ip"]},
        ).scalar()
        assert stl_count >= 1

    def test_negative_ten_exports_not_detected(self, task_db):
        """Exactly 10 PII_EXPORT events (= threshold, not >) → no anomaly raised."""
        _seed_pii_exports(task_db, _ADMIN_TEST_ID, _SUSPICIOUS_QUERY_THRESHOLD)

        results = _detect_suspicious_query_pattern(task_db)
        flagged = [r for r in results if r["subject_user_id"] == _ADMIN_TEST_ID]

        assert len(flagged) == 0
