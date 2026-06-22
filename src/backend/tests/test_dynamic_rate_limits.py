"""
Task: Dynamic Rate Limit Configuration — #47.

Red State: GET/PATCH /api/admin/rate-limits endpoints do not exist.
Green State: GET returns current config, PATCH updates it.
Config is stored in Redis hash key rate_limit_config:{tier}.
The legacy tier label is "login" for API compatibility; it represents the
current auth callback rate-limit policy.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

import auth
import main as main_module
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

    def _patch_rejects(self, client, body, expected_status=422):
        """Helper: PATCH rate-limits with admin + mocked DB, expect rejection."""
        app.dependency_overrides[auth.get_current_wims_user] = admin_override
        app.dependency_overrides[get_db_with_rls] = lambda: MagicMock()
        response = client.patch("/api/admin/rate-limits", json=body)
        assert response.status_code == expected_status

    def test_patch_rate_limits_rejects_zero_limit(self, client):
        self._patch_rejects(client, {"tier": "login", "limit": 0, "window": 600})

    def test_patch_rate_limits_rejects_zero_window(self, client):
        self._patch_rejects(client, {"tier": "login", "limit": 5, "window": 0})

    def test_patch_rate_limits_rejects_negative_limit(self, client):
        self._patch_rejects(client, {"tier": "login", "limit": -1, "window": 600})

    def test_patch_rate_limits_rejects_unknown_tier(self, client):
        self._patch_rejects(client, {"tier": "unknown_tier", "limit": 5, "window": 900})

    def test_patch_rate_limits_requires_admin(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = encoder_override
        app.dependency_overrides[get_db_with_rls] = lambda: MagicMock()

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


# ---------------------------------------------------------------------------
# Rate-limit middleware config consumption tests (#354/#363 B1 fix)
# ---------------------------------------------------------------------------
class TestRateLimitMiddlewareConfig:
    """Verify POST /api/auth/callback middleware reads rate_limit_config:login."""

    @staticmethod
    def _make_async_redis_mock(hgetall_return=None, eval_return=None):
        mock = MagicMock()
        mock.hgetall = AsyncMock(return_value=hgetall_return if hgetall_return is not None else {})
        mock.eval = AsyncMock(return_value=eval_return if eval_return is not None else [1, 30])
        return mock

    @pytest.fixture
    def client(self):
        return TestClient(app)

    @pytest.fixture(autouse=True)
    def _reset_overrides(self):
        yield
        app.dependency_overrides.clear()

    # -- config consumed ---------------------------------------------------

    def test_middleware_uses_configured_window_and_threshold(self, client):
        """Valid config → eval receives configured window_seconds / threshold."""
        mock_redis = self._make_async_redis_mock(
            hgetall_return={"window_seconds": "300", "threshold": "3"},
        )

        with patch.object(main_module, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
            mock_get_redis.return_value = mock_redis
            client.post(
                "/api/auth/callback",
                json={"code": "test", "code_verifier": "test"},
                headers={"X-Forwarded-For": "10.0.0.1"},
            )

        mock_redis.hgetall.assert_called_once_with("rate_limit_config:login")
        eval_args = mock_redis.eval.call_args
        assert eval_args[0][4] == "300", f"Expected window=300, got {eval_args[0][4]}"
        assert eval_args[0][5] == "3", f"Expected threshold=3, got {eval_args[0][5]}"

    # -- fallback: missing config -----------------------------------------

    def test_middleware_falls_back_when_config_empty(self, client):
        """Empty config hash → eval receives hardcoded defaults (900/5)."""
        mock_redis = self._make_async_redis_mock(hgetall_return={})

        with patch.object(main_module, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
            mock_get_redis.return_value = mock_redis
            client.post(
                "/api/auth/callback",
                json={"code": "test", "code_verifier": "test"},
                headers={"X-Forwarded-For": "10.0.0.1"},
            )

        eval_args = mock_redis.eval.call_args
        assert eval_args[0][4] == "900", f"Expected default window=900, got {eval_args[0][4]}"
        assert eval_args[0][5] == "5", f"Expected default threshold=5, got {eval_args[0][5]}"

    # -- fallback: non-numeric config -------------------------------------

    def test_middleware_falls_back_on_non_numeric_config(self, client):
        """Non-numeric values → eval receives defaults."""
        mock_redis = self._make_async_redis_mock(
            hgetall_return={"window_seconds": "abc", "threshold": "xyz"},
        )

        with patch.object(main_module, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
            mock_get_redis.return_value = mock_redis
            client.post(
                "/api/auth/callback",
                json={"code": "test", "code_verifier": "test"},
                headers={"X-Forwarded-For": "10.0.0.1"},
            )

        eval_args = mock_redis.eval.call_args
        assert eval_args[0][4] == "900"
        assert eval_args[0][5] == "5"

    # -- fallback: non-positive config ------------------------------------

    def test_middleware_falls_back_on_nonpositive_config(self, client):
        """Zero or negative values → eval receives defaults."""
        mock_redis = self._make_async_redis_mock(
            hgetall_return={"window_seconds": "0", "threshold": "-1"},
        )

        with patch.object(main_module, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
            mock_get_redis.return_value = mock_redis
            client.post(
                "/api/auth/callback",
                json={"code": "test", "code_verifier": "test"},
                headers={"X-Forwarded-For": "10.0.0.1"},
            )

        eval_args = mock_redis.eval.call_args
        assert eval_args[0][4] == "900"
        assert eval_args[0][5] == "5"

    # -- 429 behaviour ----------------------------------------------------

    def test_middleware_returns_429_with_retry_after(self, client):
        """When eval returns blocked, middleware returns 429 + Retry-After."""
        mock_redis = self._make_async_redis_mock(
            hgetall_return={"window_seconds": "60", "threshold": "2"},
            eval_return=[1, 45],
        )

        with patch.object(main_module, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
            mock_get_redis.return_value = mock_redis
            response = client.post(
                "/api/auth/callback",
                json={"code": "test", "code_verifier": "test"},
                headers={"X-Forwarded-For": "10.0.0.1"},
            )

        assert response.status_code == 429
        assert response.headers.get("Retry-After") == "45"

    def test_middleware_keys_on_x_real_ip_not_xff(self, client):
        """Spoofed X-Forwarded-For must NOT change the rate-limit key.
        The key must use X-Real-IP (set by nginx to $realip_remote_addr)."""
        mock_redis = self._make_async_redis_mock(
            hgetall_return={"window_seconds": "300", "threshold": "3"},
        )

        with patch.object(main_module, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
            mock_get_redis.return_value = mock_redis
            client.post(
                "/api/auth/callback",
                json={"code": "test", "code_verifier": "test"},
                headers={
                    "X-Forwarded-For": "1.2.3.4",  # spoofed — must NOT be used
                    "X-Real-IP": "5.6.7.8",  # trustworthy — MUST be used
                },
            )

        eval_args = mock_redis.eval.call_args
        # eval_args[0] = (script, numkeys=1, key, now_ts, window, threshold)
        key = eval_args[0][2]  # KEYS[1] (the rate-limit key) is the 3rd positional arg
        assert "5.6.7.8" in key, f"Rate-limit key must use X-Real-IP (5.6.7.8), got: {key}"
        assert "1.2.3.4" not in key, (
            f"Rate-limit key must NOT use spoofed XFF (1.2.3.4), got: {key}"
        )
