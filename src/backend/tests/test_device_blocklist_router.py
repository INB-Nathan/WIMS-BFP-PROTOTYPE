"""Tests for api/routes/admin/device_blocklist.py — unblock + list (issue #569).

Mirrors tests/test_ip_blocklist_router.py.
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from fastapi.testclient import TestClient

from auth import get_system_admin, get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def mock_admin_user():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-admin",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


def mock_non_admin_403():
    raise HTTPException(status_code=403, detail="SYSTEM_ADMIN privileges required")


# =============================================================================
# DELETE /api/admin/device-blocklist/{token_hash}
# =============================================================================


class TestUnblockEndpoint:
    def test_unblock_200(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.device_blocklist.unblock_device") as mock_unblock:
            mock_unblock.return_value = {"device_token_hash": "abc123", "unblocked_rows": 1}
            response = client.delete("/api/admin/device-blocklist/abc123")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["device_token_hash"] == "abc123"

    def test_unblock_404_when_not_blocked(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.device_blocklist.unblock_device") as mock_unblock:
            mock_unblock.return_value = {"device_token_hash": "abc123", "unblocked_rows": 0}
            response = client.delete("/api/admin/device-blocklist/abc123")

        assert response.status_code == 404


# =============================================================================
# GET /api/admin/device-blocklist
# =============================================================================


class TestListBlockedDevicesEndpoint:
    def test_list_200(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        expected = [
            {
                "device_token_hash": "abc123",
                "blocked_at": "2026-07-15T12:00:00+00:00",
                "expires_at": None,
                "is_permanent": True,
                "blocked_by": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                "block_reason": "manual block",
                "user_agent": "curl/8.0",
                "authenticated_user_id": None,
                "block_count": 3,
            }
        ]

        with patch("api.routes.admin.device_blocklist.list_blocked_devices") as mock_list:
            mock_list.return_value = expected
            response = client.get("/api/admin/device-blocklist")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["device_token_hash"] == "abc123"


# =============================================================================
# RLS — non-SYSTEM_ADMIN gets 403
# =============================================================================


class TestRlsNonAdmin:
    def test_list_403_for_non_admin(self, client):
        app.dependency_overrides[get_system_admin] = mock_non_admin_403
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/device-blocklist")
        assert response.status_code == 403

    def test_delete_403_for_non_admin(self, client):
        app.dependency_overrides[get_system_admin] = mock_non_admin_403
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.delete("/api/admin/device-blocklist/abc123")
        assert response.status_code == 403
