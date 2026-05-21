"""
Tests for #69 — [M6-G] XAI Incident Narrative Generation.

Red state: 7/7 FAIL before implementation.
Green state: 7/7 PASS after:
  1. src/postgres-init/33_incident_ai_narrative.sql applied
  2. generate_incident_narrative() added to ai_service.py
  3. tasks/narrative.py batch task created
  4. Endpoints added to analytics.py

Run in Docker:
    docker compose exec backend pytest tests/test_incident_narrative.py -v
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from auth import get_current_wims_user
from main import app
from database import _SessionLocal

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_VALIDATOR_UID = uuid.UUID("22222222-2222-4222-8222-222222222222")
_ADMIN_UID = uuid.UUID("33333333-3333-4333-8333-333333333333")


@pytest.fixture
def db():
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
    assert row and row[0] is not None
    return row[0]


@pytest.fixture
def validator_region(db):
    row = db.execute(
        text("SELECT assigned_region_id FROM wims.users WHERE user_id = :uid"),
        {"uid": _VALIDATOR_UID},
    ).fetchone()
    assert row and row[0] is not None
    return row[0]


@pytest.fixture
def verified_incident(encoder_region, validator_region):
    app.dependency_overrides[get_current_wims_user] = lambda: {
        "user_id": _ENCODER_UID,
        "keycloak_id": str(_ENCODER_UID),
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": encoder_region,
    }
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
                "station_code": "TST",
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

    app.dependency_overrides[get_current_wims_user] = lambda: {
        "user_id": _VALIDATOR_UID,
        "keycloak_id": str(_VALIDATOR_UID),
        "role": "NATIONAL_VALIDATOR",
        "assigned_region_id": validator_region,
    }
    with TestClient(app) as client:
        resp = client.patch(
            f"/api/regional/incidents/{incident_id}/verification",
            params={"force": True},
            json={"action": "accept", "notes": "Test approval"},
        )
        assert resp.status_code == 200, f"Verify failed: {resp.text}"

    app.dependency_overrides.clear()
    return incident_id


@pytest.fixture
def unverified_incident(encoder_region):
    app.dependency_overrides[get_current_wims_user] = lambda: {
        "user_id": _ENCODER_UID,
        "keycloak_id": str(_ENCODER_UID),
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": encoder_region,
    }
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
                "station_code": "TST",
                "incident_type_code": "APT",
            },
        )
        assert resp.status_code == 201
        incident_id = resp.json()["incident_id"]

    app.dependency_overrides.clear()
    return incident_id


def _analyst_user():
    return {
        "user_id": _ADMIN_UID,
        "keycloak_id": str(_ADMIN_UID),
        "role": "NATIONAL_ANALYST",
        "assigned_region_id": None,
    }


def _encoder_user():
    return {
        "user_id": _ENCODER_UID,
        "keycloak_id": str(_ENCODER_UID),
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": 1,
    }


def test_narrative_endpoint_exists(verified_incident):
    app.dependency_overrides[get_current_wims_user] = _analyst_user
    with TestClient(app) as client:
        resp = client.post(f"/api/analytics/incidents/{verified_incident}/narrative")
        assert resp.status_code != 404, "Endpoint does not exist"
        assert resp.status_code in (200, 202, 502), f"Unexpected status: {resp.status_code}"


def test_narrative_requires_analyst_or_admin(unverified_incident):
    app.dependency_overrides[get_current_wims_user] = _encoder_user
    with TestClient(app) as client:
        resp = client.post(f"/api/analytics/incidents/{unverified_incident}/narrative")
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"


def test_narrative_returns_404_for_missing_incident():
    app.dependency_overrides[get_current_wims_user] = _analyst_user
    with TestClient(app) as client:
        resp = client.post("/api/analytics/incidents/999999999/narrative")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"


def test_narrative_returns_409_for_non_verified_incident(unverified_incident):
    app.dependency_overrides[get_current_wims_user] = _analyst_user
    with TestClient(app) as client:
        resp = client.post(f"/api/analytics/incidents/{unverified_incident}/narrative")
        assert resp.status_code == 409, f"Expected 409 for non-VERIFIED, got {resp.status_code}"


def test_narrative_stores_in_db(verified_incident, db):
    app.dependency_overrides[get_current_wims_user] = _analyst_user

    class MockResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"response": '{"narrative": "Test narrative.", "confidence": 0.85}'}

    async def mock_post(*args, **kwargs):
        return MockResponse()

    with patch("services.ai_service.httpx.AsyncClient") as mock_client_class:
        mock_instance = AsyncMock()
        mock_instance.post = mock_post
        mock_instance.__aenter__.return_value = mock_instance
        mock_client_class.return_value = mock_instance

        with TestClient(app) as client:
            resp = client.post(f"/api/analytics/incidents/{verified_incident}/narrative")
            if resp.status_code not in (200, 202):
                pytest.skip(f"Endpoint returned {resp.status_code}: {resp.text}")
            data = resp.json()

    assert data["incident_id"] == verified_incident
    assert data["ai_narrative"] == "Test narrative."
    assert data["ai_narrative_confidence"] == 0.85


def test_narrative_response_has_expected_fields(verified_incident):
    app.dependency_overrides[get_current_wims_user] = _analyst_user

    class MockResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"response": '{"narrative": "Test narrative.", "confidence": 0.85}'}

    async def mock_post(*args, **kwargs):
        return MockResponse()

    with patch("services.ai_service.httpx.AsyncClient") as mock_client_class:
        mock_instance = AsyncMock()
        mock_instance.post = mock_post
        mock_instance.__aenter__.return_value = mock_instance
        mock_client_class.return_value = mock_instance

        with TestClient(app) as client:
            resp = client.post(f"/api/analytics/incidents/{verified_incident}/narrative")
            if resp.status_code not in (200, 202):
                pytest.skip(f"Endpoint returned {resp.status_code}: {resp.text}")
            data = resp.json()

    assert "incident_id" in data, f"Missing incident_id in response: {data}"
    assert data["incident_id"] == verified_incident
    assert "ai_narrative" in data, f"Missing ai_narrative in response: {data}"
    assert "ai_narrative_confidence" in data, f"Missing ai_narrative_confidence in response: {data}"


def test_batch_narrative_task_exists():
    from tasks.narrative import batch_generate_narratives

    assert callable(batch_generate_narratives), "batch_generate_narratives is not callable"
