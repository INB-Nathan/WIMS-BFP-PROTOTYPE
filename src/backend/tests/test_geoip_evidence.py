"""Tests for privacy-minimized coarse GeoIP evidence resolution."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from services.geoip_evidence import resolve_coarse_ip_evidence


class _Reader:
    def __init__(self, response=None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.closed = False

    def city(self, _client_ip: str):
        if self.error:
            raise self.error
        return self.response

    def metadata(self):
        return SimpleNamespace(database_type="GeoLite2-City")

    def close(self) -> None:
        self.closed = True


def _city_response():
    return SimpleNamespace(
        city=SimpleNamespace(name="Cebu City"),
        subdivisions=SimpleNamespace(most_specific=SimpleNamespace(name="Cebu")),
        location=SimpleNamespace(latitude=10.3157, longitude=123.8854, accuracy_radius=20),
    )


def test_success_returns_only_coarse_postgis_ready_evidence() -> None:
    reader = _Reader(_city_response())
    with patch("services.geoip_evidence._open_reader", return_value=reader):
        result = resolve_coarse_ip_evidence("203.0.113.9")

    assert result.available is True
    assert result.city == "Cebu City"
    assert result.province == "Cebu"
    assert result.latitude == 10.3157
    assert result.longitude == 123.8854
    assert result.accuracy_m == 20_000
    assert result.provider == "GeoLite2-City"
    assert "203.0.113.9" not in str(result.model_dump())
    assert reader.closed is True


def test_missing_database_is_non_blocking() -> None:
    with patch("services.geoip_evidence._open_reader", return_value=None):
        result = resolve_coarse_ip_evidence("203.0.113.9")

    assert result.available is False
    assert result.reason == "database_unavailable"
    assert "203.0.113.9" not in str(result.model_dump())


def test_lookup_failure_is_non_blocking_and_does_not_log_ip(caplog) -> None:
    reader = _Reader(error=RuntimeError("lookup failed for supplied address"))
    with patch("services.geoip_evidence._open_reader", return_value=reader):
        result = resolve_coarse_ip_evidence("203.0.113.9")

    assert result.available is False
    assert result.reason == "lookup_unavailable"
    assert "203.0.113.9" not in caplog.text
    assert reader.closed is True


def test_missing_coordinates_are_unavailable() -> None:
    response = _city_response()
    response.location.latitude = None
    reader = _Reader(response)
    with patch("services.geoip_evidence._open_reader", return_value=reader):
        result = resolve_coarse_ip_evidence("203.0.113.9")

    assert result.available is False
    assert result.reason == "coordinates_unavailable"
