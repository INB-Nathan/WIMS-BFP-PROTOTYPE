"""Tests for Task 5 — ip_blocklist router (unblock + list).

TDD: tests are written BEFORE the router exists. They will fail with 404.
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
# DELETE /api/admin/ip-blocklist/{ip}
# =============================================================================


class TestUnblockEndpoint:
    def test_unblock_200(self, client):
        """DELETE /api/admin/ip-blocklist/1.2.3.4 → 200 with status=ok."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.ip_blocklist.unblock_ip") as mock_unblock:
            mock_unblock.return_value = {"ip": "1.2.3.4", "unblocked_rows": 1}

            response = client.delete("/api/admin/ip-blocklist/1.2.3.4")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["ip"] == "1.2.3.4"

    def test_unblock_404_when_not_blocked(self, client):
        """DELETE on IP not in blocklist → 404."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.ip_blocklist.unblock_ip") as mock_unblock:
            mock_unblock.return_value = {"ip": "1.2.3.4", "unblocked_rows": 0}

            response = client.delete("/api/admin/ip-blocklist/1.2.3.4")

        assert response.status_code == 404
        data = response.json()
        assert "detail" in data


# =============================================================================
# GET /api/admin/ip-blocklist
# =============================================================================


class TestListBlockedIpsEndpoint:
    def test_list_200(self, client):
        """GET /api/admin/ip-blocklist → 200 with list of blocked IPs."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        expected = [
            {
                "source_ip": "1.2.3.4",
                "blocked_at": "2026-06-22T12:00:00+00:00",
                "expires_at": "2026-06-23T12:00:00+00:00",
                "is_permanent": False,
                "blocked_by": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                "block_reason": "manual block",
                "block_count": 1,
            }
        ]

        with patch("api.routes.admin.ip_blocklist.list_blocked_ips") as mock_list:
            mock_list.return_value = expected

            response = client.get("/api/admin/ip-blocklist")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["source_ip"] == "1.2.3.4"


# =============================================================================
# RLS — non-SYSTEM_ADMIN gets 403
# =============================================================================


class TestRlsNonAdmin:
    def test_list_403_for_non_admin(self, client):
        """GET /api/admin/ip-blocklist without SYSTEM_ADMIN role → 403."""
        app.dependency_overrides[get_system_admin] = mock_non_admin_403

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/ip-blocklist")
        assert response.status_code == 403

    def test_delete_403_for_non_admin(self, client):
        """DELETE /api/admin/ip-blocklist/1.2.3.4 without SYSTEM_ADMIN role → 403."""
        app.dependency_overrides[get_system_admin] = mock_non_admin_403

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.delete("/api/admin/ip-blocklist/1.2.3.4")
        assert response.status_code == 403
