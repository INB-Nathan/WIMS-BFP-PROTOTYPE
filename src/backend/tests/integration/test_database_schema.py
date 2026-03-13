"""
WIMS-BFP Database Schema Integration Tests (Adversarial / RED State)

Validates PostgreSQL schema constraints per .specify/specs/current/db-schema-task.md.
These tests are designed to FAIL until the schema enforces all specified constraints.

Kill List:
  1. Auth: wims.users.keycloak_id NOT NULL
  2. Geospatial: fire_incidents.location must be GEOGRAPHY(POINT, 4326), not string
  3. DoS: security_threat_logs.raw_payload max 65535 chars
  4. Forensic: citizen_reports.status=VERIFIED requires validated_by IS NOT NULL
  5. SID Range: security_threat_logs.suricata_sid must be > 0

Prerequisites:
  - wims-postgres container running with PostGIS
  - Schema applied (e.g. schema_v2.sql or migrations matching db-schema-task.md)
  - DATABASE_URL or default postgresql://postgres:password@postgres:5432/wims

Run (from project root):
  # With wims-postgres running and schema applied (e.g. schema_v2.sql):
  cd src && docker compose run --rm backend pytest tests/integration/test_database_schema.py -v

  # Or from host if postgres port 5432 is exposed:
  DATABASE_URL=postgresql://postgres:password@localhost:5432/wims pytest src/backend/tests/integration/test_database_schema.py -v
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.engine import create_engine
from sqlalchemy.engine.base import Engine


def _get_engine() -> Engine:
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@postgres:5432/wims",
    )
    return create_engine(url, isolation_level="AUTOCOMMIT")


@pytest.fixture(scope="module")
def engine():
    return _get_engine()


@pytest.fixture(autouse=True)
def _skip_if_no_db(engine):
    """Skip integration tests if database is unreachable."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"Database unreachable: {e}")


# ---------------------------------------------------------------------------
# 1. Auth Constraint: keycloak_id NOT NULL
# ---------------------------------------------------------------------------
class TestAuthConstraint:
    """wims.users.keycloak_id must be NOT NULL. Insert with NULL/missing must fail."""

    def test_insert_users_with_null_keycloak_id_fails(self, engine):
        """Insert wims.users with keycloak_id=NULL must raise IntegrityError."""
        with engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role)
                        VALUES (:uid, NULL, 'null_kc_user', 'ENCODER')
                    """),
                    {"uid": str(uuid.uuid4())},
                )
        assert exc_info.value is not None

    def test_insert_users_without_keycloak_id_fails(self, engine):
        """Insert wims.users omitting keycloak_id must fail (NOT NULL)."""
        with engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, username, role)
                        VALUES (:uid, 'missing_kc_user', 'ENCODER')
                    """),
                    {"uid": str(uuid.uuid4())},
                )
        assert exc_info.value is not None


# ---------------------------------------------------------------------------
# 2. Geospatial Constraint: location must be GEOGRAPHY(POINT, 4326)
# ---------------------------------------------------------------------------
class TestGeospatialConstraint:
    """fire_incidents.location must be PostGIS GEOGRAPHY, not a plain string."""

    def test_insert_fire_incident_with_string_location_fails(self, engine):
        """Insert fire_incident using a string for location must fail."""
        # Ensure we have a region for FK
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT region_id FROM wims.ref_regions LIMIT 1")
            ).fetchone()
            if row is None:
                pytest.skip("No ref_regions seed data; cannot test fire_incidents FK")
            region_id = row[0]

        with engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.fire_incidents (region_id, location)
                        VALUES (:rid, '14.5995,120.9842')
                    """),
                    {"rid": region_id},
                )
        assert exc_info.value is not None


# ---------------------------------------------------------------------------
# 3. DoS Constraint: raw_payload max 65535 chars
# ---------------------------------------------------------------------------
class TestDoSPayloadConstraint:
    """security_threat_logs.raw_payload must reject payloads > 65535 chars."""

    def test_insert_raw_payload_70000_chars_fails(self, engine):
        """Insert raw_payload of 70,000 characters must fail (VARCHAR(65535) boundary)."""
        payload_70k = "x" * 70_000

        with engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.security_threat_logs
                        (source_ip, severity_level, raw_payload)
                        VALUES ('192.168.1.1', 'LOW', :payload)
                    """),
                    {"payload": payload_70k},
                )
        assert exc_info.value is not None


# ---------------------------------------------------------------------------
# 4. Forensic Constraint: VERIFIED status requires validated_by
# ---------------------------------------------------------------------------
class TestForensicConstraint:
    """citizen_reports: status=VERIFIED requires validated_by IS NOT NULL."""

    def test_insert_citizen_report_verified_without_validated_by_fails(self, engine):
        """Set status=VERIFIED while validated_by=NULL must fail."""
        # Valid PostGIS point for location
        location_wkt = "SRID=4326;POINT(121.0 14.6)"

        with engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.citizen_reports
                        (location, status, validated_by)
                        VALUES (ST_GeogFromText(:loc), 'VERIFIED', NULL)
                    """),
                    {"loc": location_wkt},
                )
        assert exc_info.value is not None


# ---------------------------------------------------------------------------
# 5. SID Range: suricata_sid must be > 0
# ---------------------------------------------------------------------------
class TestSuricataSidConstraint:
    """security_threat_logs.suricata_sid must satisfy CHECK (suricata_sid > 0)."""

    def test_insert_suricata_sid_negative_fails(self, engine):
        """Insert suricata_sid=-5 must fail."""
        with engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.security_threat_logs
                        (source_ip, severity_level, suricata_sid)
                        VALUES ('192.168.1.1', 'LOW', -5)
                    """),
                )
        assert exc_info.value is not None

    def test_insert_suricata_sid_zero_fails(self, engine):
        """Insert suricata_sid=0 must fail (must be > 0)."""
        with engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.security_threat_logs
                        (source_ip, severity_level, suricata_sid)
                        VALUES ('192.168.1.1', 'LOW', 0)
                    """),
                )
        assert exc_info.value is not None
