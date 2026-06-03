"""
Task 3: Rate Limiting & Throttling — manual adversarial check

Objective: prove that the real protected auth flow, POST /api/auth/callback,
rejects a burst above the configured threshold from one client IP.

Adversarial Assertions:
  - Requests 1–5  → processed by the callback flow and fail for invalid PKCE data
  - Requests 6–10 → HTTP 429 (rate limiter MUST engage)
  - Every 429 response MUST include a Retry-After header

This live-stack test is intentionally excluded from CI because it depends on a
reachable backend, Redis, and auth callback plumbing. Set
RATE_LIMIT_TEST_BASE_URL if the backend is exposed somewhere other than
http://localhost:8000.
"""

import asyncio
import os

import httpx
import pytest

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Directly target the backend callback path protected by main.py middleware.
BASE_URL = os.environ.get("RATE_LIMIT_TEST_BASE_URL", "http://localhost:8000")
AUTH_CALLBACK_ENDPOINT = f"{BASE_URL.rstrip('/')}/api/auth/callback"

MOCK_IP = os.environ.get("RATE_LIMIT_TEST_IP", "192.168.1.1")

# Deliberately invalid PKCE callback data: the requests should reach the
# callback and fail token exchange unless/until the rate limiter blocks them.
PAYLOAD = {
    "code": "adversarial_fake_code",
    "code_verifier": "adversarial_fake_verifier",
    "redirect_uri": "http://localhost/callback",
}

BURST_SIZE = 10
RATE_LIMIT_THRESHOLD = 5  # First N requests are allowed through


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _fire_burst(client: httpx.AsyncClient) -> list[httpx.Response]:
    """Send BURST_SIZE rapid POST requests to the auth callback endpoint."""
    tasks = [
        client.post(
            AUTH_CALLBACK_ENDPOINT,
            json=PAYLOAD,
            headers={"X-Forwarded-For": MOCK_IP},
        )
        for _ in range(BURST_SIZE)
    ]
    return await asyncio.gather(*tasks)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
class TestRateLimiting:
    """Adversarial test suite for auth callback rate limiting."""

    @pytest.mark.asyncio
    async def test_burst_returns_429_after_threshold(self):
        """
        Fire 10 concurrent callback requests from a single IP.
        At most the first 5 may reach callback processing; the remainder MUST
        be rejected with HTTP 429.
        """
        async with httpx.AsyncClient() as client:
            responses = await _fire_burst(client)

        # Sort by arrival isn't perfectly deterministic with concurrency,
        # so we partition by status code instead.
        allowed = [r for r in responses if r.status_code != 429]
        throttled = [r for r in responses if r.status_code == 429]

        # --- Assertion 1: At most RATE_LIMIT_THRESHOLD requests go through
        assert len(allowed) <= RATE_LIMIT_THRESHOLD, (
            f"Expected at most {RATE_LIMIT_THRESHOLD} non-429 responses, "
            f"got {len(allowed)}.  The callback path is not rate-limited."
        )

        # --- Assertion 2: The remainder MUST be 429
        expected_throttled = BURST_SIZE - RATE_LIMIT_THRESHOLD
        assert len(throttled) >= expected_throttled, (
            f"Expected at least {expected_throttled} HTTP 429 responses, "
            f"got {len(throttled)}.  Rate limiting is absent."
        )

    @pytest.mark.asyncio
    async def test_429_contains_retry_after_header(self):
        """
        Every HTTP 429 response MUST include a Retry-After header
        so the client knows when to retry.
        """
        async with httpx.AsyncClient() as client:
            responses = await _fire_burst(client)

        throttled = [r for r in responses if r.status_code == 429]

        # If there are no 429s at all, the rate limiter is missing — fail hard.
        assert len(throttled) > 0, (
            "No HTTP 429 responses received.  The callback endpoint is completely "
            "unthrottled."
        )

        for i, resp in enumerate(throttled):
            assert "retry-after" in resp.headers, (
                f"429 response #{i + 1} is missing the Retry-After header.  "
                f"Headers present: {dict(resp.headers)}"
            )

            # Retry-After must be a positive integer (seconds)
            retry_val = resp.headers["retry-after"]
            assert retry_val.isdigit() and int(retry_val) > 0, (
                f"Retry-After header value '{retry_val}' is not a positive integer."
            )

    @pytest.mark.asyncio
    async def test_allowed_requests_fail_auth_flow_not_success(self):
        """
        Requests that slip under the rate limit use invalid PKCE data and MUST
        fail auth processing rather than creating a session.
        """
        async with httpx.AsyncClient() as client:
            responses = await _fire_burst(client)

        allowed = [r for r in responses if r.status_code != 429]

        assert len(allowed) > 0, (
            "Zero non-429 responses — cannot verify auth rejection behaviour."
        )

        for i, resp in enumerate(allowed):
            assert resp.status_code >= 400, (
                f"Non-throttled request #{i + 1} returned HTTP {resp.status_code}, "
                "expected auth callback failure for invalid PKCE data."
            )
