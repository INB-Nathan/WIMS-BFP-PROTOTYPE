from __future__ import annotations

from services.afor_import.commit import _resolve_row_wgs84


class _FakeRow(tuple):
    pass


class _FakeDb:
    def __init__(self):
        self.calls: list[dict] = []

    def execute(self, _sql, params):
        self.calls.append(params)
        station = params.get("station_name")
        city = params.get("city_text")
        if station == "Makati City Fire Station":
            return _FakeResult((121.0244, 14.5547))
        if station == "Paranaque City Fire Station":
            return _FakeResult((120.9822, 14.4793))
        if city == "Makati City":
            return _FakeResult((121.0244, 14.5547))
        return _FakeResult(None)


class _FakeResult:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


def test_afor_commit_resolves_exact_row_station_coordinates_before_fallback():
    db = _FakeDb()
    row = {
        "_city_text": "Makati City",
        "incident_nonsensitive_details": {"fire_station_name": "Makati City Fire Station"},
    }

    lon, lat = _resolve_row_wgs84(db, row, region_id=1, fallback_lon=120.9822, fallback_lat=14.4793)

    assert (lon, lat) == (121.0244, 14.5547)


def test_afor_commit_uses_city_station_coordinates_when_station_name_missing():
    db = _FakeDb()
    row = {"_city_text": "Makati City", "incident_nonsensitive_details": {}}

    lon, lat = _resolve_row_wgs84(db, row, region_id=1, fallback_lon=120.9822, fallback_lat=14.4793)

    assert (lon, lat) == (121.0244, 14.5547)


def test_afor_commit_keeps_manual_pin_when_row_has_no_reference_match():
    db = _FakeDb()
    row = {"_city_text": "Unknown City", "incident_nonsensitive_details": {}}

    lon, lat = _resolve_row_wgs84(db, row, region_id=1, fallback_lon=120.9822, fallback_lat=14.4793)

    assert (lon, lat) == (120.9822, 14.4793)
