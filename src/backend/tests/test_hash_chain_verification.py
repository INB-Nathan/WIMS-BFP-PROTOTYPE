"""
Tests for #241 — read-path hash-chain verification for incident integrity.

Red state: FAIL before implementation — verify_incident_hash_chain does not exist.
Green state: PASS after implementation is complete.

Run inside Docker:
    docker compose run --rm backend pytest tests/test_hash_chain_verification.py -v
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from auth import get_current_wims_user
from main import app

# ---------------------------------------------------------------------------
# Seed user UUIDs — created by 03_users.sql, assigned NCR by 14a_assign_ncr.sql
# ---------------------------------------------------------------------------

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_VALIDATOR_UID = uuid.UUID("22222222-2222-4222-8222-222222222222")


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def db():
    """Plain SQLAlchemy session for direct SQL queries."""
    from database import _AdminSessionLocal

    session = _AdminSessionLocal()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ENCODER_OVERRIDE = {
    "user_id": str(_ENCODER_UID),
    "keycloak_id": str(_ENCODER_UID),
    "role": "REGIONAL_ENCODER",
    "assigned_region_id": 13,  # NCR
}

_VALIDATOR_OVERRIDE = {
    "user_id": str(_VALIDATOR_UID),
    "keycloak_id": str(_VALIDATOR_UID),
    "role": "NATIONAL_VALIDATOR",
    "assigned_region_id": 13,
}


@pytest.fixture
def corrected_incident(db):
    """Create, submit, approve, then correct an incident.

    Returns the incident_id. The correction writes hash-chain columns.
    """

    # Step 1: create and submit as encoder
    async def _enc():
        return _ENCODER_OVERRIDE

    app.dependency_overrides[get_current_wims_user] = _enc
    with TestClient(app) as client:
        resp = client.post(
            "/api/regional/incidents",
            json={
                "latitude": 14.5995,
                "longitude": 120.9842,
                "notification_dt": "2026-05-11T08:00:00+08:00",
                "general_category": "STRUCTURAL",
                "province_district": "Metro Manila",
                "city_municipality": "Quezon City",
                "alarm_level": "FIRST_ALARM",
                "incident_type_code": "APT",
            },
        )
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        incident_id = resp.json()["incident_id"]

        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/submit",
            params={"force": True},
        )
        assert resp.status_code == 200, f"Submit failed: {resp.text}"

    # Step 2: approve as validator
    async def _val():
        return _VALIDATOR_OVERRIDE

    app.dependency_overrides[get_current_wims_user] = _val
    with TestClient(app) as client:
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "Approval for hash-chain test"},
        )
        assert resp.status_code == 200, f"Verify failed: {resp.text}"

    # Step 3: apply a correction (this writes hash-chain columns)
    with TestClient(app) as client:
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/correct",
            json={
                "corrections": {
                    "alarm_level": "SECOND_ALARM",
                    "estimated_damage_php": 500000,
                },
                "notes": "Correction for hash-chain test",
            },
        )
        assert resp.status_code == 200, f"Correct failed: {resp.text}"

    app.dependency_overrides.clear()
    return incident_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_241_valid_hash_chain_passes_verification(corrected_incident):
    """After a correction, the hash chain must verify as 'valid'."""
    from services.regional_incidents.helpers import verify_incident_hash_chain
    from database import _AdminSessionLocal

    session = _AdminSessionLocal()
    try:
        result = verify_incident_hash_chain(session, corrected_incident, log_violations=False)
        assert result["integrity_status"] == "valid", (
            f"Expected 'valid', got '{result['integrity_status']}'. "
            f"Violations: {result['violations']}"
        )
        assert result["rows_verified"] >= 1, (
            f"Expected at least 1 hash-chain row, got {result['rows_verified']}"
        )
        assert result["violations"] == [], f"Unexpected violations: {result['violations']}"
    finally:
        session.close()


def test_241_tampered_ivh_row_hash_detected(corrected_incident, db):
    """Tampering with ivh_row_hash in the DB must be detected as 'tampered'."""
    # Find a hash-chain IVH row
    row = db.execute(
        text(
            "SELECT history_id, ivh_row_hash "
            "FROM wims.incident_verification_history "
            "WHERE target_type = 'OFFICIAL' AND target_id = :iid "
            "  AND ivh_row_hash IS NOT NULL "
            "ORDER BY action_timestamp DESC LIMIT 1"
        ),
        {"iid": corrected_incident},
    ).fetchone()
    assert row is not None, "No hash-chain IVH row found"

    history_id, original_hash = row
    # Flip the first hex char to produce a corrupt hash
    tampered_hash = ("f" if original_hash[0] != "f" else "0") + original_hash[1:]

    db.execute(
        text(
            "UPDATE wims.incident_verification_history "
            "SET ivh_row_hash = :th WHERE history_id = :hid"
        ),
        {"th": tampered_hash, "hid": history_id},
    )
    db.commit()

    from services.regional_incidents.helpers import verify_incident_hash_chain
    from database import _AdminSessionLocal

    session = _AdminSessionLocal()
    try:
        result = verify_incident_hash_chain(session, corrected_incident, log_violations=False)
        assert result["integrity_status"] == "tampered", (
            f"Expected 'tampered' after hash corruption, got '{result['integrity_status']}'"
        )
        assert len(result["violations"]) >= 1, (
            f"Expected at least 1 violation, got {len(result['violations'])}"
        )
    finally:
        session.close()


def test_241_tampered_prev_hash_chain_break_detected(corrected_incident, db):
    """Breaking the prev_ivh_hash chain must be detected as 'tampered'."""
    rows = db.execute(
        text(
            "SELECT history_id, ivh_row_hash "
            "FROM wims.incident_verification_history "
            "WHERE target_type = 'OFFICIAL' AND target_id = :iid "
            "  AND ivh_row_hash IS NOT NULL "
            "ORDER BY action_timestamp ASC, history_id ASC"
        ),
        {"iid": corrected_incident},
    ).fetchall()

    # Need at least 2 hash-chain rows to break a chain link
    if len(rows) < 2:
        # Apply a second correction to get a second hash-chain row
        async def _val():
            return _VALIDATOR_OVERRIDE

        app.dependency_overrides[get_current_wims_user] = _val
        with TestClient(app) as client:
            resp = client.patch(
                f"/api/regional/incidents/{corrected_incident}/correct",
                json={
                    "corrections": {
                        "general_category": "NON_STRUCTURAL",
                    },
                    "notes": "Second correction for chain-break test",
                },
            )
            assert resp.status_code == 200, f"Second correction failed: {resp.text}"
        app.dependency_overrides.clear()

        rows = db.execute(
            text(
                "SELECT history_id, ivh_row_hash "
                "FROM wims.incident_verification_history "
                "WHERE target_type = 'OFFICIAL' AND target_id = :iid "
                "  AND ivh_row_hash IS NOT NULL "
                "ORDER BY action_timestamp ASC, history_id ASC"
            ),
            {"iid": corrected_incident},
        ).fetchall()

    assert len(rows) >= 2, "Need at least 2 hash-chain rows to test chain break"

    # Tamper with the second row's prev_ivh_hash to break the chain
    second_history_id = rows[1][0]
    fake_prev_hash = "0" * 64

    db.execute(
        text(
            "UPDATE wims.incident_verification_history "
            "SET prev_ivh_hash = :ph WHERE history_id = :hid"
        ),
        {"ph": fake_prev_hash, "hid": second_history_id},
    )
    db.commit()

    from services.regional_incidents.helpers import verify_incident_hash_chain
    from database import _AdminSessionLocal

    session = _AdminSessionLocal()
    try:
        result = verify_incident_hash_chain(session, corrected_incident, log_violations=False)
        assert result["integrity_status"] == "tampered", (
            f"Expected 'tampered' after chain break, got '{result['integrity_status']}'"
        )
        chain_break_violation = any(
            "chain broken" in v.lower() or "prev_ivh_hash" in v.lower()
            for v in result["violations"]
        )
        assert chain_break_violation, f"Expected chain-break violation, got: {result['violations']}"
    finally:
        session.close()


def test_241_unverified_when_no_hash_chain_rows(db):
    """An incident with no hash-chain IVH rows returns 'unverified'."""
    from services.regional_incidents.helpers import verify_incident_hash_chain
    from database import _AdminSessionLocal

    session = _AdminSessionLocal()
    try:
        # Use a non-existent incident_id
        result = verify_incident_hash_chain(session, -99999, log_violations=False)
        assert result["integrity_status"] == "unverified", (
            f"Expected 'unverified' for incident with no hash rows, "
            f"got '{result['integrity_status']}'"
        )
        assert result["rows_verified"] == 0
        assert result["violations"] == []
    finally:
        session.close()


def test_241_integrity_status_in_api_response(corrected_incident):
    """The regional incident detail endpoint must return an 'integrity_status' field."""

    async def _val():
        return _VALIDATOR_OVERRIDE

    app.dependency_overrides[get_current_wims_user] = _val
    with TestClient(app) as client:
        resp = client.get(f"/api/regional/incidents/{corrected_incident}")
        assert resp.status_code == 200, f"GET incident failed: {resp.text}"
        data = resp.json()
        assert "integrity_status" in data, (
            f"Response missing 'integrity_status': {list(data.keys())}"
        )
        assert data["integrity_status"] in ("valid", "tampered", "unverified"), (
            f"Unexpected integrity_status: {data['integrity_status']}"
        )
        # After clean correction, should be 'valid'
        assert data["integrity_status"] == "valid", (
            f"Expected 'valid' after clean correction, got '{data['integrity_status']}'"
        )
