"""Tests for middleware/device_token.py — device_token_middleware +
device_block_middleware (Wayfinder — issue #567).

TDD: written against the real FastAPI app, mirroring the style of
test_blocked_ip_middleware.py — TestClient(app) with module-level Redis /
signing-key patches, rather than unit-testing the middleware functions in
isolation.
"""

import base64
import hashlib
import hmac as hmac_mod

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import main
import middleware.device_token as device_token_mod
from fastapi.testclient import TestClient
from main import app

SIGNING_KEY = "test-signing-key-do-not-use-in-prod"
# /health, /api/v1/public/health, /metrics are all exempt from device-token
# cookie logic per the acceptance criteria — use a route outside that list
# (and outside the public-prefix list) to exercise the "normal" middleware path.
# Starlette runs middleware before routing, so a nonexistent path still
# traverses both device middlewares before the router returns 404.
NONEXEMPT_PATH = "/__nonexistent_test_path__"


def _sign_token(body_b64: str, key: str = SIGNING_KEY) -> str:
    sig = hmac_mod.new(key.encode("utf-8"), body_b64.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).rstrip(b"=").decode("ascii")


def _make_valid_token(key: str = SIGNING_KEY) -> str:
    body_b64 = base64.urlsafe_b64encode(b"\x01" * 32).rstrip(b"=").decode("ascii")
    sig_b64 = _sign_token(body_b64, key)
    return f"v1.{body_b64}.{sig_b64}"


@pytest.fixture(autouse=True)
def _mock_startup_db():
    with patch.object(main, "_get_admin_session") as mock:
        mock.return_value = MagicMock()
        yield


@pytest.fixture(autouse=True)
def _reset_redis_singleton():
    main._redis = None
    device_token_mod._async_pool = None
    device_token_mod._last_warned.clear()
    yield


@pytest.fixture(autouse=True)
def _signing_key_env(monkeypatch):
    monkeypatch.setenv("DEVICE_TOKEN_SIGNING_KEY", SIGNING_KEY)
    monkeypatch.setenv("DEVICE_TOKEN_SIGNING_KEY_ACTIVE_VERSION", "1")
    yield


@pytest.fixture
def client():
    return TestClient(app)


def _mock_redis(exists_return: int = 0) -> MagicMock:
    r = MagicMock()
    r.exists = AsyncMock(return_value=exists_return)
    r.set = AsyncMock(return_value=True)
    r.hset = AsyncMock(return_value=1)
    r.expire = AsyncMock(return_value=True)
    return r


# ── device_token_middleware ──────────────────────────────────────────────────


