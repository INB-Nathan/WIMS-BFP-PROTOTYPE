# ruff: noqa: E402
"""
Data Retention — ASVS V14.2.4 (WS5) Integration Tests.

TDD: red → green on all 5 tests.

Run from project root:
    cd src && pytest backend/tests/integration/test_data_retention.py -v
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure backend root is on path when running from src/
_backend_root = Path(__file__).resolve().parent.parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# DB Setup
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get(
    "SQLALCHEMY_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql://postgres:password@postgres:5432/wims"),
)
_engine = create_engine(DATABASE_URL)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def db_session():
    """Provide a real DB session for integration tests.  Rollback after each test."""
    session = _Session()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _set_config(db, key: str, value: str):
    """Upsert a retention config key."""
    db.execute(
        text("""
            INSERT INTO wims.system_config (config_key, config_value, description)
            VALUES (:key, :value, 'test override')
            ON CONFLICT (config_key) DO UPDATE SET config_value = :value2
        """),
        {"key": key, "value": value, "value2": value},
    )
    db.commit()


def _clear_audit_log(db):
    """Delete audit log rows from the test run (if RULE allows)."""
    try:
        db.execute(
            text("DELETE FROM wims.system_audit_trails WHERE action_type = 'DATA_RETENTION_PRUNE'")
        )
        db.commit()
    except Exception:
        db.rollback()


def _count_audit_logs(db) -> int:
    """Count DATA_RETENTION_PRUNE audit log entries."""
    row = db.execute(
        text(
            "SELECT COUNT(*) FROM wims.system_audit_trails WHERE action_type = 'DATA_RETENTION_PRUNE'"
        )
    ).fetchone()
    return row[0] if row else 0


# ===========================================================================
# Test 1: security_threat_logs — hard delete older than retention
# ===========================================================================
class TestSecurityThreatLogsHardDelete:
    """TDD-1: security_threat_logs older than retention_days are hard-deleted."""

    @pytest.fixture(autouse=True)
    def setup_config(self, db_session):
        _set_config(db_session, "retention.security_threat_logs_days", "365")
        _clear_audit_log(db_session)

    def test_security_threat_logs_hard_delete_older_than_retention(self, db_session):
        # Arrange: insert one old row (8 yr) and one new row
        old_id, new_id = None, None
        try:
            # Old row: 8 years ago
            result = db_session.execute(
                text("""
                    INSERT INTO wims.security_threat_logs (source_ip, severity_level, raw_payload, timestamp)
                    VALUES (:ip, :sev, :payload, now() - INTERVAL '8 years')
                    RETURNING log_id
                """),
                {"ip": "10.0.0.1", "sev": "HIGH", "payload": "old threat"},
            )
            old_id = result.fetchone()[0]

            # New row: now
            result = db_session.execute(
                text("""
                    INSERT INTO wims.security_threat_logs (source_ip, severity_level, raw_payload, timestamp)
                    VALUES (:ip, :sev, :payload, now())
                    RETURNING log_id
                """),
                {"ip": "10.0.0.2", "sev": "LOW", "payload": "new threat"},
            )
            new_id = result.fetchone()[0]
            db_session.commit()

            # Act: run the retention task
            from tasks.data_retention import run_data_retention

            run_data_retention()

            # Assert: old row deleted, new row remains
            old_row = db_session.execute(
                text("SELECT log_id FROM wims.security_threat_logs WHERE log_id = :lid"),
                {"lid": old_id},
            ).fetchone()
            assert old_row is None, f"Old threat log {old_id} should have been deleted"

            new_row = db_session.execute(
                text("SELECT log_id FROM wims.security_threat_logs WHERE log_id = :lid"),
                {"lid": new_id},
            ).fetchone()
            assert new_row is not None, f"New threat log {new_id} should remain"

            # Assert: audit log recorded
            assert _count_audit_logs(db_session) >= 1, "Expected at least 1 audit log entry"
        finally:
            # Cleanup
            for lid in filter(None, [old_id, new_id]):
                try:
                    db_session.execute(
                        text("DELETE FROM wims.security_threat_logs WHERE log_id = :lid"),
                        {"lid": lid},
                    )
                except Exception:
                    pass
            db_session.commit()


# ===========================================================================
# Test 2: fire_incidents — VERIFIED soft-archived, non-VERIFIED hard-deleted
# ===========================================================================
class TestFireIncidentsRetention:
    """TDD-2: VERIFIED fire_incidents are soft-archived; non-VERIFIED are hard-deleted."""

    @pytest.fixture(autouse=True)
    def setup_config(self, db_session):
        _set_config(db_session, "retention.fire_incidents_days", "2555")
        _clear_audit_log(db_session)

    def test_fire_incidents_verified_soft_archived(self, db_session):
        # Arrange
        verified_id, draft_id = None, None
        try:
            # VERIFIED row: 8 years old
            result = db_session.execute(
                text("""
                    INSERT INTO wims.fire_incidents
                        (region_id, location, verification_status, is_archived, created_at)
                    VALUES
                        (:rid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :status, :archived, now() - INTERVAL '8 years')
                    RETURNING incident_id
                """),
                {"rid": 2, "lng": 121.0, "lat": 14.0, "status": "VERIFIED", "archived": False},
            )
            verified_id = result.fetchone()[0]

            # Non-VERIFIED (DRAFT) row: 8 years old
            result = db_session.execute(
                text("""
                    INSERT INTO wims.fire_incidents
                        (region_id, location, verification_status, is_archived, created_at)
                    VALUES
                        (:rid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :status, :archived, now() - INTERVAL '8 years')
                    RETURNING incident_id
                """),
                {"rid": 2, "lng": 121.1, "lat": 14.1, "status": "DRAFT", "archived": False},
            )
            draft_id = result.fetchone()[0]
            db_session.commit()

            # Act: run the retention task
            from tasks.data_retention import run_data_retention

            run_data_retention()

            # Assert: VERIFIED row is still there but soft-archived
            verified_row = db_session.execute(
                text(
                    "SELECT incident_id, is_archived FROM wims.fire_incidents WHERE incident_id = :iid"
                ),
                {"iid": verified_id},
            ).fetchone()
            assert verified_row is not None, "VERIFIED row should still exist"
            assert verified_row[1] is True, (
                f"VERIFIED row should be archived, got is_archived={verified_row[1]}"
            )

            # Assert: DRAFT row is hard-deleted
            draft_row = db_session.execute(
                text("SELECT incident_id FROM wims.fire_incidents WHERE incident_id = :iid"),
                {"iid": draft_id},
            ).fetchone()
            assert draft_row is None, "DRAFT row should have been hard-deleted"

            # Assert: audit log recorded (at least 2: soft-archive + hard-delete)
            assert _count_audit_logs(db_session) >= 2, "Expected at least 2 audit log entries"
        finally:
            # Cleanup
            for iid in filter(None, [verified_id, draft_id]):
                try:
                    db_session.execute(
                        text("DELETE FROM wims.fire_incidents WHERE incident_id = :iid"),
                        {"iid": iid},
                    )
                except Exception:
                    pass
            db_session.commit()


# ===========================================================================
# Test 3: incident_sensitive_details — blob-erasure
# ===========================================================================
class TestIncidentSensitiveDetailsBlobErasure:
    """TDD-3: PII columns + encrypted blob are NULLed; FK columns preserved."""

    @pytest.fixture(autouse=True)
    def setup_config(self, db_session):
        _set_config(db_session, "retention.incident_sensitive_details_days", "2555")
        _clear_audit_log(db_session)

    def test_incident_sensitive_details_blob_erasure(self, db_session):
        # Arrange
        incident_id, sensitive_id = None, None
        try:
            # Create a parent fire_incident (DRAFT, 8 years old)
            result = db_session.execute(
                text("""
                    INSERT INTO wims.fire_incidents
                        (region_id, location, verification_status, created_at)
                    VALUES
                        (:rid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :status, now() - INTERVAL '8 years')
                    RETURNING incident_id
                """),
                {"rid": 2, "lng": 122.0, "lat": 15.0, "status": "DRAFT"},
            )
            incident_id = result.fetchone()[0]

            # Create sensitive_details with all PII populated + encrypted blob
            result = db_session.execute(
                text("""
                    INSERT INTO wims.incident_sensitive_details
                        (incident_id, street_address, landmark, caller_name, caller_number,
                         narrative_report, prepared_by_officer, noted_by_officer,
                         receiver_name, establishment_name, owner_name, occupant_name,
                         personnel_on_duty, other_personnel, casualty_details,
                         icp_location, disposition, disposition_prepared_by, disposition_noted_by,
                         remarks, pii_blob_enc, encryption_iv)
                    VALUES
                        (:iid, :street, :landmark, :caller_name, :caller_number,
                         :narrative, :prepared_by, :noted_by,
                         :receiver_name, :establishment, :owner_name, :occupant_name,
                         :personnel, :other, :casualty,
                         :icp, :disp, :disp_prep, :disp_note,
                         :remarks, :pii_blob, :enc_iv)
                    RETURNING sensitive_id
                """),
                {
                    "iid": incident_id,
                    "street": "123 Main St",
                    "landmark": "Near City Hall",
                    "caller_name": "Juan Dela Cruz",
                    "caller_number": "09171234567",
                    "narrative": "Fire in the building",
                    "prepared_by": "OFCR Santos",
                    "noted_by": "CHIEF Reyes",
                    "receiver_name": "Duty Officer",
                    "establishment": "Commercial Building",
                    "owner_name": "Maria Clara",
                    "occupant_name": "Tenant 1",
                    "personnel": '{"firefighter": 2, "medic": 1}',
                    "other": '[{"name": "volunteer1", "role": "support"}]',
                    "casualty": '[{"type": "injury", "count": 1}]',
                    "icp": "Incident Command Post Alpha",
                    "disp": "Contained",
                    "disp_prep": "OFCR Santos",
                    "disp_note": "Case closed",
                    "remarks": "No further action",
                    "pii_blob": "base64ciphertext==",
                    "enc_iv": "base64iv==",
                },
            )
            sensitive_id = result.fetchone()[0]
            db_session.commit()

            # Act: run the retention task
            from tasks.data_retention import run_data_retention

            run_data_retention()

            # Assert: sensitive row still exists with FK columns preserved
            row = db_session.execute(
                text("""
                    SELECT sensitive_id, incident_id,
                           street_address, landmark, caller_name, caller_number,
                           narrative_report, prepared_by_officer, noted_by_officer,
                           receiver_name, establishment_name, owner_name, occupant_name,
                           personnel_on_duty, other_personnel, casualty_details,
                           icp_location, disposition, disposition_prepared_by, disposition_noted_by,
                           remarks, pii_blob_enc, encryption_iv, data_retention_erased_at
                    FROM wims.incident_sensitive_details
                    WHERE sensitive_id = :sid
                """),
                {"sid": sensitive_id},
            ).fetchone()
            assert row is not None, f"Sensitive detail {sensitive_id} should still exist"

            # FK columns preserved
            assert row[0] == sensitive_id, "sensitive_id should be preserved"
            assert row[1] == incident_id, "incident_id should be preserved"

            # All PII columns NULLed (JSONB columns set to empty values per spec)
            for idx in range(2, 22):  # street_address through remarks
                if idx in (13, 14, 15):  # personnel_on_duty, other_personnel, casualty_details
                    # These are set to empty JSONB per spec, not NULL
                    continue
                assert row[idx] is None, f"Column index {idx} should be NULL, got {row[idx]!r}"

            # JSONB columns set to empty values
            assert row[13] == {}, f"personnel_on_duty should be empty jsonb, got {row[13]!r}"
            assert row[14] == [], f"other_personnel should be empty jsonb, got {row[14]!r}"
            assert row[15] == [], f"casualty_details should be empty jsonb, got {row[15]!r}"

            # Encrypted blob + IV NULLed (indices: 21=pii_blob_enc, 22=encryption_iv)
            assert row[21] is None, f"pii_blob_enc should be NULL, got {row[21]!r}"
            assert row[22] is None, f"encryption_iv should be NULL, got {row[22]!r}"

            # Erasure timestamp set (index 23 = data_retention_erased_at)
            assert row[23] is not None, f"data_retention_erased_at should be set, got {row[23]!r}"

            # Assert: audit log recorded
            assert _count_audit_logs(db_session) >= 1, "Expected at least 1 audit log entry"
        finally:
            # Cleanup
            if sensitive_id is not None:
                try:
                    db_session.execute(
                        text(
                            "DELETE FROM wims.incident_sensitive_details WHERE sensitive_id = :sid"
                        ),
                        {"sid": sensitive_id},
                    )
                except Exception:
                    pass
            if incident_id is not None:
                try:
                    db_session.execute(
                        text("DELETE FROM wims.fire_incidents WHERE incident_id = :iid"),
                        {"iid": incident_id},
                    )
                except Exception:
                    pass
            db_session.commit()


# ===========================================================================
# Test 4: IVH and audit_trails — never pruned (no-op)
# ===========================================================================
class TestImmutableTablesNeverPruned:
    """TDD-4: incident_verification_history and system_audit_trails are never pruned."""

    def test_ivh_and_audit_trails_never_pruned(self, db_session):
        # Arrange: insert IVH and audit_trail rows 10 years old
        ivh_id, audit_id = None, None
        try:
            # Create a parent fire_incident first (for IVH FK)
            result = db_session.execute(
                text("""
                    INSERT INTO wims.fire_incidents
                        (region_id, location, verification_status, created_at)
                    VALUES
                        (:rid, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :status, now() - INTERVAL '10 years')
                    RETURNING incident_id
                """),
                {"rid": 2, "lng": 123.0, "lat": 16.0, "status": "DRAFT"},
            )
            incident_id = result.fetchone()[0]

            # IVH row (needs target_type + target_id since they're NOT NULL)
            result = db_session.execute(
                text("""
                    INSERT INTO wims.incident_verification_history
                        (incident_id, target_type, target_id, previous_status, new_status, action_timestamp)
                    VALUES
                        (:iid, :ttype, :tid, :prev, :new, now() - INTERVAL '10 years')
                    RETURNING history_id
                """),
                {
                    "iid": incident_id,
                    "ttype": "OFFICIAL",
                    "tid": incident_id,
                    "prev": "DRAFT",
                    "new": "VERIFIED",
                },
            )
            ivh_id = result.fetchone()[0]

            # Audit trail row (use a unique action_type for identification)
            result = db_session.execute(
                text("""
                    INSERT INTO wims.system_audit_trails
                        (user_id, action_type, table_affected, record_id, ip_address, user_agent, timestamp)
                    VALUES
                        (:uid, :action, :table, :rid, :ip, :ua, now() - INTERVAL '10 years')
                    RETURNING audit_id
                """),
                {
                    "uid": "00000000-0000-0000-0000-000000000001",
                    "action": "TEST_WS5_NEVER_PRUNE",
                    "table": "wims.fire_incidents",
                    "rid": incident_id,
                    "ip": "127.0.0.1",
                    "ua": "pytest",
                },
            )
            audit_id = result.fetchone()[0]
            db_session.commit()

            # Act: run the retention task
            from tasks.data_retention import run_data_retention

            run_data_retention()

            # Assert: IVH row still exists
            ivh_row = db_session.execute(
                text(
                    "SELECT history_id FROM wims.incident_verification_history WHERE history_id = :hid"
                ),
                {"hid": ivh_id},
            ).fetchone()
            assert ivh_row is not None, "IVH row should still exist (no-op)"

            # Assert: audit trail row still exists
            audit_row = db_session.execute(
                text("SELECT audit_id FROM wims.system_audit_trails WHERE audit_id = :aid"),
                {"aid": audit_id},
            ).fetchone()
            assert audit_row is not None, "Audit trail row should still exist (no-op)"

            # Assert: no-op audit log entries exist
            assert _count_audit_logs(db_session) >= 1, "Expected at least 1 audit log entry"
        finally:
            # Cleanup (best-effort; audit_trails may block DELETE via RULE)
            for hid in filter(None, [ivh_id]):
                try:
                    db_session.execute(
                        text(
                            "DELETE FROM wims.incident_verification_history WHERE history_id = :hid"
                        ),
                        {"hid": hid},
                    )
                except Exception:
                    pass
            if audit_id is not None:
                try:
                    db_session.execute(
                        text("DELETE FROM wims.system_audit_trails WHERE audit_id = :aid"),
                        {"aid": audit_id},
                    )
                except Exception:
                    pass  # RULE will block it
            if incident_id is not None:
                try:
                    db_session.execute(
                        text("DELETE FROM wims.fire_incidents WHERE incident_id = :iid"),
                        {"iid": incident_id},
                    )
                except Exception:
                    pass
            db_session.commit()


# ===========================================================================
# Test 5: retention config override — config-driven, not hardcoded
# ===========================================================================
class TestRetentionConfigOverride:
    """TDD-5: Changing retention_days in system_config controls task behavior."""

    @pytest.fixture(autouse=True)
    def setup(self, db_session):
        _clear_audit_log(db_session)

    def test_retention_config_override(self, db_session):
        # Arrange: set a short retention (30 days)
        _set_config(db_session, "retention.security_threat_logs_days", "30")

        # Insert a 60-day-old row (older than 30-day retention)
        log_id = None
        try:
            result = db_session.execute(
                text("""
                    INSERT INTO wims.security_threat_logs (source_ip, severity_level, raw_payload, timestamp)
                    VALUES (:ip, :sev, :payload, now() - INTERVAL '60 days')
                    RETURNING log_id
                """),
                {"ip": "10.0.0.99", "sev": "MEDIUM", "payload": "config override test"},
            )
            log_id = result.fetchone()[0]
            db_session.commit()

            # Act: run the retention task
            from tasks.data_retention import run_data_retention

            run_data_retention()

            # Assert: the 60-day-old row is deleted (30-day retention applied)
            row = db_session.execute(
                text("SELECT log_id FROM wims.security_threat_logs WHERE log_id = :lid"),
                {"lid": log_id},
            ).fetchone()
            assert row is None, (
                f"Log {log_id} should have been deleted with 30-day retention override"
            )
        finally:
            if log_id is not None:
                try:
                    db_session.execute(
                        text("DELETE FROM wims.security_threat_logs WHERE log_id = :lid"),
                        {"lid": log_id},
                    )
                except Exception:
                    pass
                db_session.commit()
