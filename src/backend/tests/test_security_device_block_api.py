"""Tests for the unified device/IP block endpoint + bulk grouping preview
(Wayfinder — issue #569): api/routes/admin/security.py.

Mirrors tests/test_ip_blocklist_api.py.
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
# POST /api/admin/security-logs/{log_id}/block
# =============================================================================


class TestBlockSecurityLogUnified:
    def test_block_device_success(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("1.2.3.4", "abc123")
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.block_device") as mock_block_device:
            mock_block_device.return_value = {
                "device_token_hash": "abc123",
                "is_permanent": False,
                "expires_at": "2026-07-16T12:00:00+00:00",
                "block_count": 1,
                "repeat_offender": False,
                "already_active": False,
            }
            response = client.post(
                "/api/admin/security-logs/1/block",
                json={"type": "device", "ttl_hours": 24},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["device_token_hash"] == "abc123"
        mock_block_device.assert_called_once()

    def test_block_device_no_hash_400(self, client):
        """type=device but the row has no device_token_hash → 400, no silent IP fallback."""
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("1.2.3.4", None)
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.post(
            "/api/admin/security-logs/1/block",
            json={"type": "device", "ttl_hours": 24},
        )

        assert response.status_code == 400
        assert "device_token_hash" in response.json()["detail"]

    def test_block_device_self_block_400(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("1.2.3.4", "abc123")
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.block_device") as mock_block_device:
            mock_block_device.side_effect = ValueError("Cannot block your own device")
            response = client.post(
                "/api/admin/security-logs/1/block",
                json={"type": "device", "ttl_hours": 24},
            )

        assert response.status_code == 400
        assert "Cannot block your own device" in response.json()["detail"]

    def test_block_ip_success(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("1.2.3.4", None)
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.block_ip") as mock_block_ip:
            mock_block_ip.return_value = {
                "ip": "1.2.3.4",
                "is_permanent": False,
                "expires_at": "2026-07-16T12:00:00+00:00",
                "block_count": 1,
                "repeat_offender": False,
                "already_active": False,
            }
            response = client.post(
                "/api/admin/security-logs/1/block",
                json={"type": "ip", "ttl_hours": 24},
            )

        assert response.status_code == 200
        assert response.json()["ip"] == "1.2.3.4"

    def test_invalid_type_400(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.post(
            "/api/admin/security-logs/1/block",
            json={"type": "bogus"},
        )
        assert response.status_code == 400

    def test_404_missing_log(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.post(
            "/api/admin/security-logs/99999/block",
            json={"type": "ip"},
        )
        assert response.status_code == 404


# =============================================================================
# POST /api/admin/security-logs/bulk-block-preview
# =============================================================================


class TestBulkBlockPreview:
    def test_groups_by_device_hash(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user

        rows_result = MagicMock()
        rows_result.fetchall.return_value = [
            (1, "1.2.3.4", "hash_a"),
            (2, "1.2.3.4", "hash_a"),
            (3, "5.6.7.8", "hash_b"),
            (4, "9.9.9.9", None),
        ]
        mock_db = MagicMock()
        mock_db.execute.return_value = rows_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.post(
            "/api/admin/security-logs/bulk-block-preview",
            json={"log_ids": [1, 2, 3, 4]},
        )

        assert response.status_code == 200
        data = response.json()
        groups = {g["device_token_hash"]: g["log_ids"] for g in data["device_groups"]}
        assert groups["hash_a"] == [1, 2]
        assert groups["hash_b"] == [3]
        assert data["ip_only_log_ids"] == [4]

    def test_empty_log_ids_400(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.post(
            "/api/admin/security-logs/bulk-block-preview",
            json={"log_ids": []},
        )
        assert response.status_code == 400


# =============================================================================
# POST /api/admin/security-logs/bulk-action (action=block_device)
# =============================================================================


class TestBulkActionBlockDevice:
    def test_block_device_success(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("abc123",)
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.block_device") as mock_block_device,
            patch("api.routes.admin.security.log_system_audit"),
        ):
            mock_block_device.return_value = {
                "device_token_hash": "abc123",
                "already_active": False,
                "is_permanent": False,
            }
            response = client.post(
                "/api/admin/security-logs/bulk-action",
                json={"log_ids": [1], "action": "block_device"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["device_token_hash"] == "abc123"

    def test_block_device_no_hash_error_in_results(self, client):
        app.dependency_overrides[get_system_admin] = mock_admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = (None,)
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.log_system_audit"):
            response = client.post(
                "/api/admin/security-logs/bulk-action",
                json={"log_ids": [1], "action": "block_device"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "error" in data["results"][0]
