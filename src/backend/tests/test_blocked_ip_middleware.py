"""Tests for BlockedIPMiddleware (main.py).

TDD red-first: write tests → run fail → implement → run pass.
Covers 5 scenarios: blocked IP 403, unblocked pass-through, Redis-down
fail-open, health exemption, X-Real-IP vs X-Forwarded-For priority.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import main
from fastapi.testclient import TestClient
from main import app


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _mock_startup_db():
    """Prevent the apply_schema_patches startup handler from connecting to DB.

    Without this, the sync startup handler raises on the first TestClient
    request because no Postgres container is available in bare-metal pytest.
    """
    with patch.object(main, "_get_admin_session") as mock:
        mock.return_value = MagicMock()
        yield


@pytest.fixture(autouse=True)
def _reset_redis_singleton():
    """Clear the module-level Redis singleton between tests."""
    main._redis = None
    yield


@pytest.fixture
def client():
    return TestClient(app)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _mock_redis(exists_return: int = 0) -> MagicMock:
    """Build a mock aioredis.Redis whose exists() returns a known value."""
    r = MagicMock()
    r.exists = AsyncMock(return_value=exists_return)
    return r


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestBlockedIPMiddleware:
    """5 tests covering the BlockedIPMiddleware behaviour."""

    def test_blocked_ip_returns_403(self, client):
        """Blocked IP (Redis EXISTS=1) gets a 403 JSON response."""
        mock_r = _mock_redis(exists_return=1)
        with patch.object(main, "_get_redis", new=AsyncMock(return_value=mock_r)):
            resp = client.get("/metrics", headers={"X-Real-IP": "1.2.3.4"})
        assert resp.status_code == 403
        assert resp.json() == {"detail": "IP blocked by admin action"}

    def test_unblocked_ip_passes_through(self, client):
        """Unblocked IP (Redis EXISTS=0) passes through to the route handler."""
        mock_r = _mock_redis(exists_return=0)
        with patch.object(main, "_get_redis", new=AsyncMock(return_value=mock_r)):
            resp = client.get("/metrics")
        assert resp.status_code == 200

    def test_redis_down_fails_open(self, client):
        """When _get_redis returns None the request passes through (fail-open)."""
        with patch.object(main, "_get_redis", new=AsyncMock(return_value=None)):
            resp = client.get("/metrics")
        assert resp.status_code == 200

    def test_health_exempt_when_blocked(self, client):
        """/health is exempt from the IP block check even if IP is blocked."""
        mock_r = _mock_redis(exists_return=1)
        with patch.object(main, "_get_redis", new=AsyncMock(return_value=mock_r)):
            resp = client.get("/health", headers={"X-Real-IP": "1.2.3.4"})
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_uses_xreal_ip_not_xff(self, client):
        """Block check uses X-Real-IP, NOT X-Forwarded-For leftmost."""
        mock_r = _mock_redis(exists_return=1)
        with patch.object(main, "_get_redis", new=AsyncMock(return_value=mock_r)):
            resp = client.get(
                "/metrics",
                headers={
                    "X-Real-IP": "1.2.3.4",
                    "X-Forwarded-For": "9.9.9.9, 5.5.5.5",
                },
            )
        assert resp.status_code == 403
        # Verify Redis EXISTS was called with the X-Real-IP value, not XFF
        mock_r.exists.assert_called_once_with("ip:block:1.2.3.4")
