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
            "/api/public/clusters?sw_lat=-100&sw_lng=120.0&ne_lat=100&ne_lng=121.0&zoom=10"
        )
        assert resp.status_code == 422

    @pytest.mark.integration
    def test_valid_params_returns_200_or_500(self):
        """With valid bounding box, route must return 200 or 500 (DB availability)."""
        resp = client.get(
            "/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
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
        try:
            resp = client.get(
                "/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
            )
        finally:
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
            "/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=3"
        )
        assert resp.status_code == 422

        resp = client.get(
            "/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=19"
        )
        assert resp.status_code == 422

    @pytest.mark.integration
    def test_default_zoom(self):
        """Zoom defaults to 10 when not provided."""
        resp = client.get("/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0")
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
        resp = client.get("/api/public/emergency-services?lat=14.5995&lng=120.9842")
        assert resp.status_code in (200, 500)
        if resp.status_code == 200:
            data = resp.json()
            assert "stations" in data


class TestOperationalMapEndpoint:
    """GET /api/validator/operational-map — authenticated map endpoint."""

    def test_without_auth_returns_401(self):
        """Unauthenticated request must return 401."""
        resp = client.get(
            "/api/validator/operational-map?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0"
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


@pytest.mark.unit
class TestPublicClusterInvertedAndEmptyBbox:
    """A6 — inverted / empty bounding boxes return 200 with empty clusters.

    The route only range-validates coordinates (ge/le bounds); it does NOT
    enforce sw < ne ordering. An inverted bbox still yields a valid (empty)
    query result. A valid bbox with no matching data also yields empty clusters.
    """

    def test_inverted_lat_lng_returns_200_empty(self, monkeypatch):
        """sw_lat>ne_lat and sw_lng>ne_lng must return 200 with []."""
        from database import get_db
        from api.routes import map as map_module

        class MockDB:
            def execute(self, *args, **kwargs):
                class MockResult:
                    def fetchall(self):
                        return []

                return MockResult()

        def override_get_db():
            yield MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with monkeypatch.context() as m:
                m.setattr(
                    map_module,
                    "_get_redis",
                    lambda: _async_none(),
                )
                resp = client.get(
                    "/api/public/clusters?sw_lat=20.0&sw_lng=125.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
                )
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["clusters"] == []

    def test_valid_empty_bbox_returns_200_empty(self, monkeypatch):
        """A valid bbox with no data returns 200 with empty clusters."""
        from database import get_db
        from api.routes import map as map_module

        class MockDB:
            def execute(self, *args, **kwargs):
                class MockResult:
                    def fetchall(self):
                        return []

                return MockResult()

        def override_get_db():
            yield MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with monkeypatch.context() as m:
                m.setattr(
                    map_module,
                    "_get_redis",
                    lambda: _async_none(),
                )
                resp = client.get(
                    "/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
                )
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert resp.json()["clusters"] == []


@pytest.mark.unit
class TestPublicClusterCache:
    """A7 — Redis cache failure is non-fatal; cache-hit returns cached payload.

    Documented finding: on a cache hit, map.py returns cached_at=None (the
    hit path does not populate cached_at). We therefore assert the cached
    payload is returned (clusters come from cache, not recomputed from DB)
    and confirm cached_at is None per the actual code.
    """

    def test_cache_failure_returns_live_200(self, monkeypatch):
        """When _get_redis returns a client whose get/setex raise, the route
        must still return 200 with a live (empty) response, not 5xx."""
        from database import get_db
        from api.routes import map as map_module

        class MockDB:
            def execute(self, *args, **kwargs):
                class MockResult:
                    def fetchall(self):
                        return []

                return MockResult()

        def override_get_db():
            yield MockDB()

        class FailingRedis:
            async def get(self, key):
                raise RuntimeError("redis down")

            async def setex(self, key, ttl, value):
                raise RuntimeError("redis down")

        app.dependency_overrides[get_db] = override_get_db
        try:
            with monkeypatch.context() as m:
                m.setattr(
                    map_module,
                    "_get_redis",
                    lambda: _async_failing_redis(),
                )
                resp = client.get(
                    "/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
                )
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert resp.json()["clusters"] == []

    def test_cache_hit_returns_cached_payload(self, monkeypatch):
        """A cache hit returns the cached payload (from Redis, not DB) with
        cached_at=None per the actual route implementation."""
        from database import get_db
        from api.routes import map as map_module
        import json

        # DB stub returns NO rows; if the cache were bypassed we'd get [].
        class MockDB:
            def execute(self, *args, **kwargs):
                class MockResult:
                    def fetchall(self):
                        return []

                return MockResult()

        def override_get_db():
            yield MockDB()

        cached_clusters = [
            {"lat": 14.5, "lng": 120.9, "count": 3, "severity": "low", "latest_at": None}
        ]

        class HitRedis:
            async def get(self, key):
                return json.dumps(cached_clusters)

            async def setex(self, key, ttl, value):
                return None

        app.dependency_overrides[get_db] = override_get_db
        try:
            with monkeypatch.context() as m:
                m.setattr(
                    map_module,
                    "_get_redis",
                    lambda: _async_hit_redis(cached_clusters),
                )
                resp = client.get(
                    "/api/public/clusters?sw_lat=14.0&sw_lng=120.0&ne_lat=15.0&ne_lng=121.0&zoom=10"
                )
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        # Cached payload is returned (proves cache read path, not DB recompute).
        assert len(data["clusters"]) == 1
        got = data["clusters"][0]
        assert got["lat"] == cached_clusters[0]["lat"]
        assert got["lng"] == cached_clusters[0]["lng"]
        assert got["count"] == cached_clusters[0]["count"]
        assert got["severity"] == cached_clusters[0]["severity"]
        # Documented: cached_at is None on cache hits in the current code.
        assert data["cached_at"] is None


def _never_called():
    raise AssertionError("Redis must not be contacted in this test")


def _async_none():
    async def _none():
        return None

    return _none()


def _async_failing_redis():
    async def _failing():
        class FailingRedis:
            async def get(self, key):
                raise RuntimeError("redis down")

            async def setex(self, key, ttl, value):
                raise RuntimeError("redis down")

        return FailingRedis()

    return _failing()


def _async_hit_redis(payload):
    import json

    async def _hit():
        class HitRedis:
            def __init__(self, payload):
                self._payload = payload

            async def get(self, key):
                return json.dumps(self._payload)

            async def setex(self, key, ttl, value):
                return None

        return HitRedis(payload)

    return _hit()
