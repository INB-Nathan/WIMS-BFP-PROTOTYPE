"""
Tests for M6-D Incident Correction Workflow (spec #95).

Prerequisites (must be applied before running):
  1. 17a_fix_immutable_rule.sql  — narrows no_update_verified RULE
  2. 18_ivh_hash_chain.sql      — adds old_data_hash, new_data_hash, corrected_fields to IVH
  3. 19_nsd_immutability_rules.sql — NSD immutability rules

Run inside Docker:
    docker compose run --rm backend pytest tests/test_correction_workflow.py -v
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from auth import get_current_wims_user
from main import app

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_VALIDATOR_UID = uuid.UUID("22222222-2222-4222-8222-222222222222")


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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_correct_returns_200_for_validator(verified_incident, db):
    incident_id = verified_incident
    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": 1,
        }
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/correct",
            json={"corrections": {"civilian_injured": 3}, "notes": "test correction"},
        )
    assert resp.status_code == 200


def test_correct_returns_403_for_encoder(verified_incident, db):
    incident_id = verified_incident
    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_ENCODER_UID),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": 1,
        }
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/correct",
            json={"corrections": {"civilian_injured": 3}},
        )
    assert resp.status_code == 403


def test_correct_returns_409_for_non_verified(db):
    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_ENCODER_UID),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": 1,
        }
        create_resp = client.post(
            "/api/regional/incidents",
            json={"latitude": 14.5995, "longitude": 120.9842},
        )
        incident_id = create_resp.json()["incident_id"]

    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": 1,
        }
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/correct",
            json={"corrections": {"civilian_injured": 3}},
        )
    assert resp.status_code == 409


def test_correct_returns_404_for_missing(db):
    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": 1,
        }
        resp = client.patch(
            "/api/regional/incidents/999999999/correct",
            json={"corrections": {"civilian_injured": 3}},
        )
    assert resp.status_code == 404


def test_correct_updates_data_hash(verified_incident, db):
    """data_hash recomputed on correction — identity fields same so hash stays the same."""
    incident_id = verified_incident
    original = db.execute(
        text("SELECT data_hash FROM wims.fire_incidents WHERE incident_id = :id"),
        {"id": incident_id}
    ).fetchone()
    original_hash = original[0]
    assert original_hash is not None

    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": 1,
        }
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/correct",
            json={"corrections": {"civilian_injured": 5}, "notes": "hash test"},
        )
    assert resp.status_code == 200

    new_row = db.execute(
        text("SELECT data_hash FROM wims.fire_incidents WHERE incident_id = :id"),
        {"id": incident_id}
    ).fetchone()
    assert new_row[0] is not None
    assert len(new_row[0]) == 64
    assert new_row[0] == original_hash


def test_correct_creates_ivh_correction_row(verified_incident, db):
    incident_id = verified_incident
    old_hash = db.execute(
        text("SELECT data_hash FROM wims.fire_incidents WHERE incident_id = :id"),
        {"id": incident_id}
    ).fetchone()[0]

    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": 1,
        }
        client.patch(
            f"/api/regional/incidents/{incident_id}/correct",
            json={"corrections": {"civilian_injured": 2}, "notes": "ivh test"},
        )

    ivh = db.execute(
        text("""
            SELECT action_by_user_id, previous_status, new_status,
                   notes, old_data_hash, new_data_hash, corrected_fields
            FROM wims.incident_verification_history
            WHERE target_id = :id AND notes = 'ivh test'
            ORDER BY action_timestamp DESC LIMIT 1
        """),
        {"id": incident_id}
    ).fetchone()

    assert ivh is not None
    assert str(ivh[0]) == str(_VALIDATOR_UID)
    assert ivh[1] == "VERIFIED"
    assert ivh[2] == "VERIFIED"
    assert ivh[3] == "ivh test"
    assert ivh[4] == old_hash
    assert ivh[5] is not None and len(ivh[5]) == 64
    assert "civilian_injured" in ivh[6]


def test_correct_syncs_analytics(verified_incident, db):
    """Correction must trigger analytics sync for the incident."""
    incident_id = verified_incident
    with TestClient(app) as client:
        app.dependency_overrides[get_current_wims_user] = lambda: {
            "user_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": 1,
        }
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/correct",
            json={"corrections": {"civilian_injured": 7}},
        )
    assert resp.status_code == 200

    row = db.execute(
        text("SELECT incident_id FROM wims.analytics_incident_facts WHERE incident_id = :id"),
        {"id": incident_id}
    ).fetchone()
    assert row is not None, "Analytics fact must exist after correction sync"


def test_correct_nsd_blocked_by_direct_sql(verified_incident, db):
    incident_id = verified_incident
    result = db.execute(
        text("""
            UPDATE wims.incident_nonsensitive_details
            SET civilian_injured = 99
            WHERE incident_id = :id
        """),
        {"id": incident_id}
    )
    db.rollback()
    assert result.rowcount == 0