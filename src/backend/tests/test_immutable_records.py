"""
Integration tests for #66 (M6-D Immutable Records) and #84 (Analytics Sync).

Red state: ALL 5 tests FAIL before the fix.
Green state: ALL 5 tests PASS after:
  1. src/postgres-init/17_immutable_records.sql applied to running container
  2. verify_incident() in regional.py patched (data_hash + sync_incident_to_analytics)

Run inside Docker:
    docker compose run --rm backend pytest tests/test_immutable_records.py -v
"""

from __future__ import annotations

import os
import uuid

import psycopg2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import create_engine

from auth import get_current_wims_user
from main import app

# ---------------------------------------------------------------------------
# Seed user UUIDs — created by 03_users.sql, assigned NCR by 14a_assign_ncr.sql
# ---------------------------------------------------------------------------

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_VALIDATOR_UID = uuid.UUID("22222222-2222-4222-8222-222222222222")

_DB_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:password@postgres:5432/wims"
)
_MIGRATION_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "postgres-init",
        "17_immutable_records.sql",
    )
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _autocommit_engine():
    return create_engine(_DB_URL, isolation_level="AUTOCOMMIT")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def db():
    """Plain SQLAlchemy session for direct SQL queries."""
    from database import _SessionLocal  # noqa: SLF001

    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def encoder_region(db):
    """NCR region_id assigned to seed encoder_test user."""
    row = db.execute(
        text("SELECT assigned_region_id FROM wims.users WHERE user_id = :uid"),
        {"uid": _ENCODER_UID},
    ).fetchone()
    assert row and row[0] is not None, (
        "encoder_test has no assigned_region_id — run migration 14a_assign_ncr_to_test_users.sql"
    )
    return row[0]


@pytest.fixture
def validator_region(db):
    """Region_id assigned to seed validator_test user."""
    row = db.execute(
        text("SELECT assigned_region_id FROM wims.users WHERE user_id = :uid"),
        {"uid": _VALIDATOR_UID},
    ).fetchone()
    assert row and row[0] is not None, (
        "validator_test has no assigned_region_id — run migrations 14a + 15"
    )
    return row[0]


@pytest.fixture
def verified_incident(encoder_region, validator_region):
    """
    Full workflow: create DRAFT → submit PENDING → approve VERIFIED.
    Returns incident_id. Does not delete the incident (VERIFIED rows are
    immutable after migration — deletion is intentionally blocked by DB rule).
    """

    # Step 1: create and submit as encoder
    async def _enc():
        return {
            "user_id": _ENCODER_UID,
            "keycloak_id": str(_ENCODER_UID),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _enc
    with TestClient(app) as client:
        resp = client.post(
            "/api/regional/incidents",
            json={"latitude": 14.5995, "longitude": 120.9842},
        )
        assert resp.status_code == 201, f"Create incident failed: {resp.text}"
        incident_id = resp.json()["incident_id"]

        resp = client.patch(f"/api/regional/incidents/{incident_id}/submit")
        assert resp.status_code == 200, f"Submit failed: {resp.text}"

    # Step 2: approve as validator
    async def _val():
        return {
            "user_id": _VALIDATOR_UID,
            "keycloak_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": validator_region,
        }

    app.dependency_overrides[get_current_wims_user] = _val
    with TestClient(app) as client:
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            json={"action": "accept", "notes": "Integration test approval"},
        )
        assert resp.status_code == 200, f"Verify failed: {resp.text}"

    app.dependency_overrides.clear()
    return incident_id


# ===========================================================================
# #84 — Analytics sync
# ===========================================================================


def test_84_verified_incident_appears_in_analytics(verified_incident):
    """
    Approving an incident via PATCH /verification must cause it to appear in
    wims.analytics_incident_facts.

    FAILS before fix: verify_incident() never calls sync_incident_to_analytics().
    PASSES after fix: sync called after db.commit() inside verify_incident().
    """
    engine = _autocommit_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT incident_id FROM wims.analytics_incident_facts "
                "WHERE incident_id = :iid"
            ),
            {"iid": verified_incident},
        ).fetchone()

    assert row is not None, (
        f"Incident {verified_incident} not found in analytics_incident_facts — "
        "fix #84: add sync_incident_to_analytics() call in verify_incident()"
    )


# ===========================================================================
# #66 — data_hash
# ===========================================================================


