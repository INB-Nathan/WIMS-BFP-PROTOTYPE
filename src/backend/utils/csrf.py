"""
CSRF protection middleware — validates Origin/Referer on state-changing requests.

Allows same-origin requests through ONLY when the Origin or Referer header
matches a configured trusted origin. GET/HEAD/OPTIONS are exempt (safe methods
per RFC 7231).

Usage:
    from utils.csrf import csrf_middleware
    app.middleware("http")(csrf_middleware)

NOTE: This is a plain @app.middleware("http") function, NOT a BaseHTTPMiddleware
class. BaseHTTPMiddleware buffers streaming responses (SSE at /api/events/stream),
so this signature preserves real-time push.
"""

import logging
import os
from urllib.parse import urlparse

from starlette.responses import JSONResponse

logger = logging.getLogger("wims.csrf")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

# Zero-trust public DMZ paths are unauthenticated/no-cookie by design;
# CSRF Origin/Referer validation is not meaningful for these routes.
_CSRF_EXEMPT_PATH_PREFIXES: tuple[str, ...] = ("/api/v1/public/",)

DEFAULT_ORIGINS: set[str] = {
    "http://localhost",
    "https://localhost",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://localhost:8000",
}


def _normalize_origin(raw: str) -> str:
    """Extract scheme + netloc, lowercased, with default ports stripped.

    Default ports (:443 for https, :80 for http) are removed so that
    https://example.com:443 matches https://example.com in the allowlist.
    Non-default ports (:3000, :8000, :8443) are preserved.
    """
    parsed = urlparse(raw)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    if scheme == "https" and netloc.endswith(":443"):
        netloc = netloc[:-4]
    elif scheme == "http" and netloc.endswith(":80"):
        netloc = netloc[:-3]
    return f"{scheme}://{netloc}"


def _build_allowlist() -> set[str]:
    """Build trusted origin set from CSRF_TRUSTED_ORIGINS env var, falling back to defaults."""
    env = os.environ.get("CSRF_TRUSTED_ORIGINS", "")
    if env:
        origins = {_normalize_origin(o.strip()) for o in env.split(",") if o.strip()}
        if origins:
            return origins
    return DEFAULT_ORIGINS


_allowed_origins: set[str] | None = None


def _get_allowlist() -> set[str]:
    global _allowed_origins
    if _allowed_origins is None:
        _allowed_origins = _build_allowlist()
    return _allowed_origins


async def csrf_middleware(request, call_next):
    """FastAPI middleware that rejects state-changing requests with untrusted Origin/Referer.

    Disable at runtime by setting WIMS_CSRF_DISABLED=1 in the environment
    (used during unit tests that do not set Origin/Referer).

    NOTE: Plain async function — NOT a BaseHTTPMiddleware class — so it does not
    buffer StreamingResponse bodies (preserves SSE at /api/events/stream).
    """
    if os.environ.get("WIMS_CSRF_DISABLED") == "1":
        return await call_next(request)

    if request.method in SAFE_METHODS:
        return await call_next(request)

    # Unauthenticated zero-trust public DMZ endpoints are exempt from CSRF
    # (no cookie-auth dependency; protected by rate limiting + Pydantic validation).
    if request.url.path.startswith(_CSRF_EXEMPT_PATH_PREFIXES):
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
