"""
Task 3: Rate Limiting & Throttling — RED STATE

Objective: Prove that /api/auth/login is vulnerable to a 10-request burst
from a single client IP with ZERO throttling.

Adversarial Assertions:
  - Requests 1–5  → HTTP 401 (invalid credentials, no rate limit)
  - Requests 6–10 → HTTP 429 (rate limiter MUST engage)
  - Every 429 response MUST include a Retry-After header

Since no rate limiter exists, this test MUST FAIL.
"""

import asyncio

import httpx
import pytest

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# The Next.js dev server runs on port 3000 by default.
# Adjust BASE_URL if the app is served elsewhere.
BASE_URL = "http://localhost:3000"
LOGIN_ENDPOINT = f"{BASE_URL}/api/auth/login"

MOCK_IP = "192.168.1.1"

# Deliberately invalid credentials — we don't need a valid session,
# we need the server to accept but reject the auth attempt.
PAYLOAD = {
    "username": "adversarial_tester@bfp.gov.ph",
    "password": "TotallyWrongPassword!42",
}

BURST_SIZE = 10
RATE_LIMIT_THRESHOLD = 5  # First N requests are allowed through


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _fire_burst(client: httpx.AsyncClient) -> list[httpx.Response]:
    """Send BURST_SIZE rapid POST requests to the login endpoint."""
    tasks = [
        client.post(
            LOGIN_ENDPOINT,
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
    """Adversarial test suite for login endpoint rate limiting."""

    @pytest.mark.asyncio
    async def test_burst_returns_429_after_threshold(self):
        """
        Fire 10 concurrent requests from a single IP.
        The first 5 MUST be processed normally (401 for bad creds).
        Requests 6–10 MUST be rejected with HTTP 429.
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
            f"got {len(allowed)}.  The endpoint has NO rate limiter."
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
            "No HTTP 429 responses received.  The endpoint is completely unthrottled."
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
    async def test_allowed_requests_return_401(self):
        """
        Requests that slip under the rate limit with invalid credentials
        MUST return HTTP 401 Unauthorized — not 200, not 500.
        """
        async with httpx.AsyncClient() as client:
            responses = await _fire_burst(client)

        allowed = [r for r in responses if r.status_code != 429]

        assert len(allowed) > 0, (
            "Zero non-429 responses — cannot verify auth rejection behaviour."
        )

        for i, resp in enumerate(allowed):
            assert resp.status_code == 401, (
                f"Non-throttled request #{i + 1} returned HTTP {resp.status_code}, "
                f"expected 401 Unauthorized."
            )