def test_66_verified_incident_has_data_hash(verified_incident):
    """
    Approving an incident must store a SHA-256 hex digest in fire_incidents.data_hash.

    FAILS before fix: data_hash column does not exist (ProgrammingError) or is NULL.
    PASSES after fix: migration adds column, verify_incident() computes and stores hash.
    """
    engine = _autocommit_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT data_hash FROM wims.fire_incidents WHERE incident_id = :iid"),
            {"iid": verified_incident},
        ).fetchone()

    assert row is not None, f"Incident {verified_incident} not found in fire_incidents"
    data_hash = row[0]
    assert data_hash is not None, (
        "data_hash is NULL — fix #66: compute SHA-256 in verify_incident() on VERIFIED transition"
    )
    assert len(data_hash) == 64, (
        f"data_hash must be 64 hex chars (SHA-256), got length {len(data_hash)}: {data_hash!r}"
    )
    assert all(c in "0123456789abcdef" for c in data_hash), (
        f"data_hash must be lowercase hex, got: {data_hash!r}"
    )


# ===========================================================================
# #66 — DB-level immutability rules
# ===========================================================================


def test_66_db_blocks_update_on_verified(verified_incident):
    """
    After 17_immutable_records.sql is applied, UPDATE on a VERIFIED row must
    be silently blocked (DO INSTEAD NOTHING → rowcount == 0).

    FAILS before migration: UPDATE succeeds, rowcount == 1.
    PASSES after migration: no_update_verified RULE fires, rowcount == 0.
    """
    engine = _autocommit_engine()
    with engine.connect() as conn:
        result = conn.execute(
            text(
                "UPDATE wims.fire_incidents "
                "SET verification_status = 'PENDING' "
                "WHERE incident_id = :iid"
            ),
            {"iid": verified_incident},
        )
        rows_affected = result.rowcount

    assert rows_affected == 0, (
        f"Expected 0 rows affected (RULE should block UPDATE on VERIFIED row), "
        f"got {rows_affected} — apply 17_immutable_records.sql"
    )


def test_66_db_blocks_delete_on_ivh(verified_incident, db):
    """
    DELETE on incident_verification_history must silently no-op (append-only).

    FAILS before migration: DELETE removes the IVH row.
    PASSES after migration: no_delete_ivh RULE fires (DO INSTEAD NOTHING), row remains.
    """
    # Find the IVH row written when this incident was approved
    row = db.execute(
        text(
            "SELECT history_id FROM wims.incident_verification_history "
            "WHERE target_type = 'OFFICIAL' AND target_id = :iid "
            "  AND new_status = 'VERIFIED' "
            "ORDER BY action_timestamp DESC LIMIT 1"
        ),
        {"iid": verified_incident},
    ).fetchone()
    assert row is not None, (
        "No IVH row found for VERIFIED transition — "
        "verify_incident() must write to incident_verification_history"
    )
    history_id = row[0]

    # Attempt delete via superuser connection (bypasses RLS, but not rules)
    engine = _autocommit_engine()
    with engine.connect() as conn:
        conn.execute(
            text(
                "DELETE FROM wims.incident_verification_history WHERE history_id = :hid"
            ),
            {"hid": history_id},
        )

    # Row must still exist (DO INSTEAD NOTHING)
    remaining = db.execute(
        text(
            "SELECT 1 FROM wims.incident_verification_history WHERE history_id = :hid"
        ),
        {"hid": history_id},
    ).fetchone()
    assert remaining is not None, (
        f"IVH row {history_id} was deleted — "
        "apply 17_immutable_records.sql no_delete_ivh RULE to enforce append-only"
    )


# ===========================================================================
# #66 — Migration idempotency
# ===========================================================================


def test_66_migration_idempotent():
    """
    17_immutable_records.sql must be safe to run twice without error.

    FAILS before Phase 3: migration file does not exist.
    PASSES after Phase 3: all DDL uses IF NOT EXISTS / DROP IF EXISTS guards.
    """
    assert os.path.exists(_MIGRATION_PATH), (
        f"Migration not found at {_MIGRATION_PATH}\n"
        "Create src/postgres-init/17_immutable_records.sql first (Phase 3)."
    )

    with open(_MIGRATION_PATH) as f:
        sql = f.read()

    # psycopg2 can execute multi-statement SQL including explicit BEGIN/COMMIT
    conn = psycopg2.connect(_DB_URL)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql)  # First run
        with conn.cursor() as cur:
            cur.execute(sql)  # Second run — must not raise
    finally:
        conn.close()
