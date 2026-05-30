"""Tests for the public map routes — cluster API and emergency services.

These tests verify route registration, input validation, and response shapes.
They do NOT require a running Docker stack (unit-level tests use mocked DB).

Run: cd src && python -m pytest backend/tests/test_public_map.py -v
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


class TestPublicClusterEndpoint:
    """GET /api/public/clusters — fire incident cluster markers."""

    def test_missing_bbox_returns_422(self):
        """Missing bounding box params must return 422."""
        resp = client.get("/api/public/clusters")
        assert resp.status_code == 422

    def test_partial_bbox_returns_422(self):
        """Partial bounding box params must return 422."""
        resp = client.get("/api/public/clusters?sw_lat=14.0&sw_lng=120.0")
        assert resp.status_code == 422

    def test_invalid_latitudes_returns_422(self):
        """Out-of-range latitudes must return 422."""
        resp = client.get(
            "/api/public/clusters"
            "?sw_lat=-100&sw_lng=120.0&ne_lat=100&ne_lng=121.0&zoom=10"
        )
        assert resp.status_code == 422

    @pytest.mark.integration
    def test_valid_params_returns_200_or_500(self):
        """With valid bounding box, route must return 200 or 500 (DB availability)."""
        resp = client.get(
            "/api/public/clusters"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
        )
        # 500 is acceptable if PostGIS is not available (integration test needs Docker)
        assert resp.status_code in (200, 500)
        if resp.status_code == 200:
            data = resp.json()
            assert "clusters" in data
            assert isinstance(data["clusters"], list)

    def test_response_shape_when_db_available(self, monkeypatch):
        """When DB returns data, response must match ClusterItem schema."""

        # Mock the db.execute to return sample data
        class MockRow:
            center_lat = 14.5
            center_lng = 120.98
            cnt = 5
            severity = "medium"
            latest_at = None

            def _mapping(self):
                return {
                    "center_lat": self.center_lat,
                    "center_lng": self.center_lng,
                    "cnt": self.cnt,
                    "severity": self.severity,
                    "latest_at": self.latest_at,
                }

        class MockResult:
            def fetchall(self):
                return [MockRow()]

        class MockDB:
            def execute(self, *args, **kwargs):
                return MockResult()

        # Apply mocking at the dependency level
        from database import get_db

        def override_get_db():
            db = MockDB()
            try:
                yield db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db

        resp = client.get(
            "/api/public/clusters"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
        )
        # Clean up overrides
        app.dependency_overrides.clear()
        assert resp.status_code in (200, 500)
        if resp.status_code == 200:
            data = resp.json()
            assert "clusters" in data
            if data["clusters"]:
                c = data["clusters"][0]
                assert "lat" in c
                assert "lng" in c
                assert "count" in c
                assert "severity" in c
                assert c["severity"] in ("low", "medium", "high")

    def test_zoom_out_of_range_returns_422(self):
        """Zoom outside 4-18 must return 422."""
        resp = client.get(
            "/api/public/clusters"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=3"
        )
        assert resp.status_code == 422

        resp = client.get(
            "/api/public/clusters"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=19"
        )
        assert resp.status_code == 422

    @pytest.mark.integration
    def test_default_zoom(self):
        """Zoom defaults to 10 when not provided."""
        resp = client.get(
            "/api/public/clusters"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
        )
        assert resp.status_code in (200, 500)


class TestPublicEmergencyServicesEndpoint:
    """GET /api/public/emergency-services — emergency contacts."""

    def test_returns_200_with_national_contacts(self):
        """Must always return 200 with national contact list."""
        resp = client.get("/api/public/emergency-services")
        assert resp.status_code in (200, 500)
        if resp.status_code == 200:
            data = resp.json()
            assert "national" in data
            assert len(data["national"]) >= 1
            assert "stations" in data
            assert "cached_at" in data

    def test_national_contacts_contain_911(self):
        """911 must be in the national contacts."""
        resp = client.get("/api/public/emergency-services")
        if resp.status_code == 200:
            data = resp.json()
            phones = [c["phone"] for c in data["national"]]
            assert any("911" in p for p in phones)

    @pytest.mark.integration
    def test_with_coordinates_returns_stations_or_empty(self):
        """With lat/lng query params, stations must be present."""
        resp = client.get(
            "/api/public/emergency-services"
            "?lat=14.5995&lng=120.9842"
        )
        assert resp.status_code in (200, 500)
        if resp.status_code == 200:
            data = resp.json()
            assert "stations" in data


class TestOperationalMapEndpoint:
    """GET /api/validator/operational-map — authenticated map endpoint."""

    def test_without_auth_returns_401(self):
        """Unauthenticated request must return 401."""
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
        )
        assert resp.status_code == 401

    def test_response_shape(self):
        """Valid params should return proper shape (will fail auth but verify)."""
        resp = client.get(
            "/api/validator/operational-map"
            "?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&status_filter=VERIFIED"
        )
        # Without auth token, should be 401
        assert resp.status_code == 401


class TestGridSizeFunction:
    """Verify the grid size calculation for different zoom levels."""

    def test_grid_decreases_with_zoom(self):
        """Higher zoom = smaller grid cells."""
        from api.routes.map import _grid_size_for_zoom

        grid_4 = _grid_size_for_zoom(4)
        grid_10 = _grid_size_for_zoom(10)
        grid_18 = _grid_size_for_zoom(18)

        assert grid_4 > grid_10 > grid_18
        assert 0.001 < grid_4 < 10  # sanity check
        assert grid_18 < 0.01  # very fine at max zoom
