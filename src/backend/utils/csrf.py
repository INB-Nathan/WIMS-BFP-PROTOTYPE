"""
CSRF protection middleware — validates Origin/Referer on state-changing requests.

Allows same-origin requests through ONLY when the Origin or Referer header
matches a configured trusted origin. GET/HEAD/OPTIONS are exempt (safe methods
per RFC 7231).

Usage:
    from utils.csrf import CSRFMiddleware
    app.add_middleware(CSRFMiddleware)
"""

import logging
import os
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger("wims.csrf")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

DEFAULT_ORIGINS: set[str] = {
    "http://localhost",
    "https://localhost",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://localhost:8000",
}


def _normalize_origin(raw: str) -> str:
    """Extract scheme + netloc from a URL, stripping path/query/fragment."""
    parsed = urlparse(raw)
    return f"{parsed.scheme}://{parsed.netloc}"


def _build_allowlist() -> set[str]:
    """Build trusted origin set from environment, falling back to defaults."""
    env = os.environ.get("CSRF_TRUSTED_ORIGINS", "")
    if env:
        origins = {_normalize_origin(o.strip()) for o in env.split(",") if o.strip()}
        if origins:
            return origins

    trusted_host = os.environ.get("CSRF_TRUSTED_HOST", "")
    if trusted_host:
        # Strip any accidental scheme prefix — CSRF_TRUSTED_HOST should be bare hostname
        stripped = _normalize_origin(trusted_host) if "://" in trusted_host else trusted_host
        # Also strip port and path from the normalized value
        if "://" in stripped:
            stripped = stripped.split("://", 1)[1]
        origins: set[str] = set()
        for scheme in ("https", "http"):
            origins.add(f"{scheme}://{stripped}")
        return origins | DEFAULT_ORIGINS

    return DEFAULT_ORIGINS


_allowed_origins: set[str] | None = None


def _get_allowlist() -> set[str]:
    global _allowed_origins
    if _allowed_origins is None:
        _allowed_origins = _build_allowlist()
    return _allowed_origins


class CSRFMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware that rejects state-changing requests with untrusted Origin/Referer.

    Disable at runtime by setting WIMS_CSRF_DISABLED=1 in the environment
    (used during unit tests that do not set Origin/Referer).
    """

    async def dispatch(self, request, call_next):
        if os.environ.get("WIMS_CSRF_DISABLED") == "1":
            return await call_next(request)

        if request.method in SAFE_METHODS:
            return await call_next(request)

        origin = request.headers.get("origin")
        referer = request.headers.get("referer")

        source = origin or referer
        if not source:
            logger.warning(
                "CSRF blocked — missing origin header | method=%s path=%s",
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF validation failed: missing origin header"},
            )

        allowlist = _get_allowlist()
        normalized = _normalize_origin(source)

        if normalized not in allowlist:
            logger.warning(
                "CSRF blocked — untrusted origin | origin=%s normalized=%s method=%s path=%s",
                source,
                normalized,
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF validation failed: untrusted origin"},
            )

        return await call_next(request)
