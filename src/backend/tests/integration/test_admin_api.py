"""
TDD: System Admin Role Matrix — Admin API Guardrails.

Red State: ENCODER must receive 403 Forbidden on GET /api/admin/users.
Green State: SYSTEM_ADMIN must receive 200 OK on GET /api/admin/users.
"""

import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

import auth
from database import get_db
from main import app


@pytest.fixture
def client():
    """TestClient for FastAPI app."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    """Ensure dependency overrides are cleared after each test."""
    yield
    app.dependency_overrides.clear()


def test_admin_rejects_encoder(client: TestClient):
    """Mock ENCODER token: GET /api/admin/users must return 403 Forbidden."""

    async def mock_encoder_user():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "username": "test-username",
            "role": "REGIONAL_ENCODER",
        }

    app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user

    response = client.get("/api/admin/users")
    assert response.status_code == 403
    assert "SYSTEM_ADMIN" in (response.json().get("detail") or "")


def test_admin_accepts_system_admin(client: TestClient):
    """Mock SYSTEM_ADMIN token: GET /api/admin/users must return 200 OK."""

    async def mock_system_admin_user():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "username": "test-username",
            "role": "SYSTEM_ADMIN",
        }

    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        try:
            yield mock_db
        finally:
            pass

    app.dependency_overrides[auth.get_current_wims_user] = mock_system_admin_user
    app.dependency_overrides[get_db] = mock_get_db

    response = client.get("/api/admin/users")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
