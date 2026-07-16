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


async def verify_turnstile(token: str, remote_ip: str | None = None) -> bool:
    """Verify a Cloudflare Turnstile token server-side.

    POSTs to the siteverify endpoint. On a normal round-trip where Cloudflare
    accepts or rejects the token, returns ``True``/raises accordingly. If the
    Turnstile *service itself* is unreachable (timeout, network error, non-2xx
    response, malformed body), fails OPEN — logs a warning and returns
    ``True`` — per issue #570's acceptance criteria. An outage of a third-party
    CAPTCHA provider must not 403 every anonymous civilian submission; that is
    a materially worse outcome than occasionally admitting an unverified one.
    Misconfiguration (missing secret) is NOT treated as an outage — it's a
    deploy-time error that should surface immediately, not be silently masked.

    Args:
        token:   The Turnstile client response token.
        remote_ip: Optional client IP for server-side verification.

    Returns:
        ``True`` when Cloudflare confirms the token, OR when the Turnstile
        service itself could not be reached (fail-open).

    Raises:
        HTTPException 500: ``TURNSTILE_SECRET_KEY`` env var is empty or unset.
        HTTPException 429: Turnstile was reachable and rejected the token.
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
            resp.raise_for_status()
            result = resp.json()
    except Exception as exc:
        logger.warning("Turnstile service unreachable — failing open: %s", exc)
        return True

    if not result.get("success"):
        error_codes = result.get("error-codes", [])
        logger.warning("Turnstile verification failed: %s", error_codes)
        raise HTTPException(status_code=429, detail="CAPTCHA verification failed")

    return True
