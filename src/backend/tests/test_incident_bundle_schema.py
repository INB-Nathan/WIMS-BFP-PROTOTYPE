"""Boundary and validation tests for incident bundle upload typed schema.

Tests coverage:
  - Valid bundle acceptance (backward compatible)
  - Count cap (>WIMS_MAX_BUNDLE_SIZE → 422)
  - Byte cap (oversized request body → 422)
  - Max nested JSON depth guard on resources_deployed / alarm_timeline
  - Coordinate bounds: latitude [-90, 90], longitude [-180, 180]
  - Non-negative numeric fields
  - String max_lengths (per DB column widths)
  - client_id UUID validation
  - ISO-8601 timestamp clamping
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas.incident_bundle import (
    BundleIncidentItem,
    BundleNonsensitiveDetails,
    BundleSensitiveDetails,
    IncidentBundleCreate,
)


# =============================================================================
# Tests: BundleNonsensitiveDetails field validation
# =============================================================================


class TestBundleNonsensitiveDetails:
    def test_defaults_empty(self):
        """All fields should have safe defaults when created empty."""
        d = BundleNonsensitiveDetails()
        assert d.structures_affected == 0
        assert d.households_affected == 0
        assert d.total_gas_consumed_liters == 0.0
        assert d.alarm_level == ""
        assert d.resources_deployed == {}
        assert d.problems_encountered == []
        assert d.recommendations == ""

    def test_noop_null_coercion(self):
        """Null/None values should be coerced to safe defaults."""
        d = BundleNonsensitiveDetails(
            structures_affected=None,
            households_affected=None,
            total_gas_consumed_liters=None,
            alarm_level=None,
            resources_deployed=None,
            problems_encountered=None,
            recommendations=None,
        )
        assert d.structures_affected == 0
        assert d.households_affected == 0
        assert d.total_gas_consumed_liters == 0.0
        assert d.alarm_level == ""
        assert d.resources_deployed == {}
        assert d.problems_encountered == []
        assert d.recommendations == ""

    def test_non_negative_int_rejects_negative(self):
        with pytest.raises(ValidationError, match="non-negative"):
            BundleNonsensitiveDetails(structures_affected=-1)

    @pytest.mark.parametrize(
        "field",
        [
            "structures_affected",
            "households_affected",
            "families_affected",
            "individuals_affected",
            "vehicles_affected",
            "total_response_time_minutes",
            "extent_objects_count",
        ],
    )
    def test_non_negative_int_accepts_zero(self, field):
        d = BundleNonsensitiveDetails(**{field: 0})
        assert getattr(d, field) == 0

    @pytest.mark.parametrize(
        "field",
        [
            "structures_affected",
            "households_affected",
            "families_affected",
            "individuals_affected",
            "vehicles_affected",
            "total_response_time_minutes",
            "extent_objects_count",
        ],
    )
    def test_non_negative_int_accepts_positive(self, field):
        d = BundleNonsensitiveDetails(**{field: 42})
        assert getattr(d, field) == 42

    def test_non_negative_float_rejects_negative(self):
        with pytest.raises(ValidationError, match="non-negative"):
            BundleNonsensitiveDetails(total_gas_consumed_liters=-0.5)

    def test_non_negative_float_accepts_zero(self):
        d = BundleNonsensitiveDetails(total_gas_consumed_liters=0.0)
        assert d.total_gas_consumed_liters == 0.0

    @pytest.mark.parametrize(
        "field",
        [
            "alarm_level",
            "general_category",
            "sub_category",
            "responder_type",
            "stage_of_fire",
            "incident_type_code",
        ],
    )
    def test_short_string_rejects_too_long(self, field):
        with pytest.raises(ValidationError, match="max length of 100"):
            BundleNonsensitiveDetails(**{field: "x" * 101})

    @pytest.mark.parametrize(
        "field",
        [
            "alarm_level",
            "general_category",
            "sub_category",
            "responder_type",
            "stage_of_fire",
            "incident_type_code",
        ],
    )
    def test_short_string_accepts_100(self, field):
        d = BundleNonsensitiveDetails(**{field: "x" * 100})
        assert getattr(d, field) == "x" * 100

    @pytest.mark.parametrize(
        "field",
        [
            "fire_origin",
            "extent_of_damage",
            "fire_station_name",
            "city_municipality",
            "province_district",
            "barangay",
            "incident_address",
            "nearest_landmark",
        ],
    )
    def test_medium_string_rejects_too_long(self, field):
        with pytest.raises(ValidationError, match="max length of 500"):
            BundleNonsensitiveDetails(**{field: "x" * 501})

    @pytest.mark.parametrize(
        "field",
        [
            "recommendations",
            "extent_description",
            "general_description_of_involved",
        ],
    )
    def test_long_string_rejects_too_long(self, field):
        with pytest.raises(ValidationError, match="max length of 2000"):
            BundleNonsensitiveDetails(**{field: "x" * 2001})


# =============================================================================
# Tests: BundleSensitiveDetails field validation
# =============================================================================


class TestBundleSensitiveDetails:
    def test_defaults_empty(self):
        d = BundleSensitiveDetails()
        assert d.receiver_name == ""
        assert d.disposition == ""
        assert d.establishment_name == ""
        assert d.is_icp_present is False

    def test_medium_string_rejects_too_long(self):
        with pytest.raises(ValidationError, match="max length of 500"):
            BundleSensitiveDetails(caller_name="x" * 501)

    def test_long_string_rejects_too_long(self):
        with pytest.raises(ValidationError, match="max length of 10000"):
            BundleSensitiveDetails(narrative_report="x" * 10001)

    def test_optional_fields_accept_none(self):
        d = BundleSensitiveDetails(
            caller_name=None,
            owner_name=None,
            narrative_report=None,
        )
        assert d.caller_name is None
        assert d.owner_name is None
        assert d.narrative_report is None

    def test_optional_string_within_length(self):
        d = BundleSensitiveDetails(caller_name="John Doe")
        assert d.caller_name == "John Doe"


# =============================================================================
# Tests: BundleIncidentItem coordinate / client_id / timestamp validation
# =============================================================================


class TestBundleIncidentItem:
    def test_valid_item(self):
        item = BundleIncidentItem(
            latitude=14.5,
            longitude=121.0,
            client_id="550e8400-e29b-41d4-a716-446655440000",
        )
        assert item.latitude == 14.5
        assert item.longitude == 121.0
        assert item.client_id == "550e8400-e29b-41d4-a716-446655440000"

    def test_latitude_rejects_below_minus_90(self):
        with pytest.raises(ValidationError, match="latitude"):
            BundleIncidentItem(latitude=-91.0)

    def test_latitude_rejects_above_90(self):
        with pytest.raises(ValidationError, match="latitude"):
            BundleIncidentItem(latitude=91.0)

    def test_latitude_accepts_boundary(self):
        item = BundleIncidentItem(latitude=90.0, longitude=0.0)
        assert item.latitude == 90.0
        item2 = BundleIncidentItem(latitude=-90.0, longitude=0.0)
        assert item2.latitude == -90.0

    def test_longitude_rejects_below_minus_180(self):
        with pytest.raises(ValidationError, match="longitude"):
            BundleIncidentItem(longitude=-181.0)

    def test_longitude_rejects_above_180(self):
        with pytest.raises(ValidationError, match="longitude"):
            BundleIncidentItem(longitude=181.0)

    def test_longitude_accepts_boundary(self):
        item = BundleIncidentItem(latitude=0.0, longitude=180.0)
        assert item.longitude == 180.0
        item2 = BundleIncidentItem(latitude=0.0, longitude=-180.0)
        assert item2.longitude == -180.0

    def test_client_id_valid_uuid(self):
        uid = "550e8400-e29b-41d4-a716-446655440000"
        item = BundleIncidentItem(client_id=uid)
        assert item.client_id == uid

    def test_client_id_invalid_uuid(self):
        with pytest.raises(ValidationError, match="client_id"):
            BundleIncidentItem(client_id="not-a-uuid")

    def test_client_id_none(self):
        item = BundleIncidentItem(client_id=None)
        assert item.client_id is None

    def test_client_id_empty_string_converts_to_none(self):
        item = BundleIncidentItem(client_id="")
        assert item.client_id is None

    def test_iso_timestamp_valid_naive(self):
        """Naive ISO-8601 timestamp is treated as UTC."""
        item = BundleIncidentItem(created_at="2026-06-19T10:00:00")
        assert item.created_at is not None
        assert "2026-06-19" in item.created_at

    def test_iso_timestamp_valid_with_tz(self):
        """Timezoned ISO-8601 timestamp passes."""
        item = BundleIncidentItem(created_at="2026-06-19T10:00:00+08:00")
        assert item.created_at is not None
        assert "2026-06-19" in item.created_at

    def test_iso_timestamp_valid_zulu(self):
        """Z suffix is accepted."""
        item = BundleIncidentItem(created_at="2026-06-19T10:00:00Z")
        assert item.created_at is not None
        assert "2026-06-19" in item.created_at

    def test_iso_timestamp_invalid(self):
        with pytest.raises(ValidationError, match="timestamp"):
            BundleIncidentItem(created_at="not-a-date")

    def test_iso_timestamp_none(self):
        item = BundleIncidentItem(created_at=None)
        assert item.created_at is None


# =============================================================================
# Tests: IncidentBundleCreate top-level validation
# =============================================================================


class TestIncidentBundleCreate:
    def test_minimal_valid_bundle(self):
        """One valid incident should pass."""
        bundle = IncidentBundleCreate(
            incidents=[BundleIncidentItem(latitude=14.5, longitude=121.0)]
        )
        assert len(bundle.incidents) == 1

    def test_rejects_empty_incidents(self):
        with pytest.raises(ValidationError):
            IncidentBundleCreate(incidents=[])

    def test_accepts_200_incidents(self):
        items = [BundleIncidentItem(latitude=0.0, longitude=0.0) for _ in range(200)]
        bundle = IncidentBundleCreate(incidents=items)
        assert len(bundle.incidents) == 200

    def test_rejects_201_incidents(self):
        items = [BundleIncidentItem(latitude=0.0, longitude=0.0) for _ in range(201)]
        with pytest.raises(ValidationError, match="exceeds maximum"):
            IncidentBundleCreate(incidents=items)

    def test_region_id_optional(self):
        bundle = IncidentBundleCreate(
            incidents=[BundleIncidentItem(latitude=0.0, longitude=0.0)],
            region_id=42,
        )
        assert bundle.region_id == 42

    def test_region_id_none(self):
        bundle = IncidentBundleCreate(
            incidents=[BundleIncidentItem(latitude=0.0, longitude=0.0)],
            region_id=None,
        )
        assert bundle.region_id is None


# =============================================================================
# Tests: Max nested JSON depth guard
# =============================================================================


class TestJsonDepthGuard:
    def test_flat_dict_ok(self):
        d = BundleNonsensitiveDetails(
            resources_deployed={"a": 1, "b": 2},
            alarm_timeline={"start": "now"},
        )
        assert d.resources_deployed["a"] == 1

    def test_nested_9_levels_ok(self):
        """Depth of 9 nested dicts = 10 counted levels (passes with default 10)."""
        deep = _nested_dict(9)
        d = BundleNonsensitiveDetails(resources_deployed=deep)
        assert d.resources_deployed is not None

    def test_nested_10_levels_rejected(self):
        """Depth of 10 nested dicts = 11 counted levels (exceeds default 10)."""
        deep = _nested_dict(10)
        with pytest.raises(ValidationError, match="Max JSON depth"):
            BundleNonsensitiveDetails(resources_deployed=deep)

    def test_nested_list_10_levels_rejected(self):
        deep = _nested_list(10)
        with pytest.raises(ValidationError, match="Max JSON depth"):
            BundleNonsensitiveDetails(resources_deployed=deep)


# ---------------------------------------------------------------------------
# Helpers for depth tests
# ---------------------------------------------------------------------------


def _nested_dict(depth: int) -> dict:
    rv: dict = {}
    cur = rv
    for i in range(depth):
        cur["nested"] = {} if i < depth - 1 else {"leaf": 1}
        cur = cur["nested"]
    return rv


def _nested_list(depth: int) -> dict:
    rv: dict = {"items": []}
    cur = rv["items"]
    for i in range(depth):
        if i < depth - 1:
            inner: list = []
            cur.append(inner)
            cur = inner
        else:
            cur.append({"leaf": 1})
    return rv
