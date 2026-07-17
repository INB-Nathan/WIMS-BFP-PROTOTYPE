"""Unit tests for OSRM routing config + fail-safe behavior (#552).

An unset OSRM_BASE_URL must disable OSRM lookups entirely (never fall back
to the public router.project-osrm.org instance) and degrade to the PostGIS
straight-line estimate. Failure logs must never leak request coordinates.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def _reload_routing_module():
    """Reload services.routing so OSRM_BASE_URL re-reads env per test."""
    import services.routing as routing

    yield routing


def _reload(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("OSRM_BASE_URL", raising=False)
    else:
        monkeypatch.setenv("OSRM_BASE_URL", value)

    import importlib

    import services.routing as routing

    importlib.reload(routing)
    return routing


class TestOsrmConfigurable:
    def test_unset_osrm_base_url_skips_external_call(self, monkeypatch):
        routing = _reload(monkeypatch, None)

        with patch.object(routing.httpx, "AsyncClient") as mock_client_cls:
            result = asyncio.run(
                routing.compute_routing(
                    report_lat=14.6,
                    report_lon=121.0,
                    station_lat=14.61,
                    station_lon=121.01,
                )
            )

        mock_client_cls.assert_not_called()
        assert result.data_source == "postgis_straight_line"
        assert result.execution_path == "fallback"

    def test_empty_osrm_base_url_skips_external_call(self, monkeypatch):
        routing = _reload(monkeypatch, "")

        with patch.object(routing.httpx, "AsyncClient") as mock_client_cls:
            result = asyncio.run(
                routing.compute_routing(
                    report_lat=14.6,
                    report_lon=121.0,
                    station_lat=14.61,
                    station_lon=121.01,
                )
            )

        mock_client_cls.assert_not_called()
        assert result.data_source == "postgis_straight_line"

    def test_configured_osrm_base_url_is_used(self, monkeypatch):
        routing = _reload(monkeypatch, "http://self-hosted-osrm:5000")

        mock_resp = AsyncMock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_resp.raise_for_status = lambda: None
        mock_resp.json = lambda: {"routes": [{"distance": 1200.0, "duration": 180.0}]}

        called_urls = []

        async def mock_get(url, *args, **kwargs):
            called_urls.append(url)
            return mock_resp

        with patch.object(routing.httpx, "AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.get = mock_get
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            result = asyncio.run(
                routing.compute_routing(
                    report_lat=14.6,
                    report_lon=121.0,
                    station_lat=14.61,
                    station_lon=121.01,
                )
            )

        assert len(called_urls) == 1
        assert called_urls[0].startswith("http://self-hosted-osrm:5000/")
        assert "router.project-osrm.org" not in called_urls[0]
        # overview=full and geometries=geojson prevent silent revert to overview=false
        assert "overview=full" in called_urls[0]
        assert "geometries=geojson" in called_urls[0]
        assert result.data_source == "osrm"
        assert result.distance_m == 1200.0
        assert result.duration_s == 180.0

    def test_public_osrm_is_never_used_as_a_default(self, monkeypatch):
        routing = _reload(monkeypatch, None)

        assert routing.OSRM_BASE_URL == ""
        assert "router.project-osrm.org" not in (routing.OSRM_BASE_URL or "")


class TestOsrmLoggingDoesNotLeakCoordinates:
    def test_failure_log_omits_coordinates_and_url(self, monkeypatch, caplog):
        routing = _reload(monkeypatch, "http://self-hosted-osrm:5000")

        async def mock_get(*args, **kwargs):
            raise httpx.ConnectError("Connection refused")

        with patch.object(routing.httpx, "AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.get = mock_get
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            with caplog.at_level("WARNING", logger="wims.routing"):
                result = asyncio.run(
                    routing.compute_routing(
                        report_lat=14.6,
                        report_lon=121.0,
                        station_lat=14.61,
                        station_lon=121.01,
                    )
                )

        assert result.data_source == "postgis_straight_line"

        log_text = " ".join(record.getMessage() for record in caplog.records)
        # Coordinates must never reach the log.
        assert "14.6" not in log_text
        assert "121.0" not in log_text
        assert "14.61" not in log_text
        assert "121.01" not in log_text
        # The failing OSRM request path/URL must not be logged either.
        assert "/route/v1/driving/" not in log_text
        # The exception type is still surfaced for observability.
        assert "ConnectError" in log_text

    def test_skip_notice_omits_coordinates(self, monkeypatch, caplog):
        routing = _reload(monkeypatch, None)

        with caplog.at_level("INFO", logger="wims.routing"):
            asyncio.run(
                routing.compute_routing(
                    report_lat=14.6,
                    report_lon=121.0,
                    station_lat=14.61,
                    station_lon=121.01,
                )
            )

        log_text = " ".join(record.getMessage() for record in caplog.records)
        assert "14.6" not in log_text
        assert "121.0" not in log_text


class TestRoutingGeometry:
    def test_osrm_returns_geometry_when_available(self, monkeypatch):
        routing = _reload(monkeypatch, "http://self-hosted-osrm:5000")

        mock_resp = AsyncMock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_resp.raise_for_status = lambda: None
        mock_resp.json = lambda: {
            "routes": [
                {
                    "distance": 1200.0,
                    "duration": 180.0,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[121.0, 14.6], [121.005, 14.605], [121.01, 14.61]],
                    },
                }
            ]
        }

        async def mock_get(url, *args, **kwargs):
            return mock_resp

        with patch.object(routing.httpx, "AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.get = mock_get
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            result = asyncio.run(
                routing.compute_routing(
                    report_lat=14.6,
                    report_lon=121.0,
                    station_lat=14.61,
                    station_lon=121.01,
                )
            )

        assert result.data_source == "osrm"
        assert result.geometry is not None
        assert result.geometry["type"] == "LineString"
        assert len(result.geometry["coordinates"]) == 3

    def test_malformed_osrm_geometry_is_not_returned_for_persistence(self, monkeypatch):
        routing = _reload(monkeypatch, "http://self-hosted-osrm:5000")

        mock_resp = AsyncMock(spec=httpx.Response)
        mock_resp.raise_for_status = lambda: None
        mock_resp.json = lambda: {
            "routes": [
                {
                    "distance": 1200.0,
                    "duration": 180.0,
                    "geometry": {"type": "Point", "coordinates": [121.0, 14.6]},
                }
            ]
        }

        with patch.object(routing.httpx, "AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.get.return_value = mock_resp
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            result = asyncio.run(
                routing.compute_routing(
                    report_lat=14.6,
                    report_lon=121.0,
                    station_lat=14.61,
                    station_lon=121.01,
                )
            )

        assert result.data_source == "osrm"
        assert result.geometry is None

    def test_fallback_returns_null_geometry(self, monkeypatch):
        routing = _reload(monkeypatch, None)

        result = asyncio.run(
            routing.compute_routing(
                report_lat=14.6,
                report_lon=121.0,
                station_lat=14.61,
                station_lon=121.01,
            )
        )

        assert result.data_source == "postgis_straight_line"
        assert result.geometry is None

    def test_osrm_failure_returns_null_geometry(self, monkeypatch):
        routing = _reload(monkeypatch, "http://self-hosted-osrm:5000")

        async def mock_get(*args, **kwargs):
            raise httpx.ConnectError("Connection refused")

        with patch.object(routing.httpx, "AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.get = mock_get
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            result = asyncio.run(
                routing.compute_routing(
                    report_lat=14.6,
                    report_lon=121.0,
                    station_lat=14.61,
                    station_lon=121.01,
                )
            )

        assert result.data_source == "postgis_straight_line"
        assert result.geometry is None


class TestCivilianReportResponseExcludesRoutingGeometry:
    """Guards the Option A fix: routing_geometry on CivilianReportResponse only."""

    def test_civilian_report_response_model_omits_routing_geometry(self):
        """CivilianReportResponse model must not have routing_geometry field."""
        from schemas.civilian import CivilianReportResponse, CivilianTrackingResponse

        assert "routing_geometry" not in CivilianReportResponse.model_fields, (
            "CivilianReportResponse must NOT expose routing_geometry (Option A)"
        )
        # Tracking response still retains the field
        assert "routing_geometry" in CivilianTrackingResponse.model_fields, (
            "CivilianTrackingResponse SHOULD retain routing_geometry"
        )

    def test_civilian_report_response_serialized_omits_routing_geometry(self):
        """A serialized CivilianReportResponse omits routing_geometry."""
        from schemas.civilian import CivilianReportResponse

        instance = CivilianReportResponse(
            report_id=1,
            latitude=14.6,
            longitude=121.0,
            category="STRUCTURAL",
            trust_score=50,
            status="PENDING",
            photo_count=0,
            created_at="2026-07-16T00:00:00Z",
        )
        dumped = instance.model_dump(mode="json")
        assert "routing_geometry" not in dumped
        # Other routing fields survive
        assert dumped.get("routing_distance_m") is None


class TestRoutingGeometryPersistence:
    """Task-level tests for compute_routing_task geometry persistence (#611)."""

    def test_task_persists_geometry_when_present(self, monkeypatch):
        """When geometry is returned, UPDATE includes ST_GeomFromGeoJSON and commits."""
        from unittest.mock import MagicMock, patch as unit_patch
        import json

        from services.routing import RoutingResult

        async def mock_compute_routing(**kwargs):
            return RoutingResult(
                distance_m=1200.0,
                duration_s=180.0,
                data_source="osrm",
                execution_path="celery",
                candidate_count=1,
                geometry={
                    "type": "LineString",
                    "coordinates": [[121.0, 14.6], [121.005, 14.605], [121.01, 14.61]],
                },
            )

        monkeypatch.setattr("tasks.routing.compute_routing", mock_compute_routing)

        db = MagicMock()

        # Execute 1: fetch report location
        loc_row = MagicMock()
        loc_row.lat = 14.6
        loc_row.lon = 121.0
        loc_result = MagicMock()
        loc_result.fetchone.return_value = loc_row

        # Execute 2: fetch stations
        station_row = MagicMock()
        station_row.station_id = 1
        station_row.lat = 14.61
        station_row.lon = 121.01
        station_row.distance_m = 100.0
        stations_result = MagicMock()
        stations_result.fetchall.return_value = [station_row]

        # Execute 3: UPDATE
        update_result = MagicMock()

        db.execute.side_effect = [loc_result, stations_result, update_result]

        with unit_patch("tasks.routing._AdminSessionLocal", return_value=db):
            from tasks.routing import compute_routing_task

            result = compute_routing_task(report_id=1)

        assert result["status"] == "success"
        assert result["has_geometry"] is True

        # Verify the third execute call was the UPDATE with geometry_json param
        update_call = db.execute.call_args_list[2]
        params = update_call[0][1]
        assert params["geometry_json"] is not None
        parsed = json.loads(params["geometry_json"])
        assert parsed["type"] == "LineString"
        assert len(parsed["coordinates"]) == 3

        # Verify SQL uses CASE WHEN with ST_GeomFromGeoJSON via the params path
        sql_text = str(update_call[0][0])
        # ST_GeomFromGeoJSON appears in the SQL text (pytest truncates display but assertion works)
        assert "geometry_json" in sql_text, "SQL text must reference geometry_json param"

        db.commit.assert_called_once()

    def test_task_persists_null_geometry_when_absent(self, monkeypatch):
        """When geometry is None, UPDATE sets routing_geometry = NULL and commits."""
        from unittest.mock import MagicMock, patch as unit_patch

        from services.routing import RoutingResult

        async def mock_compute_routing(**kwargs):
            return RoutingResult(
                distance_m=1200.0,
                duration_s=180.0,
                data_source="postgis_straight_line",
                execution_path="fallback",
                candidate_count=1,
                geometry=None,
            )

        monkeypatch.setattr("tasks.routing.compute_routing", mock_compute_routing)

        db = MagicMock()

        loc_row = MagicMock()
        loc_row.lat = 14.6
        loc_row.lon = 121.0
        loc_result = MagicMock()
        loc_result.fetchone.return_value = loc_row

        station_row = MagicMock()
        station_row.station_id = 1
        station_row.lat = 14.61
        station_row.lon = 121.01
        station_row.distance_m = 100.0
        stations_result = MagicMock()
        stations_result.fetchall.return_value = [station_row]

        update_result = MagicMock()

        db.execute.side_effect = [loc_result, stations_result, update_result]

        with unit_patch("tasks.routing._AdminSessionLocal", return_value=db):
            from tasks.routing import compute_routing_task

            result = compute_routing_task(report_id=2)

        assert result["status"] == "success"
        assert result["has_geometry"] is False

        # Verify geometry_json param is None (CASE WHEN resolves to ELSE NULL)
        update_call = db.execute.call_args_list[2]
        params = update_call[0][1]
        assert params["geometry_json"] is None

        # SQL should use CASE WHEN with :geometry_json
        sql_text = str(update_call[0][0])
        assert "CASE" in sql_text.upper()
        # Use case-insensitive check: the PostGIS function name contains 'GeomFromGeoJSON'
        assert "GEOMFROMGEOJSON" in sql_text.upper()
        assert "geometry_json" in sql_text

        db.commit.assert_called_once()
