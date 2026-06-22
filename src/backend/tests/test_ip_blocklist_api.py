"""Tests for Task 4 backend endpoints — block-source-ip, block-by-filter, bulk-action, DELETE security-log.

TDD: tests are written BEFORE the endpoints exist. They will fail with 404.
"""

import pytest
from unittest.mock import MagicMock, patch
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


# =============================================================================
# POST /api/admin/security-logs/{log_id}/block-source-ip
# =============================================================================


class TestBlockSourceIp:
    def test_success(self, client):
        """POST with ttl_hours=24 → 200, blocking result with ip/is_permanent/expires_at."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("1.2.3.4",)
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.block_ip") as mock_block_ip:
            mock_block_ip.return_value = {
                "ip": "1.2.3.4",
                "is_permanent": False,
                "expires_at": "2026-06-23T12:00:00+00:00",
                "block_count": 1,
                "repeat_offender": False,
                "already_active": False,
            }

            response = client.post(
                "/api/admin/security-logs/1/block-source-ip",
                json={"ttl_hours": 24},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["ip"] == "1.2.3.4"
        assert data["is_permanent"] is False
        assert data["already_active"] is False

    def test_self_ip_400(self, client):
        """POST blocking own IP → 400 from ValueError in block_ip."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("1.2.3.4",)
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.block_ip") as mock_block_ip:
            mock_block_ip.side_effect = ValueError("Cannot block your own IP address")

            response = client.post(
                "/api/admin/security-logs/1/block-source-ip",
                json={"ttl_hours": 24},
            )

        assert response.status_code == 400
        data = response.json()
        assert "Cannot block your own IP" in data["detail"]

    def test_404_missing_log(self, client):
        """POST on non-existent log_id → 404."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.post(
            "/api/admin/security-logs/99999/block-source-ip",
            json={"ttl_hours": 24},
        )

        assert response.status_code == 404


# =============================================================================
# POST /api/admin/security-logs/block-by-filter
# =============================================================================


class TestBlockByFilter:
    def test_preview(self, client):
        """POST with ?preview=true → 200 with dry_run=True and total_distinct_ips."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.block_ips_by_filter") as mock_filter:
            mock_filter.return_value = {
                "dry_run": True,
                "total_distinct_ips": 3,
                "would_block": 2,
                "repeat_offenders": 1,
                "skipped_self": 1,
                "skipped_allowlist": 0,
                "capped_at": 500,
            }

            response = client.post(
                "/api/admin/security-logs/block-by-filter?preview=true",
                json={"severity": "HIGH"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["dry_run"] is True
        assert data["total_distinct_ips"] == 3
        mock_filter.assert_called_once()


# =============================================================================
# POST /api/admin/security-logs/bulk-action
# =============================================================================


class TestBulkAction:
    def test_dismiss(self, client):
        """POST with action=dismiss and log_ids=[1,2,3] → 200, all dismissed."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.log_system_audit"):
            response = client.post(
                "/api/admin/security-logs/bulk-action",
                json={"log_ids": [1, 2, 3], "action": "dismiss"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 3
        assert all(r["status"] == "dismissed" for r in data["results"])

    def test_empty_log_ids_400(self, client):
        """POST with empty log_ids → 400."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.post(
            "/api/admin/security-logs/bulk-action",
            json={"log_ids": [], "action": "dismiss"},
        )

        assert response.status_code == 400
        data = response.json()
        assert "must not be empty" in data["detail"]


# =============================================================================
# DELETE /api/admin/security-logs/{log_id}
# =============================================================================


class TestDeleteSecurityLog:
    def test_soft_deletes(self, client):
        """DELETE /api/admin/security-logs/1 → 200, soft-deletes via dismiss helper."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = (1,)
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.log_system_audit"):
            response = client.delete("/api/admin/security-logs/1")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["log_id"] == 1

    def test_404_missing(self, client):
        """DELETE on non-existent log_id → 404."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.delete("/api/admin/security-logs/99999")

        assert response.status_code == 404


# =============================================================================
# Path-ordering regression (very important — see task doc)
# =============================================================================


class TestPathOrdering:
    def test_block_by_filter_not_captured_by_log_id(self, client):
        """POST /api/admin/security-logs/block-by-filter must NOT match /{log_id}/analyze."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.block_ips_by_filter") as mock_filter:
            mock_filter.return_value = {"dry_run": True, "total_distinct_ips": 0}

            response = client.post(
                "/api/admin/security-logs/block-by-filter",
                json={},
            )

        assert response.status_code == 200
        mock_filter.assert_called_once()
