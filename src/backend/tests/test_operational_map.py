"""Tests for the validator operational map route — GET /api/validator/operational-map.

These tests verify route registration, input validation, and response shapes.

Run: cd src && python -m pytest backend/tests/test_operational_map.py -v
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from auth import get_db_with_rls

client = TestClient(app)


# ── Fixture: mock DB dependency ─────────────────────────────────────────────


@pytest.fixture
def mock_db():
    """Override get_db_with_rls with a mock Session for validation tests."""
    session = MagicMock(spec=Session)
    app.dependency_overrides[get_db_with_rls] = lambda: session
    yield session
    app.dependency_overrides.clear()


# ── Validation tests ────────────────────────────────────────────────────────


class TestOperationalMapValidation:
    """Route input validation with mocked DB."""

    def test_missing_bbox_returns_422(self, mock_db):
        resp = client.get("/api/validator/operational-map")
        assert resp.status_code == 422

    def test_partial_bbox_returns_422(self, mock_db):
        resp = client.get(
            "/api/validator/operational-map?sw_lat=14.0&sw_lng=120.0"
        )
        assert resp.status_code == 422

    def test_invalid_latitudes_returns_422(self, mock_db):
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=-100&sw_lng=120.0&ne_lat=100&ne_lng=121.0&zoom=10"
        )
        assert resp.status_code == 422

    def test_invalid_zoom_returns_422(self, mock_db):
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=3"
        )
        assert resp.status_code == 422

    def test_invalid_status_filter_returns_422(self, mock_db):
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
            "&status_filter=INVALID_STATUS"
        )
        assert resp.status_code == 422

    def test_valid_params_succeeds(self, mock_db):
        """Valid params must not return 422."""
        mock_db.execute.return_value.fetchall.return_value = []
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
        )
        assert resp.status_code == 200

    def test_date_from_alone_accepted(self, mock_db):
        mock_db.execute.return_value.fetchall.return_value = []
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
            "&date_from=2026-01-01"
        )
        assert resp.status_code == 200

    def test_date_to_alone_accepted(self, mock_db):
        mock_db.execute.return_value.fetchall.return_value = []
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
            "&date_to=2026-06-30"
        )
        assert resp.status_code == 200

    def test_both_dates_accepted(self, mock_db):
        mock_db.execute.return_value.fetchall.return_value = []
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
            "&date_from=2026-01-01&date_to=2026-06-30"
        )
        assert resp.status_code == 200

    def test_valid_status_filter_accepted(self, mock_db):
        mock_db.execute.return_value.fetchall.return_value = []
        for status in ("PENDING", "PENDING_VALIDATION", "VERIFIED", "REJECTED"):
            resp = client.get(
                "/api/validator/operational-map"
                "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
                f"&status_filter={status}"
            )
            assert resp.status_code == 200, f"status_filter={status}"

    def test_status_and_date_together_accepted(self, mock_db):
        mock_db.execute.return_value.fetchall.return_value = []
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
            "&status_filter=VERIFIED&date_from=2026-01-01&date_to=2026-06-30"
        )
        assert resp.status_code == 200

    def test_empty_bbox_returns_empty(self, mock_db):
        mock_db.execute.return_value.fetchall.return_value = []
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=14.0001&ne_lng=120.0001&zoom=18"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["clusters"] == []


# ── Fire station endpoint tests ─────────────────────────────────────────────


class TestValidatorFireStations:
    """GET /api/validator/fire-stations."""

    def test_endpoint_returns_stations(self, mock_db):
        mock_row = MagicMock()
        mock_row.station_id = 1
        mock_row.station_name = "Test Station"
        mock_row.address = "123 Test St"
        mock_row.region_name = "NCR"
        mock_row.latitude = 14.5
        mock_row.longitude = 121.0
        mock_db.execute.return_value.fetchall.return_value = [mock_row]

        resp = client.get("/api/validator/fire-stations")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["station_name"] == "Test Station"
        assert data[0]["region_name"] == "NCR"

    def test_empty_stations(self, mock_db):
        mock_db.execute.return_value.fetchall.return_value = []
        resp = client.get("/api/validator/fire-stations")
        assert resp.status_code == 200
        assert resp.json() == []
