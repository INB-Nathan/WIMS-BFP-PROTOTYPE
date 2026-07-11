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

    POSTs to the siteverify endpoint and returns ``True`` on success.
    On failure (invalid token, network error, misconfiguration) raises
    ``HTTPException`` so callers (route handlers) can let FastAPI's
    exception handler produce the response.

    Args:
        token:   The Turnstile client response token.
        remote_ip: Optional client IP for server-side verification.

    Returns:
        ``True`` when Cloudflare returns ``{"success": true}``.

    Raises:
        HTTPException 500: ``TURNSTILE_SECRET_KEY`` env var is empty or unset.
        HTTPException 429: Token verification failed or upstream unreachable.
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
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=data)
            resp.raise_for_status()
            result = resp.json()
    except Exception as exc:
        logger.warning("Turnstile request failed: %s", exc)
        raise HTTPException(status_code=429, detail="CAPTCHA verification failed") from exc

    if not result.get("success"):
        error_codes = result.get("error-codes", [])
        logger.warning("Turnstile verification failed: %s", error_codes)
        raise HTTPException(status_code=429, detail="CAPTCHA verification failed")

    return True
