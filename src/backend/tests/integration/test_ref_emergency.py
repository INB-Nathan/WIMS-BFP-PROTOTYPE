from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_emergency_services_no_coords():
    """Test /api/ref/emergency-services without lat/lon."""
    response = client.get("/api/ref/emergency-services")
    assert response.status_code == 200
    data = response.json()
    assert "emergency_number" in data
    assert data["emergency_number"] == "911"
    assert "stations" in data
    assert isinstance(data["stations"], list)
    if len(data["stations"]) > 0:
        station = data["stations"][0]
        assert "station_id" in station
        assert "station_name" in station
        assert "latitude" in station
        assert "longitude" in station
        assert "phone" not in station
        assert "address" not in station
        assert station["distance_m"] is None


def test_emergency_services_with_coords():
    """Test /api/ref/emergency-services with lat/lon."""
    # Assuming standard lat/lon in PH
    response = client.get("/api/ref/emergency-services?lat=14.5995&lon=120.9842")
    assert response.status_code == 200
    data = response.json()
    assert data["emergency_number"] == "911"
    assert "stations" in data
    assert "nearest_station_ids" in data
    if len(data["stations"]) > 0:
        assert len(data["stations"]) >= len(data["nearest_station_ids"])
        assert len(data["nearest_station_ids"]) <= 5
        assert data["stations"][0]["distance_m"] is not None


def test_emergency_services_cache_hit(monkeypatch):
    """Test that Redis cache is hit."""

    class DummyRedis:
        def get(self, key):
            return '{"stations": [{"station_id": 999, "station_name": "Cache Station", "latitude": 10.0, "longitude": 10.0, "distance_m": null}]}'

        def setex(self, key, ttl, val):
            pass

    import redis

    monkeypatch.setattr(redis, "from_url", lambda url, **kwargs: DummyRedis())

    response = client.get("/api/ref/emergency-services?lat=10.0&lon=10.0")
    assert response.status_code == 200
    data = response.json()
    assert data["stations"][0]["station_name"] == "Cache Station"
    assert data["emergency_number"] == "911"
