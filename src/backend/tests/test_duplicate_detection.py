"""Unit tests for the 5-criterion duplicate detection scoring system.

These tests mock db.execute() to validate Python-level behaviour:
  - threshold logic (score ≥ 3 → return id, else None)
  - parameter construction for each criterion
  - effective_date derivation from notification_dt
  - extra_where clause building (exclude_statuses, verified_window_seconds)
  - null parameter handling per criterion

SQL scoring correctness (PostGIS spatial ops) is covered by integration tests
against a live database with PostGIS; see tests/integration/.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from services.duplicate_detection import check_for_duplicate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_db(row=None):
    """Return a mocked SQLAlchemy session whose execute().fetchone() returns row."""
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = row
    return db


def _row(incident_id: int):
    """Minimal row object where row[0] == incident_id."""
    r = MagicMock()
    r.__getitem__ = lambda self, i: incident_id if i == 0 else None
    return r


def _get_params(db) -> dict:
    """Extract the params dict from db.execute(text_obj, params_dict) call."""
    positional_args, _ = db.execute.call_args
    return positional_args[1]


# ---------------------------------------------------------------------------
# Return value / threshold
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returns_none_when_no_row():
    db = _make_db(row=None)
    result = check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-01",
        lat=14.5,
        lon=121.0,
    )
    assert result is None


@pytest.mark.unit
def test_returns_incident_id_when_row_found():
    db = _make_db(row=_row(42))
    result = check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-01",
        lat=14.5,
        lon=121.0,
    )
    assert result == 42


@pytest.mark.unit
def test_returns_int_not_raw_row():
    db = _make_db(row=_row(99))
    result = check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-01",
        lat=14.5,
        lon=121.0,
    )
    assert isinstance(result, int)
    assert result == 99


# ---------------------------------------------------------------------------
# effective_date derivation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_effective_date_derived_from_notification_dt_when_incident_date_none():
    db = _make_db(row=None)
    notif = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date=None,
        notification_dt=notif,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["fire_date"] == "2026-05-09"


@pytest.mark.unit
def test_explicit_incident_date_takes_precedence_over_notification_dt():
    db = _make_db(row=None)
    notif = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-15",  # explicit — should win
        notification_dt=notif,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["fire_date"] == "2026-05-15"


# ---------------------------------------------------------------------------
# Parameter presence per criterion
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "param_key,kwarg,value,base_kwargs",
    [
        # Criterion 1: distance — don't pass lat/lon in base args to avoid conflict
        ("lat", "lat", 14.5995, {"incident_date": "2026-05-09", "lon": 120.0}),
        ("lon", "lon", 120.9842, {"incident_date": "2026-05-09", "lat": 14.0}),
        # Criterion 2: classification
        (
            "gen_cat",
            "general_category",
            "STRUCTURAL",
            {"incident_date": "2026-05-09", "lat": 14.5, "lon": 121.0},
        ),
        (
            "type_code",
            "incident_type_code",
            "APT",
            {"incident_date": "2026-05-09", "lat": 14.5, "lon": 121.0},
        ),
        # Criterion 3: fire date — don't pass incident_date in base args to avoid conflict
        ("fire_date", "incident_date", "2026-05-09", {"lat": 14.5, "lon": 121.0}),
        # Criterion 5: city/province
        (
            "city",
            "city_municipality",
            "Quezon City",
            {"incident_date": "2026-05-09", "lat": 14.5, "lon": 121.0},
        ),
        (
            "province",
            "province_district",
            "NCR",
            {"incident_date": "2026-05-09", "lat": 14.5, "lon": 121.0},
        ),
    ],
)
def test_criterion_param_is_forwarded(param_key, kwarg, value, base_kwargs):
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        **base_kwargs,
        **{kwarg: value},
    )
    assert _get_params(db)[param_key] == value


@pytest.mark.unit
def test_criterion4_notif_dt_serialized_to_isoformat():
    db = _make_db(row=None)
    notif = datetime(2026, 5, 9, 14, 30, 0, tzinfo=timezone.utc)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        notification_dt=notif,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["notif_dt"] == notif.isoformat()


# ---------------------------------------------------------------------------
# Null parameter handling
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_null_lat_lon_passes_none_to_params():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=None,
        lon=None,
    )
    params = _get_params(db)
    assert params["lat"] is None
    assert params["lon"] is None


@pytest.mark.unit
def test_null_notification_dt_passes_none_notif_dt_param():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        notification_dt=None,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["notif_dt"] is None


# ---------------------------------------------------------------------------
# extra_where clause construction
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_exclude_statuses_adds_skip_statuses_param():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        exclude_statuses=("DRAFT", "REJECTED"),
    )
    assert set(_get_params(db)["skip_statuses"]) == {"DRAFT", "REJECTED"}


@pytest.mark.unit
def test_no_exclude_statuses_does_not_add_skip_statuses_param():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        exclude_statuses=(),
    )
    assert "skip_statuses" not in _get_params(db)


@pytest.mark.unit
def test_verified_window_seconds_adds_window_param():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        verified_window_seconds=60,
    )
    assert _get_params(db)["window_seconds"] == 60


@pytest.mark.unit
def test_no_verified_window_does_not_add_window_param():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        verified_window_seconds=None,
    )
    assert "window_seconds" not in _get_params(db)


# ---------------------------------------------------------------------------
# region_id and incident_id always forwarded
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_region_id_and_cur_id_always_in_params():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=77,
        region_id=5,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
    )
    params = _get_params(db)
    assert params["rid"] == 5
    assert params["cur_id"] == 77


# ---------------------------------------------------------------------------
# Both exclude_statuses and verified_window_seconds together
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_combined_exclude_statuses_and_window():
    db = _make_db(row=None)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
        verified_window_seconds=60,
    )
    params = _get_params(db)
    assert "skip_statuses" in params
    assert params["window_seconds"] == 60
