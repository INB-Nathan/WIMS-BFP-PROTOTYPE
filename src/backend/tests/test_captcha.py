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
async def test_verify_turnstile_malformed_json_fails_closed():
    """Cloudflare reachable but returning a non-JSON body → fail CLOSED
    (429), not open. A tampered/garbled response from a reachable endpoint
    is not the same thing as the endpoint being unreachable, and must not
    silently bypass CAPTCHA."""
    respx.post(TURNSTILE_VERIFY_URL).respond(status_code=200, content="not json")

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("test-token")

    assert exc_info.value.status_code == 429


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_4xx_with_valid_body_still_processed():
    """A non-5xx status (e.g. 400) with a parseable success:false body is
    processed normally as a rejection — 4xx is not treated as an outage."""
    respx.post(TURNSTILE_VERIFY_URL).respond(
        status_code=400,
        json={"success": False, "error-codes": ["invalid-input-response"]},
    )

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("test-token")

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "CAPTCHA verification failed"


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_invalid_secret_raises_500_not_429():
    """Cloudflare telling us OUR secret is wrong is a deploy misconfiguration,
    not a client-side CAPTCHA rejection — must surface as 500, not the
    generic 429 an actual bad/expired token gets."""
    respx.post(TURNSTILE_VERIFY_URL).respond(
        status_code=200,
        json={"success": False, "error-codes": ["invalid-input-secret"]},
    )

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("test-token")

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "CAPTCHA service misconfigured"


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_missing_secret_error_code_raises_500():
    """Same as above for Cloudflare's "missing-input-secret" error code."""
    respx.post(TURNSTILE_VERIFY_URL).respond(
        status_code=200,
        json={"success": False, "error-codes": ["missing-input-secret"]},
    )

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("test-token")

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "CAPTCHA service misconfigured"


@respx.mock
@pytest.mark.asyncio
async def test_verify_turnstile_empty_token_still_reaches_cloudflare():
    """An empty-string token is sent through to Cloudflare like any other
    value (it isn't special-cased) and is rejected by Cloudflare's own
    validation, not by our code short-circuiting it."""
    respx.post(TURNSTILE_VERIFY_URL).respond(
        status_code=200,
        json={"success": False, "error-codes": ["missing-input-response"]},
    )

    with pytest.raises(HTTPException) as exc_info:
        await verify_turnstile("")

    assert exc_info.value.status_code == 429
