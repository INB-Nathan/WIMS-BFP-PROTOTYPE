"""
Integration tests for POST /api/incidents Geospatial Intake Endpoint.

Run: pytest backend/tests/integration/test_incidents_api.py -v
"""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import create_engine

from auth import get_current_wims_user
from main import app


def _get_engine():
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@postgres:5432/wims",
    )
    return create_engine(url, isolation_level="AUTOCOMMIT")


@pytest.fixture
def client():
    """TestClient for FastAPI app."""
    return TestClient(app)


@pytest.fixture
def mock_user_and_override(client):
    """
    Create a test user in wims.users and override get_current_wims_user
    to return that user. Clean up after the test.
    """
    engine = _get_engine()
    user_id = uuid.uuid4()
    keycloak_id = uuid.uuid4()
    username = f"test_encoder_{user_id.hex[:8]}"

    try:
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO wims.users (user_id, keycloak_id, username, role)
                    VALUES (:uid, :kid, :username, 'ENCODER')
                """),
                {"uid": user_id, "kid": keycloak_id, "username": username},
            )

        async def _async_override():
            return {"user_id": user_id, "keycloak_id": str(keycloak_id)}

        app.dependency_overrides[get_current_wims_user] = _async_override

        yield user_id
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)
        with engine.connect() as conn:
            conn.execute(
                text("DELETE FROM wims.fire_incidents WHERE encoder_id = :uid"),
                {"uid": user_id},
            )
            conn.execute(
                text("DELETE FROM wims.users WHERE user_id = :uid"),
                {"uid": user_id},
            )


class TestIncidentsAPI:
    """POST /api/incidents — Geospatial Intake."""

    def test_post_without_token_returns_401(self, client):
        """POST to /api/incidents without a token -> Expect 401 Unauthorized."""
        response = client.post(
            "/api/incidents",
            json={
                "latitude": 14.5995,
                "longitude": 120.9842,
                "description": "Test fire incident",
            },
        )
        assert response.status_code == 401
        assert "detail" in response.json()

    def test_post_with_valid_mock_token_returns_201_and_verifies_data(
        self, client, mock_user_and_override
    ):
        """POST to /api/incidents with a valid mock token -> Expect 201 Created and verify data."""
        user_id = mock_user_and_override

        response = client.post(
            "/api/incidents",
            json={
                "latitude": 14.5995,
                "longitude": 120.9842,
                "description": "Test fire in Manila",
            },
            headers={"Authorization": "Bearer mock-token"},
        )

        assert response.status_code == 201
        data = response.json()
        assert "incident_id" in data
        assert data["incident_id"] > 0
        assert data["latitude"] == 14.5995
        assert data["longitude"] == 120.9842
        assert data["encoder_id"] == str(user_id)
        assert data["status"] == "PENDING"
        assert "created_at" in data
