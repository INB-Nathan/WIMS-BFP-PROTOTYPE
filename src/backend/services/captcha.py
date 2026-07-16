"""Civilian Contributor — CAPTCHA / Turnstile verification.

Cloudflare Turnstile verification for anonymous submissions.
Required on initial report; risk-based re-challenge for later actions.

Env:
    TURNSTILE_SECRET_KEY — Turnstile server-side secret (required in production;
                           empty default for test convenience)
"""

from __future__ import annotations

import logging
import os

import httpx
from fastapi import HTTPException

logger = logging.getLogger("wims.captcha")

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

# Cloudflare error codes that mean OUR secret is wrong/missing, not that the
# client's token is bad. See https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
_SECRET_MISCONFIG_ERROR_CODES = frozenset({"missing-input-secret", "invalid-input-secret"})


async def verify_turnstile(token: str, remote_ip: str | None = None) -> bool:
    """Verify a Cloudflare Turnstile token server-side.

    POSTs to the siteverify endpoint. On a normal round-trip where Cloudflare
    accepts or rejects the token, returns ``True``/raises accordingly.

    Fail-open is deliberately narrow — it covers only genuine *service*
    unavailability (connection/timeout errors, or Cloudflare's own 5xx), per
    issue #570's acceptance criteria: an outage of a third-party CAPTCHA
    provider must not 403 every anonymous civilian submission. It does NOT
    cover a reachable endpoint returning an unparseable body or a 4xx — those
    indicate something is actually wrong (a tampered/garbled response, or a
    bug in our own request) rather than a simple outage, and fail CLOSED so a
    corrupted response can't silently bypass CAPTCHA.

    Misconfiguration (secret missing, or Cloudflare telling us the secret
    itself is invalid) is NOT treated as an outage either — it's a deploy-time
    error that should surface immediately as a 500, not be silently masked as
    a generic CAPTCHA rejection.

    Args:
        token:   The Turnstile client response token.
        remote_ip: Optional client IP for server-side verification.

    Returns:
        ``True`` when Cloudflare confirms the token, OR when the Turnstile
        service itself could not be reached / errored server-side (fail-open).

    Raises:
        HTTPException 500: ``TURNSTILE_SECRET_KEY`` env var is empty or unset,
            or Cloudflare reports our secret itself is invalid.
        HTTPException 429: Turnstile was reachable and rejected the token
            (or returned an unparseable body — treated as a rejection, not
            an outage).
    """
    secret = os.environ.get("TURNSTILE_SECRET_KEY", "")
    if not secret:
        logger.error("TURNSTILE_SECRET_KEY is not set — CAPTCHA service unavailable")
        raise HTTPException(
            status_code=500,
            detail="CAPTCHA service not configured",
        )

    data: dict[str, str] = {
        "secret": secret,
        "response": token,
    }
    if remote_ip:
        data["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=data)
    except httpx.RequestError as exc:
        # Connection refused, DNS failure, timeout (httpx.TimeoutException is
        # a RequestError subclass), etc. — the service itself is unreachable.
        # Fail OPEN.
        logger.warning("Turnstile service unreachable — failing open: %s", exc)
        return True

    if resp.status_code >= 500:
        # Cloudflare's own outage — fail OPEN, same rationale as above.
        logger.warning("Turnstile returned %s — failing open", resp.status_code)
        return True

    try:
        result = resp.json()
    except ValueError as exc:
        # Reachable (2xx/4xx) but the body isn't parseable JSON. Not an
        # outage — a tampered/garbled response from a reachable endpoint
        # must not silently bypass CAPTCHA. Fail CLOSED.
        logger.warning("Turnstile returned unparseable body — failing closed: %s", exc)
        raise HTTPException(status_code=429, detail="CAPTCHA verification failed") from exc

    if not result.get("success"):
        error_codes = result.get("error-codes", [])
        if _SECRET_MISCONFIG_ERROR_CODES.intersection(error_codes):
            # Cloudflare is telling us OUR secret is wrong, not that the
            # client's token is bad. Surface it distinctly as a 500 so it
            # doesn't get lost in normal token-rejection noise — this is an
            # ops problem, not client abuse.
            logger.error("Turnstile rejected our TURNSTILE_SECRET_KEY: %s", error_codes)
            raise HTTPException(status_code=500, detail="CAPTCHA service misconfigured")
        logger.warning("Turnstile verification failed: %s", error_codes)
        raise HTTPException(status_code=429, detail="CAPTCHA verification failed")

    return True
