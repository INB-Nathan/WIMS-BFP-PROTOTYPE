"""Unit tests for services/captcha.py — Turnstile verification.

Tests the ``verify_turnstile`` function in isolation using ``respx`` to
mock the Cloudflare siteverify HTTP endpoint.

Run:
    cd src/backend && pytest tests/test_captcha.py -v --tb=short
"""

from __future__ import annotations

import httpx
import pytest
import respx
from fastapi import HTTPException

from services.captcha import TURNSTILE_VERIFY_URL, verify_turnstile


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _set_secret_key(monkeypatch):
    """Provide TURNSTILE_SECRET_KEY for every test by default.

    Individual tests that need to test the missing-key path override or
    delete it via their own monkeypatch call.
    """
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "1x00000000000000000000000000000000AA")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_success():
    """Cloudflare returns ``{"success": true}`` → function returns ``True``."""
    route = respx.post(TURNSTILE_VERIFY_URL).respond(
        status_code=200,
        json={"success": True},
    )

    result = await verify_turnstile("test-token")

    assert result is True
    assert route.called, "respx route was not called"
    # Verify the POST body contains expected fields
    body = route.calls[0].request.content.decode()
    assert "secret=1x00000000000000000000000000000000AA" in body
    assert "response=test-token" in body


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_failure_raises_429():
    """Cloudflare returns ``{"success": false}`` → HTTPException(429)."""
    respx.post(TURNSTILE_VERIFY_URL).respond(
        status_code=200,
        json={"success": False, "error-codes": ["invalid-input-response"]},
    )

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("invalid-token")

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "CAPTCHA verification failed"


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_sends_remote_ip():
    """When ``remote_ip`` is provided it is included in the verification body."""
    route = respx.post(TURNSTILE_VERIFY_URL).respond(
        status_code=200,
        json={"success": True},
    )

    await verify_turnstile("test-token", remote_ip="203.0.113.42")

    assert route.called
    body = route.calls[0].request.content.decode()
    assert "remoteip=203.0.113.42" in body


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_missing_env_var(monkeypatch):
    """Missing ``TURNSTILE_SECRET_KEY`` → HTTPException(500)."""
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("test-token")

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "CAPTCHA service not configured"


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_empty_env_var(monkeypatch):
    """Empty ``TURNSTILE_SECRET_KEY`` → HTTPException(500)."""
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "")

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("test-token")

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "CAPTCHA service not configured"


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_network_error_fails_open():
    """Network/connection error reaching Cloudflare → fail OPEN (issue #570:
    an outage of the CAPTCHA provider must not reject every anonymous
    submission), not HTTPException."""
    respx.post(TURNSTILE_VERIFY_URL).mock(
        side_effect=httpx.RequestError("Connection failed"),
    )

    result = await verify_turnstile("test-token")

    assert result is True


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_timeout_fails_open():
    """Timeout reaching Cloudflare → fail OPEN, same as any other network error."""
    respx.post(TURNSTILE_VERIFY_URL).mock(
        side_effect=httpx.TimeoutException("Request timed out"),
    )

    result = await verify_turnstile("test-token")

    assert result is True


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_upstream_5xx_fails_open():
    """Cloudflare itself erroring (5xx) → fail OPEN, not a 429 rejection."""
    respx.post(TURNSTILE_VERIFY_URL).respond(status_code=503)

    result = await verify_turnstile("test-token")

    assert result is True


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_malformed_json_fails_open():
    """Cloudflare returning a non-JSON body → fail OPEN, not a crash."""
    respx.post(TURNSTILE_VERIFY_URL).respond(status_code=200, content="not json")

    result = await verify_turnstile("test-token")

    assert result is True
