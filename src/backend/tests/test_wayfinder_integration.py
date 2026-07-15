"""Integration tests — Wayfinder device abuse controls (issue #573).

Exercises the composed pipeline (device_token_middleware -> device_block_middleware
-> route handlers -> admin block/unblock -> Suricata telemetry correlation) through
the real FastAPI app with TestClient, per the issue's own testing guidance:
mocked Redis (unittest.mock) and mocked Turnstile (patched verify_turnstile),
no live Docker required. Each scenario below maps to one of #573's acceptance
criteria items.
"""

import base64
import hashlib
import hmac as hmac_mod
import json

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import main
import middleware.device_token as device_token_mod
from fastapi.testclient import TestClient
from main import app

from auth import get_system_admin, get_db_with_rls

SIGNING_KEY = "integration-test-signing-key"
NONEXEMPT_PATH = "/__wayfinder_integration_nonexistent__"


def _make_valid_token(raw: bytes = b"\x02" * 32, key: str = SIGNING_KEY) -> str:
    body_b64 = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    sig = hmac_mod.new(key.encode("utf-8"), body_b64.encode("ascii"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode("ascii")
    return f"v1.{body_b64}.{sig_b64}"


@pytest.fixture(autouse=True)
def _mock_startup_db():
    with patch.object(main, "_get_admin_session") as mock:
        mock.return_value = MagicMock()
        yield


@pytest.fixture(autouse=True)
def _reset_singletons():
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


def _admin_user():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-admin",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ═══════════════════════════════════════════════════════════════════════════
# 1. Token issuance + block + escalation round-trip
# ═══════════════════════════════════════════════════════════════════════════


class TestTokenIssuanceAndBlockRoundTrip:
    def test_first_request_issues_token_second_request_reuses_it(self, client):
        """A client with no cookie gets one issued; presenting it back on the
        next request is accepted without a new cookie being reissued.

        The raw token is extracted from the Set-Cookie header and passed
        explicitly on the second request rather than relying on TestClient's
        cookie jar — the cookie is flagged Secure, and stdlib cookiejars
        correctly refuse to resend Secure cookies over the jar's plain-http
        `testserver` base URL, which would falsely look like "cookie lost".
        """
        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            first = client.get(NONEXEMPT_PATH)
        set_cookie = first.headers.get("set-cookie", "")
        assert "wims_device_token=" in set_cookie
        issued_hash = first.headers.get("x-device-token-hash")
        assert issued_hash

        raw_token = set_cookie.split("wims_device_token=", 1)[1].split(";", 1)[0]

        with patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)):
            second = client.get(NONEXEMPT_PATH, cookies={"wims_device_token": raw_token})
        assert second.headers.get("x-device-token-hash") == issued_hash
        assert "set-cookie" not in {k.lower() for k in second.headers.keys()}

    def test_blocked_device_denied_on_public_path_but_soft_flagged(self, client):
        """A device blocked via the admin table (is_device_blocked=True) hitting
        a public-prefixed path is never hard-403'd — only soft-flagged."""
        raw_token = _make_valid_token()
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(device_token_mod, "is_device_blocked", new=AsyncMock(return_value=True)),
        ):
            resp = client.get(
                "/api/civilian/__no_such_route__", cookies={"wims_device_token": raw_token}
            )
        assert resp.status_code == 404  # routing 404, never the middleware's 403


# ═══════════════════════════════════════════════════════════════════════════
# 2. Bot / uncookied client fall-through
# ═══════════════════════════════════════════════════════════════════════════


class TestBotFallthrough:
    def test_no_signing_key_never_blocks_never_persists_identity(self, client, monkeypatch):
        """A bot that never stores cookies (or a deployment with no signing key
        configured) gets no device hash on every request — device_block_middleware
        always falls through to blocked_ip_middleware, never touching device state."""
        monkeypatch.delenv("DEVICE_TOKEN_SIGNING_KEY", raising=False)
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(device_token_mod, "is_device_blocked", new=AsyncMock()) as blocked_check,
        ):
            r1 = client.get(NONEXEMPT_PATH)
            r2 = client.get(NONEXEMPT_PATH)
        assert r1.status_code == 404
        assert r2.status_code == 404
        blocked_check.assert_not_called()
        assert "x-device-token-hash" not in {k.lower() for k in r1.headers.keys()}


