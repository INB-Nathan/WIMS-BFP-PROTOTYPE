"""
Task: Dynamic Rate Limit Configuration — #47.

Red State: GET/PATCH /api/admin/rate-limits endpoints do not exist.
Green State: GET returns current config, PATCH updates it.
Config is stored in Redis hash key rate_limit_config:{tier}.
The legacy tier label is "login" for API compatibility; it represents the
current auth callback rate-limit policy.
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

import auth
from main import app
from auth import get_db_with_rls


_ADMIN_UID = "44444444-4444-4444-8444-444444444444"


def admin_override():
    return {
        "user_id": _ADMIN_UID,
        "keycloak_id": "kid",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
        "assigned_region_id": None,
    }


def encoder_override():
    return {
        "user_id": "22222222-2222-2222-8222-222222222222",
        "keycloak_id": "kid2",
        "username": "encoder",
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": 1,
    }


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


class TestGetRateLimits:
    def test_get_rate_limits_returns_current_config(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override

        mock_redis = MagicMock()
        mock_redis.hgetall.return_value = {
            "window_seconds": "600",
            "threshold": "10",
            "updated_at": "1746432000.0",
        }

        with patch("api.routes.admin.rate_limits.redis.from_url", return_value=mock_redis):
            response = client.get("/api/admin/rate-limits")

        assert response.status_code == 200
        data = response.json()
        assert data["tier"] == "login"
        assert data["login_window_seconds"] == 600
        assert data["login_threshold"] == 10
        assert data["updated_at"] == "1746432000.0"

    def test_get_rate_limits_returns_defaults_when_redis_has_no_config(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override

        mock_redis = MagicMock()
        mock_redis.hgetall.return_value = {}

        with patch("api.routes.admin.rate_limits.redis.from_url", return_value=mock_redis):
            response = client.get("/api/admin/rate-limits")

        assert response.status_code == 200
        data = response.json()
        assert data["tier"] == "login"
        assert data["login_window_seconds"] == 900
        assert data["login_threshold"] == 5

    def test_get_rate_limits_requires_admin(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = encoder_override

        with patch("api.routes.admin.rate_limits.redis.from_url", return_value=MagicMock()):
            response = client.get("/api/admin/rate-limits")

        assert response.status_code == 403


class TestPatchRateLimits:
    def test_patch_rate_limits_updates_redis(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override
        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = MagicMock()

        with (
            patch("api.routes.admin.rate_limits.redis.from_url", return_value=mock_redis),
            patch("api.routes.admin.rate_limits.log_system_audit"),
        ):
            response = client.patch(
                "/api/admin/rate-limits",
                json={"tier": "login", "limit": 10, "window": 600},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["tier"] == "login"
        assert data["login_window_seconds"] == 600
        assert data["login_threshold"] == 10
        assert "updated_at" in data

        mock_redis.hset.assert_called_once()
        call_kwargs = mock_redis.hset.call_args
        assert call_kwargs[0][0] == "rate_limit_config:login"

    def test_patch_rate_limits_rejects_zero_limit(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override

        response = client.patch(
            "/api/admin/rate-limits",
            json={"tier": "login", "limit": 0, "window": 600},
        )
        assert response.status_code == 422

    def test_patch_rate_limits_rejects_zero_window(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override

        response = client.patch(
            "/api/admin/rate-limits",
            json={"tier": "login", "limit": 5, "window": 0},
        )
        assert response.status_code == 422

    def test_patch_rate_limits_rejects_negative_limit(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override

        response = client.patch(
            "/api/admin/rate-limits",
            json={"tier": "login", "limit": -1, "window": 600},
        )
        assert response.status_code == 422

    def test_patch_rate_limits_rejects_unknown_tier(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override

        response = client.patch(
            "/api/admin/rate-limits",
            json={"tier": "unknown_tier", "limit": 5, "window": 900},
        )
        assert response.status_code == 422

    def test_patch_rate_limits_requires_admin(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = encoder_override

        response = client.patch(
            "/api/admin/rate-limits",
            json={"tier": "login", "limit": 10, "window": 600},
        )
        assert response.status_code == 403

    def test_patch_rate_limits_writes_audit_log(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = admin_override
        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = MagicMock()

        with (
            patch("api.routes.admin.rate_limits.redis.from_url", return_value=mock_redis),
            patch("api.routes.admin.rate_limits.log_system_audit") as mock_audit,
        ):
            response = client.patch(
                "/api/admin/rate-limits",
                json={"tier": "login", "limit": 10, "window": 600},
            )

        assert response.status_code == 200
        mock_audit.assert_called_once()
        call_kwargs = mock_audit.call_args
        assert "RATE_LIMIT_UPDATED" in str(call_kwargs)