class TestDeviceTokenMiddleware:
    def test_missing_cookie_issues_new_token_with_correct_cookie_attrs(self, client):
        """No cookie present → a signed token is issued with HttpOnly/Secure/
        SameSite=Lax/Path=/ and a 1-year Max-Age."""
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            resp = client.get(NONEXEMPT_PATH)
        set_cookie = resp.headers.get("set-cookie", "")
        assert "wims_device_token=" in set_cookie
        assert "httponly" in set_cookie.lower()
        assert "samesite=lax" in set_cookie.lower()
        assert "path=/" in set_cookie.lower()
        assert f"max-age={device_token_mod.DEVICE_TOKEN_MAX_AGE}" in set_cookie.lower()

    def test_valid_cookie_extracts_hash_no_new_cookie(self, client):
        """A valid signed cookie is verified; no Set-Cookie is issued."""
        raw_token = _make_valid_token()
        expected_hash = hashlib.sha256(raw_token.encode("ascii")).hexdigest()
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            resp = client.get(NONEXEMPT_PATH, cookies={"wims_device_token": raw_token})
        assert resp.status_code == 404  # route doesn't exist; middleware still ran
        assert resp.headers.get("x-device-token-hash") == expected_hash
        assert "set-cookie" not in {k.lower() for k in resp.headers.keys()}

    def test_missing_cookie_on_nonexempt_path_issues_and_sets_cookie(self, client):
        """No cookie on a non-exempt path → new token issued and cookie set."""
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            resp = client.get(NONEXEMPT_PATH)
        assert resp.status_code == 404
        assert "wims_device_token=" in resp.headers.get("set-cookie", "")
        assert resp.headers.get("x-device-token-hash")

    def test_corrupted_cookie_reissues_token(self, client):
        """A cookie with a bad signature is treated as absent and reissued."""
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            resp = client.get(NONEXEMPT_PATH, cookies={"wims_device_token": "v1.garbage.sig"})
        assert resp.status_code == 404
        assert "wims_device_token=" in resp.headers.get("set-cookie", "")

    def test_health_and_metrics_exempt_from_cookie_logic(self, client):
        """/health and /metrics are exempt — no device token cookie is ever set."""
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            health_resp = client.get("/health")
            metrics_resp = client.get("/metrics")
        assert health_resp.status_code == 200
        assert metrics_resp.status_code == 200
        assert "set-cookie" not in {k.lower() for k in health_resp.headers.keys()}
        assert "set-cookie" not in {k.lower() for k in metrics_resp.headers.keys()}

    def test_no_signing_key_fails_open_no_hash_no_cookie(self, client, monkeypatch):
        """Missing DEVICE_TOKEN_SIGNING_KEY → no hash, no cookie, request still succeeds."""
        monkeypatch.delenv("DEVICE_TOKEN_SIGNING_KEY", raising=False)
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            resp = client.get(NONEXEMPT_PATH)
        assert resp.status_code == 404
        assert "x-device-token-hash" not in {k.lower() for k in resp.headers.keys()}

    def test_redis_down_telemetry_write_fails_open(self, client):
        """Redis unavailable for telemetry write → request still succeeds (fail-open)."""
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            resp = client.get(NONEXEMPT_PATH)
        assert resp.status_code == 404

    def test_telemetry_written_with_ttl_300(self, client):
        """Telemetry is HSET under the IP-keyed hash, keyed by device hash,
        with the whole key's TTL refreshed to 300s."""
        mock_r = _mock_redis()
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=mock_r)):
            resp = client.get(NONEXEMPT_PATH, headers={"X-Real-IP": "5.5.5.5"})
        assert resp.status_code == 404
        mock_r.hset.assert_awaited_once()
        hset_args = mock_r.hset.await_args.args
        assert hset_args[0] == "device:telemetry:5.5.5.5"
        mock_r.expire.assert_awaited_once_with("device:telemetry:5.5.5.5", 300)

    def test_no_hash_skips_telemetry_write(self, client, monkeypatch):
        """No signing key → no hash → telemetry write is skipped entirely."""
        monkeypatch.delenv("DEVICE_TOKEN_SIGNING_KEY", raising=False)
        mock_r = _mock_redis()
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=mock_r)):
            resp = client.get(NONEXEMPT_PATH, headers={"X-Real-IP": "5.5.5.5"})
        assert resp.status_code == 404
        mock_r.hset.assert_not_awaited()

    def test_warn_once_per_minute_per_ip(self, client):
        """A corrupted cookie logs a warning at most once per minute per IP."""
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(device_token_mod.logger, "warning") as warn,
        ):
            client.get(
                NONEXEMPT_PATH,
                cookies={"wims_device_token": "v1.garbage.sig"},
                headers={"X-Real-IP": "8.8.8.8"},
            )
            client.get(
                NONEXEMPT_PATH,
                cookies={"wims_device_token": "v1.garbage.sig"},
                headers={"X-Real-IP": "8.8.8.8"},
            )
        corrupt_warnings = [c for c in warn.call_args_list if "Corrupt" in str(c)]
        assert len(corrupt_warnings) == 1


# ── device_block_middleware ──────────────────────────────────────────────────


class TestDeviceBlockMiddleware:
    def test_blocked_device_on_public_path_soft_flags_no_403(self, client):
        """A blocked device hitting a public-prefixed path is NOT hard-blocked
        (device_block_middleware runs ahead of routing, so a nonexistent route
        under a public prefix still proves the soft-flag path: the response is
        a 404 from routing, never the middleware's 403)."""
        raw_token = _make_valid_token()
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(
                device_token_mod, "is_device_blocked", new=AsyncMock(return_value=True)
            ) as blocked_check,
        ):
            resp = client.get(
                "/api/civilian/__no_such_route__",
                cookies={"wims_device_token": raw_token},
            )
        assert resp.status_code == 404
        blocked_check.assert_awaited_once()

    def test_blocked_device_on_authenticated_path_hard_403(self, client):
        """A blocked device hitting a non-public path gets a hard 403."""
        raw_token = _make_valid_token()
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(device_token_mod, "is_device_blocked", new=AsyncMock(return_value=True)),
        ):
            resp = client.get(NONEXEMPT_PATH, cookies={"wims_device_token": raw_token})
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Device blocked"}

    def test_unblocked_device_passes_through(self, client):
        raw_token = _make_valid_token()
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(device_token_mod, "is_device_blocked", new=AsyncMock(return_value=False)),
        ):
            resp = client.get(NONEXEMPT_PATH, cookies={"wims_device_token": raw_token})
        assert resp.status_code == 404  # passed device_block; 404 from routing, not 403

    def test_no_hash_falls_through_to_blocked_ip_middleware(self, client, monkeypatch):
        """No signing key → no device hash → device_block skips straight through."""
        monkeypatch.delenv("DEVICE_TOKEN_SIGNING_KEY", raising=False)
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(device_token_mod, "is_device_blocked", new=AsyncMock()) as blocked_check,
        ):
            resp = client.get(NONEXEMPT_PATH)
        assert resp.status_code == 404
        blocked_check.assert_not_called()
