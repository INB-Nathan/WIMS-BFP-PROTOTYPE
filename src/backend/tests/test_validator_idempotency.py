"""
Reproduction test for #267 — Idempotent Validator Verification.

Red state: test MUST FAIL before the feature is implemented.
Green state: test PASSES after:
  1. src/postgres-init/56_add_client_id_to_verification_history.sql applied
  2. VerificationActionRequest schema accepts optional client_id
  3. verify_incident_command() checks IVH for existing client_id before
     applying the transition, returning {"status": "already_applied"} (200)
     on match.

Run inside Docker:
    docker compose run --rm backend pytest tests/test_validator_idempotency.py -v
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from auth import get_current_wims_user
from main import app

# ---------------------------------------------------------------------------
# Seed user UUIDs — created by 03_users.sql, assigned NCR by 14a_assign_ncr.sql
# ---------------------------------------------------------------------------

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_VALIDATOR_UID = uuid.UUID("22222222-2222-4222-8222-222222222222")

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


# ===========================================================================
# #267 — Idempotent validator verification via client_id
# ===========================================================================


def test_267_duplicate_client_id_returns_already_applied():
    """
    Sending the same client_id twice to PATCH /verification must return
    {"status": "already_applied"} (200) on the second call instead of
    re-applying the verification.

    FAILS before fix: second call returns 409 because the incident is
    already VERIFIED (or 400/403). The client_id field is not recognized,
    so the idempotency check never runs.

    PASSES after fix: second call checks IVH for matching client_id,
    finds the row from the first call, and returns 200 with
    {"status": "already_applied"} without mutating state.
    """
    encoder_region = 13  # NCR — known from seed data / 14a_assign_ncr.sql

    # Step 1: create and submit incident as encoder
    async def _enc():
        return {
            "user_id": _ENCODER_UID,
            "keycloak_id": str(_ENCODER_UID),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _enc
    test_client_id = str(uuid.uuid4())

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
        assert resp.status_code == 201, f"Create incident failed: {resp.text}"
        incident_id = resp.json()["incident_id"]

        # Submit to PENDING
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/submit",
            params={"force": True},
        )
        assert resp.status_code == 200, f"Submit failed: {resp.text}"

    # Step 2: verify (approve) as validator with a client_id
    async def _val():
        return {
            "user_id": _VALIDATOR_UID,
            "keycloak_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _val

    with TestClient(app) as client:
        # First verification — should succeed normally
        resp1 = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={
                "action": "accept",
                "notes": "Integration test — idempotency check, call 1",
                "client_id": test_client_id,
            },
        )
        assert resp1.status_code == 200, (
            f"First verification failed: {resp1.status_code} — {resp1.text}"
        )
        body1 = resp1.json()
        assert body1.get("new_status") == "VERIFIED", f"Expected new_status=VERIFIED, got: {body1}"

        # Second verification with the same client_id — must be idempotent
        resp2 = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={
                "action": "accept",
                "notes": "Integration test — idempotency check, call 2 (duplicate)",
                "client_id": test_client_id,
            },
        )

        # THIS IS THE CORE ASSERTION — must fail on unmodified codebase
        assert resp2.status_code == 200, (
            f"FAIL (#267): Expected 200 idempotent response, "
            f"got {resp2.status_code}: {resp2.text}\n"
            f"Second call with same client_id should return 'already_applied', "
            f"not re-process the verification."
        )
        body2 = resp2.json()
        assert body2.get("status") == "already_applied", (
            f"FAIL (#267): Expected {{'status': 'already_applied'}}, "
            f"got: {body2}\n"
            f"Idempotency via client_id is not implemented — "
            f"the duplicate call should be detected and short-circuited."
        )

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Additional #267 focused tests
# ---------------------------------------------------------------------------


def test_267_archive_with_duplicate_client_id():
    """archive_incident with duplicate client_id returns already_applied."""
    encoder_region = 13

    async def _enc():
        return {
            "user_id": _ENCODER_UID,
            "keycloak_id": str(_ENCODER_UID),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _enc
    test_cid = str(uuid.uuid4())

    with TestClient(app) as client:
        resp = client.post(
            "/api/regional/incidents",
            json={
                "latitude": 14.6,
                "longitude": 120.98,
                "notification_dt": "2026-05-11T08:00:00+08:00",
                "general_category": "STRUCTURAL",
                "province_district": "Metro Manila",
                "city_municipality": "Manila",
                "alarm_level": "FIRST_ALARM",
                "incident_type_code": "COM",
            },
        )
        assert resp.status_code == 201
        incident_id = resp.json()["incident_id"]

        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/submit",
            params={"force": True},
        )
        assert resp.status_code == 200

    async def _val():
        return {
            "user_id": _VALIDATOR_UID,
            "keycloak_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _val

    with TestClient(app) as client:
        # Verify first
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "Approve for archive test"},
        )
        assert resp.status_code == 200
        assert resp.json()["new_status"] == "VERIFIED"

        # First archive with client_id
        resp1 = client.patch(
            f"/api/regional/validator/incidents/{incident_id}/archive",
            json={"client_id": test_cid},
        )
        assert resp1.status_code == 200, f"First archive failed: {resp1.text}"
        assert resp1.json()["status"] == "archived"

        # Second archive with same client_id — must be idempotent
        resp2 = client.patch(
            f"/api/regional/validator/incidents/{incident_id}/archive",
            json={"client_id": test_cid},
        )
        assert resp2.status_code == 200, (
            f"Expected 200 idempotent response, got {resp2.status_code}: {resp2.text}"
        )
        assert resp2.json()["status"] == "already_applied"

    app.dependency_overrides.clear()


def test_267_unarchive_with_duplicate_client_id():
    """unarchive_incident with duplicate client_id returns already_applied."""
    encoder_region = 13

    async def _enc():
        return {
            "user_id": _ENCODER_UID,
            "keycloak_id": str(_ENCODER_UID),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _enc
    test_cid = str(uuid.uuid4())

    with TestClient(app) as client:
        resp = client.post(
            "/api/regional/incidents",
            json={
                "latitude": 14.55,
                "longitude": 121.0,
                "notification_dt": "2026-05-11T08:00:00+08:00",
                "general_category": "STRUCTURAL",
                "province_district": "Metro Manila",
                "city_municipality": "Makati",
                "alarm_level": "FIRST_ALARM",
                "incident_type_code": "COM",
            },
        )
        assert resp.status_code == 201
        incident_id = resp.json()["incident_id"]

        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/submit",
            params={"force": True},
        )
        assert resp.status_code == 200

    async def _val():
        return {
            "user_id": _VALIDATOR_UID,
            "keycloak_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _val

    with TestClient(app) as client:
        # Verify
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "Approve"},
        )
        assert resp.status_code == 200
        assert resp.json()["new_status"] == "VERIFIED"

        # Archive (no client_id)
        resp = client.patch(
            f"/api/regional/validator/incidents/{incident_id}/archive",
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "archived"

        # First unarchive with client_id
        resp1 = client.patch(
            f"/api/regional/validator/incidents/{incident_id}/unarchive",
            json={"client_id": test_cid},
        )
        assert resp1.status_code == 200, f"First unarchive failed: {resp1.text}"
        assert resp1.json()["status"] == "unarchived"

        # Second unarchive with same client_id — must be idempotent
        resp2 = client.patch(
            f"/api/regional/validator/incidents/{incident_id}/unarchive",
            json={"client_id": test_cid},
        )
        assert resp2.status_code == 200, (
            f"Expected 200 idempotent response, got {resp2.status_code}: {resp2.text}"
        )
        assert resp2.json()["status"] == "already_applied"

    app.dependency_overrides.clear()


def test_267_verification_without_client_id_still_works():
    """Verification without client_id (null/omitted) must still work normally."""
    encoder_region = 13

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
            json={
                "latitude": 14.50,
                "longitude": 121.05,
                "notification_dt": "2026-05-11T08:00:00+08:00",
                "general_category": "STRUCTURAL",
                "province_district": "Metro Manila",
                "city_municipality": "Taguig",
                "alarm_level": "FIRST_ALARM",
                "incident_type_code": "COM",
            },
        )
        assert resp.status_code == 201
        incident_id = resp.json()["incident_id"]

        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/submit",
            params={"force": True},
        )
        assert resp.status_code == 200

    async def _val():
        return {
            "user_id": _VALIDATOR_UID,
            "keycloak_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _val

    with TestClient(app) as client:
        # Verify without client_id — should work normally
        resp1 = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "No client_id test"},
        )
        assert resp1.status_code == 200, f"Verification without client_id failed: {resp1.text}"
        assert resp1.json()["new_status"] == "VERIFIED"

        # Second verification without client_id — should hit normal 409 guard
        resp2 = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "Second call, no client_id"},
        )
        # Without client_id, normal 409 duplicate-status guard applies
        assert resp2.status_code == 409, (
            f"Without client_id, second call should get 409 (status guard), "
            f"got {resp2.status_code}: {resp2.text}"
        )

    app.dependency_overrides.clear()


def test_267_different_client_ids_produce_distinct_ivh_rows():
    """Different client_id values produce distinct IVH rows (no false idempotency)."""
    encoder_region = 13
    cid_a = str(uuid.uuid4())
    cid_b = str(uuid.uuid4())

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
            json={
                "latitude": 14.45,
                "longitude": 121.1,
                "notification_dt": "2026-05-11T08:00:00+08:00",
                "general_category": "STRUCTURAL",
                "province_district": "Metro Manila",
                "city_municipality": "Pasay",
                "alarm_level": "FIRST_ALARM",
                "incident_type_code": "COM",
            },
        )
        assert resp.status_code == 201
        incident1 = resp.json()["incident_id"]
        resp = client.patch(
            f"/api/regional/incidents/{incident1}/submit",
            params={"force": True},
        )
        assert resp.status_code == 200

        resp = client.post(
            "/api/regional/incidents",
            json={
                "latitude": 14.46,
                "longitude": 121.12,
                "notification_dt": "2026-05-11T09:00:00+08:00",
                "general_category": "STRUCTURAL",
                "province_district": "Metro Manila",
                "city_municipality": "Pasay",
                "alarm_level": "FIRST_ALARM",
                "incident_type_code": "COM",
            },
        )
        assert resp.status_code == 201
        incident2 = resp.json()["incident_id"]
        resp = client.patch(
            f"/api/regional/incidents/{incident2}/submit",
            params={"force": True},
        )
        assert resp.status_code == 200

    async def _val():
        return {
            "user_id": _VALIDATOR_UID,
            "keycloak_id": str(_VALIDATOR_UID),
            "role": "NATIONAL_VALIDATOR",
            "assigned_region_id": encoder_region,
        }

    app.dependency_overrides[get_current_wims_user] = _val

    with TestClient(app) as client:
        # Verify incident1 with cid_a
        resp = client.patch(
            f"/api/regional/incidents/{incident1}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "cid_a", "client_id": cid_a},
        )
        assert resp.status_code == 200
        assert resp.json()["new_status"] == "VERIFIED"

        # Verify incident2 with cid_b — must succeed normally
        resp = client.patch(
            f"/api/regional/incidents/{incident2}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "cid_b", "client_id": cid_b},
        )
        assert resp.status_code == 200, (
            f"Different client_id on different incident should work: "
            f"{resp.status_code} — {resp.text}"
        )
        assert resp.json()["new_status"] == "VERIFIED"

        # Re-verify incident1 with cid_a — should be idempotent
        resp = client.patch(
            f"/api/regional/incidents/{incident1}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "retry cid_a", "client_id": cid_a},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "already_applied"

    app.dependency_overrides.clear()
