"""Tests for the public geocode proxy routes (/api/geocode/reverse, /api/geocode/search).

These tests verify that resilient-client failures are mapped to the correct HTTP
status codes and that request validation rejects missing parameters. No Docker
or live Nominatim required — the shared ExternalServiceClient is mocked.

NOTE (documented finding): geocode.py's try/except only catches
CircuitBreakerOpenError, ConcurrencyLimitError, ResponseSizeExceededError, and
ExternalServiceError. A 200 response whose body is invalid/non-JSON makes
resp.json() raise json.JSONDecodeError, which is NOT caught -> raw 500. The
scout hypothesized a 502 mapping; actual behavior is an uncaught 500. This is
tested as-is and left as a deferred contract gap (no production change in scope).

Run: cd src && python -m pytest backend/tests/test_geocode_routes.py -v
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from api.routes import geocode as geocode_module
from utils.external_service import (
    CircuitBreakerOpenError,
    ConcurrencyLimitError,
    ExternalServiceError,
    ResponseSizeExceededError,
)

client = TestClient(app)


# ---------------------------------------------------------------------------
# A5 — resilient-client exceptions mapped to status codes
# ---------------------------------------------------------------------------
@pytest.mark.unit
class TestGeocodeExceptionMapping:
    """Each ExternalServiceClient failure maps to a defined status code."""

    @pytest.mark.parametrize(
        "exc,expected_status",
        [
            (CircuitBreakerOpenError("cb open"), 503),
            (ConcurrencyLimitError("busy"), 503),
            (ResponseSizeExceededError("too big"), 502),
            (ExternalServiceError("service error"), 502),
        ],
    )
    def test_search_maps_exception_to_status(self, exc, expected_status):
        """/api/geocode/search must map each client exception to its status."""
        with patch.object(
            geocode_module._nominatim_client,
            "request_async",
            new=AsyncMock(side_effect=exc),
        ):
            resp = client.get("/api/geocode/search?q=manila")
        assert resp.status_code == expected_status

    @pytest.mark.parametrize(
        "exc,expected_status",
        [
            (CircuitBreakerOpenError("cb open"), 503),
            (ConcurrencyLimitError("busy"), 503),
            (ResponseSizeExceededError("too big"), 502),
            (ExternalServiceError("service error"), 502),
        ],
    )
    def test_reverse_maps_exception_to_status(self, exc, expected_status):
        """/api/geocode/reverse must map each client exception to its status."""
        with patch.object(
            geocode_module._nominatim_client,
            "request_async",
            new=AsyncMock(side_effect=exc),
        ):
            resp = client.get("/api/geocode/reverse?lat=14.6&lon=120.98")
        assert resp.status_code == expected_status


# ---------------------------------------------------------------------------
# A5 — request validation
# ---------------------------------------------------------------------------
@pytest.mark.unit
class TestGeocodeValidation:
    """Missing required query params must be rejected with 422."""

    def test_search_missing_q_returns_422(self):
        """/api/geocode/search without q must return 422."""
        resp = client.get("/api/geocode/search")
        assert resp.status_code == 422

    def test_reverse_missing_lat_returns_422(self):
        """/api/geocode/reverse without lat must return 422."""
        resp = client.get("/api/geocode/reverse?lon=120.98")
        assert resp.status_code == 422

    def test_reverse_missing_lon_returns_422(self):
        """/api/geocode/reverse without lon must return 422."""
        resp = client.get("/api/geocode/reverse?lat=14.6")
        assert resp.status_code == 422

    def test_reverse_missing_lat_and_lon_returns_422(self):
        """/api/geocode/reverse without lat/lon must return 422."""
        resp = client.get("/api/geocode/reverse")
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# A8 — invalid/non-JSON 200 body (documented: actually uncaught 500)
# ---------------------------------------------------------------------------
@pytest.mark.unit
class TestGeocodeInvalidBody:
    """A 200 response with a non-JSON body is not mapped to a 502 by the route.

    Documented finding: geocode.py does NOT map json.JSONDecodeError -> 502.
    The scout hypothesized a 502 mapping; actual behavior is an uncaught 500
    ({"detail":"An unexpected error occurred. Please try again later."}).
    """

    @staticmethod
    def _make_non_json_ok_response() -> MagicMock:
        resp = MagicMock()
        resp.status_code = 200
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(side_effect=json.JSONDecodeError("bad", "x", 0))
        return resp

    def test_search_non_json_body_returns_raw_500(self):
        """/api/geocode/search with invalid body returns 500 (not 502).

        The route lets json.JSONDecodeError propagate, so the default TestClient
        would re-raise; use raise_server_exceptions=False to observe the 500.
        """
        with patch.object(
            geocode_module._nominatim_client,
            "request_async",
            new=AsyncMock(return_value=self._make_non_json_ok_response()),
        ):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/geocode/search?q=manila"
            )
        assert resp.status_code == 500
        # Raw/default error shape — the route does not map the decode failure.
        assert "detail" in resp.json()

    def test_reverse_non_json_body_returns_raw_500(self):
        """/api/geocode/reverse with invalid body returns 500 (not 502)."""
        with patch.object(
            geocode_module._nominatim_client,
            "request_async",
            new=AsyncMock(return_value=self._make_non_json_ok_response()),
        ):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/geocode/reverse?lat=14.6&lon=120.98"
            )
        assert resp.status_code == 500
        assert "detail" in resp.json()
