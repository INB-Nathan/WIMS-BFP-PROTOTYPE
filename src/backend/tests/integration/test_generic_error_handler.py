# ruff: noqa: E402
"""
WS3 — V16.5.1 Generic error handler integration tests.

Run from project root:
  cd src && pytest backend/tests/integration/test_generic_error_handler.py -v
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

from main import app


# ===========================================================================
# Test 1: Debug route — unhandled RuntimeError returns generic 500
# ===========================================================================


def test_unhandled_exception_returns_generic_500():
    """
    When DEBUG_ROUTES_ENABLED=true and we hit /api/__test_raise_500,
    the RuntimeError should be caught by the global exception_handler
    and return a generic 500 response WITHOUT leaking the original message.
    """
    import main as main_module

    main_module.DEBUG_ROUTES_ENABLED = True

    # raise_server_exceptions=False receives the 500 response from
    # ServerErrorMiddleware instead of the re-raised exception (Starlette
    # always re-raises after the handler runs, for production logging).
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/api/__test_raise_500")

    assert response.status_code == 500
    data = response.json()
    assert "detail" in data
    assert data["detail"] == "An unexpected error occurred. Please try again later.", (
        f"Expected generic detail, got: {data['detail']}"
    )
    # Ensure the original exception message is NOT leaked
    assert "internal database password" not in data["detail"], (
        "Response leaks internal error details!"
    )


# ===========================================================================
# Test 2: The global exception handler does NOT override HTTPException (4xx)
# ===========================================================================


def test_http_exception_4xx_keeps_original_detail():
    """
    FastAPI's built-in HTTPException handler must still return the original
    detail for 4xx errors (401, 403, 404, 422). The global handler should
    only catch *unhandled* exceptions.
    """
    client = TestClient(app)
    # A 404 response from a non-existent route should still return the
    # FastAPI default 404 detail, not "An unexpected error occurred."
    response = client.get("/api/nonexistent-route-xyz-123")
    assert response.status_code == 404
    data = response.json()
    assert "detail" in data
    assert data["detail"] != "An unexpected error occurred. Please try again later.", (
        "Global handler appears to be catching HTTPException!"
    )


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture(autouse=True)
def _env_defaults(monkeypatch):
    """Disable CSRF for test compatibility."""
    monkeypatch.setenv("WIMS_CSRF_DISABLED", "1")
    # Ensure debug routes are disabled by default
    import main as main_module

    main_module.DEBUG_ROUTES_ENABLED = False