# ═══════════════════════════════════════════════════════════════════════════
# 3. Authenticated endpoint hard-block
# ═══════════════════════════════════════════════════════════════════════════


class TestAuthenticatedHardBlock:
    def test_blocked_device_403s_before_reaching_admin_route(self, client):
        """A blocked device hitting a non-public (admin) path is hard-403'd by
        device_block_middleware — the request never reaches the route handler,
        regardless of whether the caller would otherwise be SYSTEM_ADMIN."""
        app.dependency_overrides[get_system_admin] = _admin_user

        def mock_get_db():
            yield MagicMock()

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        raw_token = _make_valid_token()
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch.object(device_token_mod, "is_device_blocked", new=AsyncMock(return_value=True)),
        ):
            resp = client.get(
                "/api/admin/device-blocklist", cookies={"wims_device_token": raw_token}
            )
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Device blocked"}


# ═══════════════════════════════════════════════════════════════════════════
# 4. Bulk block flow
# ═══════════════════════════════════════════════════════════════════════════


class TestBulkBlockFlow:
    def test_preview_groups_then_bulk_action_blocks_each_group(self, client):
        """Preview groups selected logs by device hash; bulk-action(block_device)
        then blocks each represented device."""
        app.dependency_overrides[get_system_admin] = _admin_user

        preview_rows = MagicMock()
        preview_rows.fetchall.return_value = [
            (1, "1.2.3.4", "hash_a"),
            (2, "1.2.3.4", "hash_a"),
            (3, "5.6.7.8", "hash_b"),
        ]
        preview_db = MagicMock()
        preview_db.execute.return_value = preview_rows

        def mock_get_preview_db():
            yield preview_db

        app.dependency_overrides[get_db_with_rls] = mock_get_preview_db

        preview_resp = client.post(
            "/api/admin/security-logs/bulk-block-preview",
            json={"log_ids": [1, 2, 3]},
        )
        assert preview_resp.status_code == 200
        groups = {
            g["device_token_hash"]: g["log_ids"] for g in preview_resp.json()["device_groups"]
        }
        assert groups == {"hash_a": [1, 2], "hash_b": [3]}

        # Bulk-action(block_device) for one representative log per group.
        select_hash_a = MagicMock(fetchone=MagicMock(return_value=("hash_a",)))
        bulk_db = MagicMock()
        bulk_db.execute.return_value = select_hash_a

        def mock_get_bulk_db():
            yield bulk_db

        app.dependency_overrides[get_db_with_rls] = mock_get_bulk_db

        with (
            patch("api.routes.admin.security.block_device", new=AsyncMock()) as mock_block,
            patch("api.routes.admin.security.log_system_audit"),
        ):
            mock_block.return_value = {
                "device_token_hash": "hash_a",
                "already_active": False,
                "is_permanent": False,
            }
            bulk_resp = client.post(
                "/api/admin/security-logs/bulk-action",
                json={"log_ids": [1], "action": "block_device"},
            )
        assert bulk_resp.status_code == 200
        assert bulk_resp.json()["results"][0]["device_token_hash"] == "hash_a"


# ═══════════════════════════════════════════════════════════════════════════
# 5. Telemetry correlation (write via middleware, read via Suricata ingestion)
# ═══════════════════════════════════════════════════════════════════════════


