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
