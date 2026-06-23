# ruff: noqa: E402
"""
WS2 — V16.5.3 Fail-closed Redis rate limit integration tests.

Run from project root:
  cd src && pytest backend/tests/integration/test_rate_limit_fail_closed.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure backend root is on path when running from src/
_backend_root = Path(__file__).resolve().parent.parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from main import app


@pytest.fixture(autouse=True)
def _set_env_defaults(monkeypatch):
    """Ensure deterministic env defaults for all tests in this module."""
    monkeypatch.delenv("RATE_LIMIT_FAIL_OPEN", raising=False)
    # Disable CSRF for test compatibility
    monkeypatch.setenv("WIMS_CSRF_DISABLED", "1")


@pytest.fixture
def client():
    """FastAPI TestClient with CSRF disabled."""
    return TestClient(app)


# ===========================================================================
# Test 1: Redis unavailable → fail closed with 503 + Retry-After
# ===========================================================================


def test_rate_limit_returns_503_when_redis_unavailable(client):
    """
    When _get_redis() returns None (Redis down), POST /api/auth/callback
    should return 503 with Retry-After: 30 and a generic error message.
    """
    with patch.object(sys.modules["main"], "_get_redis", return_value=None):
        response = client.post(
            "/api/auth/callback",
            json={"code": "test", "code_verifier": "test"},
        )

    assert response.status_code == 503, (
        f"Expected 503 when Redis is down, got {response.status_code}"
    )
    assert response.headers.get("retry-after") == "30", (
        f"Expected Retry-After: 30, got {response.headers.get('retry-after')}"
    )
    data = response.json()
    assert "detail" in data
    assert "Authentication service temporarily unavailable" in data["detail"], (
        f"Unexpected detail: {data['detail']}"
    )


# ===========================================================================
# Test 2: RATE_LIMIT_FAIL_OPEN=true → fail-open (pass through, dev only)
# ===========================================================================


def test_rate_limit_fail_open_with_env_var(monkeypatch):
    """
    When RATE_LIMIT_FAIL_OPEN=true and Redis is down, the middleware should
    pass through to the downstream handler (fail-open for dev scenarios).
    We verify by checking the response is NOT 503 — the middleware did not
    block. The handler itself may fail (no Keycloak reachable) but that's
    not the concern of this test.
    """
    monkeypatch.setenv("RATE_LIMIT_FAIL_OPEN", "true")

    # raise_server_exceptions=False so we see the response even if the
    # downstream handler throws httpx.ConnectError to Keycloak.
    client = TestClient(app, raise_server_exceptions=False)

    with patch.object(sys.modules["main"], "_get_redis", return_value=None):
        response = client.post(
            "/api/auth/callback",
            json={"code": "test", "code_verifier": "test"},
        )

    # When fail-open, the request must pass through the rate-limit middleware.
    # Even if the handler errors (no Keycloak), it should NOT return 503.
    assert response.status_code != 503, (
        "Expected fail-open (not 503) when RATE_LIMIT_FAIL_OPEN=true"
    )


# ===========================================================================
# Test 3: Non-auth-callback paths unaffected by rate limiter
# ===========================================================================


def test_rate_limit_other_paths_unaffected(client):
    """
    The rate-limit middleware only applies to POST /api/auth/callback.
    Other paths should pass through even when Redis is down.
    """
    with patch.object(sys.modules["main"], "_get_redis", return_value=None):
        response = client.post("/api/auth/consent", json={})

    # The consent endpoint has its own logic (may return 422 for missing body)
    # but should NOT return 503 from the rate-limit middleware.
    assert response.status_code != 503, "Non-auth-callback path should not trigger rate-limit 503"