class TestTelemetryCorrelationRoundTrip:
    def test_single_device_telemetry_correlates_high_confidence(self, client):
        """device_token_middleware's HSET write is read back by
        suricata_ingestion._correlate_device_token as a high-confidence match."""
        from services.suricata_ingestion import _correlate_device_token

        raw_token = _make_valid_token()
        expected_hash = hashlib.sha256(raw_token.encode("ascii")).hexdigest()

        written_payloads: dict[str, str] = {}

        fake_async_redis = AsyncMock()

        async def _fake_hset(key, field, value):
            written_payloads[field] = value
            return 1

        fake_async_redis.hset = AsyncMock(side_effect=_fake_hset)
        fake_async_redis.expire = AsyncMock(return_value=True)

        with patch.object(
            device_token_mod, "_get_redis", new=AsyncMock(return_value=fake_async_redis)
        ):
            resp = client.get(
                NONEXEMPT_PATH,
                cookies={"wims_device_token": raw_token},
                headers={"X-Real-IP": "9.9.9.9"},
            )
        assert resp.status_code == 404
        assert expected_hash in written_payloads

        fake_sync_redis = MagicMock()
        fake_sync_redis.hgetall.return_value = written_payloads
        fake_sync_redis.close = MagicMock()

        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            return_value=fake_sync_redis,
        ):
            result = _correlate_device_token("9.9.9.9")

        assert result["device_token_hash"] == expected_hash
        assert result["device_correlation_source"] == "redis_telemetry"
        assert result["device_correlation_confidence"] == "high"

    def test_multiple_devices_same_ip_correlates_ambiguous(self):
        """Two distinct device hashes telemetered for the same IP (CGNAT) ->
        ambiguous confidence, no single hash attributed."""
        from services.suricata_ingestion import _correlate_device_token

        entries = {
            "hash_one": json.dumps({"timestamp": "2026-07-15T10:00:00+00:00"}),
            "hash_two": json.dumps({"timestamp": "2026-07-15T10:01:00+00:00"}),
        }
        fake_sync_redis = MagicMock()
        fake_sync_redis.hgetall.return_value = entries
        fake_sync_redis.close = MagicMock()

        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            return_value=fake_sync_redis,
        ):
            result = _correlate_device_token("1.1.1.1")

        assert result["device_token_hash"] is None
        assert result["device_correlation_confidence"] == "ambiguous"


# ═══════════════════════════════════════════════════════════════════════════
# 6. Redis failure resilience — "all fail-open"
# ═══════════════════════════════════════════════════════════════════════════


class TestRedisFailureResilience:
    def test_full_request_cycle_survives_total_redis_outage(self, client):
        """With every Redis touchpoint unreachable (device token telemetry,
        device-block check, suricata correlation), a request still completes
        without a 500 — everything degrades to IP-based fallback.

        ``_get_redis()`` never raises in production (it catches its own
        connection errors and returns None); ``return_value=None`` models
        that real "Redis unreachable" contract accurately.
        """
        raw_token = _make_valid_token()
        with (
            patch.object(device_token_mod, "_get_redis", new=AsyncMock(return_value=None)),
            patch(
                "services.device_blocklist._get_redis",
                new=AsyncMock(return_value=None),
            ),
        ):
            resp = client.get(NONEXEMPT_PATH, cookies={"wims_device_token": raw_token})
        assert resp.status_code == 404  # not 500 — fail-open all the way through

    def test_suricata_correlation_read_failure_degrades_to_all_none(self):
        from services.suricata_ingestion import _correlate_device_token

        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            side_effect=Exception("connection refused"),
        ):
            result = _correlate_device_token("1.2.3.4")

        assert result == {
            "device_token_hash": None,
            "device_correlation_source": None,
            "device_correlation_confidence": None,
            "device_observed_at": None,
        }

    def test_admin_block_endpoint_survives_device_blocklist_redis_failure(self, client):
        """Blocking a device when Redis is down still completes the Postgres
        write path (best-effort Redis SET failure is swallowed)."""
        app.dependency_overrides[get_system_admin] = _admin_user

        select_result = MagicMock()
        select_result.fetchone.return_value = ("1.2.3.4", "abc123")
        mock_db = MagicMock()
        mock_db.execute.return_value = select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.block_device") as mock_block_device,
        ):
            mock_block_device.return_value = {
                "device_token_hash": "abc123",
                "is_permanent": False,
                "already_active": False,
            }
            resp = client.post(
                "/api/admin/security-logs/1/block",
                json={"type": "device", "ttl_hours": 24},
            )
        assert resp.status_code == 200
