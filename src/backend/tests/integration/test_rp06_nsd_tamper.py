"""RP-06 integration test: direct NSD edit must be detected as 'tampered'.

verify_incident_hash_chain() now recomputes data_hash from current NSD on every
read.  A direct DB update to incident_nonsensitive_details that bypasses the
correction flow must change integrity_status from 'valid' to 'tampered'.

Requires a live PostgreSQL instance with the standard bootstrap seed data.
Run from within the backend container:
    python -m pytest tests/integration/test_rp06_nsd_tamper.py -v
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from database import get_session
from services.regional_incidents.helpers import (
    compute_incident_data_hash,
    verify_incident_hash_chain,
)

# Seeded by 03_users.sql — SYSTEM_ADMIN svc_task
_SVC_TASK_ID = uuid.UUID("00000000-0000-4000-8000-000000000002")

# Encoder seeded by 03_users.sql + 29_seed_incidents.sql
_ENCODER_UUID = uuid.UUID("11111111-1111-4111-8111-111111111111")


@pytest.fixture
def db():
    """SYSTEM_ADMIN RLS session; always rolls back so tests leave no side-effects."""
    session = get_session(_SVC_TASK_ID)
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _pick_verified_incident(db) -> int:
    """Return incident_id of any seeded VERIFIED incident, or skip."""
    row = db.execute(
        text("""
            SELECT fi.incident_id
            FROM wims.fire_incidents fi
            WHERE fi.verification_status = 'VERIFIED'
              AND fi.encoder_id = :enc
            ORDER BY fi.incident_id
            LIMIT 1
        """),
        {"enc": str(_ENCODER_UUID)},
    ).fetchone()
    if row is None:
        pytest.skip("No seeded VERIFIED incidents — run bootstrap first")
    return int(row[0])


def _set_data_hash(db, incident_id: int) -> str:
    """Compute + store data_hash for incident if NULL; return the stored hash.

    In a test session (not yet committed), this UPDATE goes through the
    no_update_verified data_hash carve-out (migration 68).  The session
    rollback on teardown cleans it up.
    """
    stored = db.execute(
        text("SELECT data_hash FROM wims.fire_incidents WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).scalar()
    if stored:
        return stored

    prov = db.execute(
        text("""
            SELECT fi.encoder_id, u.keycloak_id, fi.region_id,
                   fi.created_at, fi.verification_status
            FROM wims.fire_incidents fi
            LEFT JOIN wims.users u ON u.user_id = fi.encoder_id
            WHERE fi.incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()
    assert prov is not None, f"incident {incident_id} not found"
    encoder_id, keycloak_id, region_id, created_at, vstatus = prov

    h = compute_incident_data_hash(
        db,
        incident_id,
        encoder_id=encoder_id,
        keycloak_id=keycloak_id,
        region_id=region_id,
        created_at=created_at,
        verification_status=vstatus or "VERIFIED",
    )
    db.execute(
        text("UPDATE wims.fire_incidents SET data_hash = :h WHERE incident_id = :iid"),
        {"h": h, "iid": incident_id},
    )
    return h


class TestNSDTamperDetection:
    """RP-06: recompute data_hash from live NSD on every integrity read."""

    def test_unmodified_incident_is_valid(self, db):
        """After data_hash is set, an untouched NSD must report 'valid'."""
        iid = _pick_verified_incident(db)
        _set_data_hash(db, iid)

        result = verify_incident_hash_chain(db, iid, log_violations=False)

        assert result["integrity_status"] == "valid", (
            f"Expected 'valid', got {result['integrity_status']!r}. "
            f"violations={result['violations']}"
        )
        assert result["violations"] == []

    def test_direct_nsd_edit_returns_tampered(self, db):
        """Direct DB edit of civilian_injured must flip status to 'tampered'."""
        iid = _pick_verified_incident(db)
        _set_data_hash(db, iid)

        # Baseline must be valid before the tamper.
        before = verify_incident_hash_chain(db, iid, log_violations=False)
        assert before["integrity_status"] == "valid", (
            f"Baseline not 'valid': {before['violations']}"
        )

        # Directly tamper a NSD field — bypasses the correction-flow hash update.
        db.execute(
            text("""
                UPDATE wims.incident_nonsensitive_details
                SET civilian_injured = COALESCE(civilian_injured, 0) + 99
                WHERE incident_id = :iid
            """),
            {"iid": iid},
        )

        after = verify_incident_hash_chain(db, iid, log_violations=False)

        assert after["integrity_status"] == "tampered", (
            f"Expected 'tampered' after NSD edit, got {after['integrity_status']!r}. "
            f"violations={after['violations']}"
        )
        assert any("NSD tamper detected" in v for v in after["violations"]), (
            f"Expected 'NSD tamper detected' in violations but got: {after['violations']}"
        )

    def test_null_data_hash_returns_unverified(self, db):
        """Incident with no data_hash must return 'unverified', never 'tampered'."""
        row = db.execute(
            text("""
                SELECT incident_id FROM wims.fire_incidents
                WHERE data_hash IS NULL
                LIMIT 1
            """)
        ).fetchone()
        if row is None:
            pytest.skip("All incidents already have data_hash set")

        result = verify_incident_hash_chain(db, int(row[0]), log_violations=False)
        assert result["integrity_status"] == "unverified", (
            f"Expected 'unverified', got {result['integrity_status']!r}"
        )
