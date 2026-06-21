"""
Tests for regional incident schema validation — Issue #398.

Tests exercise Pydantic Field constraints and semantic validators on:
- IncidentCreateRequest
- IncidentUpdateRequest

Run: cd src/backend && source .venv/bin/activate && python -m pytest tests/test_regional_schema_validation.py -v
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from schemas.regional import IncidentCreateRequest, IncidentUpdateRequest


# ═══════════════════════════════════════════════════════════════════════════
# Tracer bullet test — RED first (no Field constraints yet → latitude=999
# incorrectly validates → make it GREEN by adding Field(ge=-90, le=90))
# ═══════════════════════════════════════════════════════════════════════════


class TestIncidentCreateRequest:
    """IncidentCreateRequest validation bounds."""

    # ─── Coordinate bounds ────────────────────────────────────────────────

    @pytest.mark.parametrize("lat", [-90, 0, 14.5995, 90])
    def test_latitude_valid(self, lat):
        """Valid latitudes pass."""
        obj = IncidentCreateRequest(latitude=lat, longitude=120.9842)
        assert obj.latitude == lat

    @pytest.mark.parametrize("lat", [-90.1, -100, 90.1, 999, -999])
    def test_latitude_invalid(self, lat):
        """Latitudes outside [-90, 90] raise ValidationError."""
        with pytest.raises(ValidationError):
            IncidentCreateRequest(latitude=lat, longitude=120.9842)

    @pytest.mark.parametrize("lon", [-180, -120, 0, 120.9842, 180])
    def test_longitude_valid(self, lon):
        """Valid longitudes pass."""
        obj = IncidentCreateRequest(latitude=14.5995, longitude=lon)
        assert obj.longitude == lon

    @pytest.mark.parametrize("lon", [-180.1, -200, 180.1, 999])
    def test_longitude_invalid(self, lon):
        """Longitudes outside [-180, 180] raise ValidationError."""
        with pytest.raises(ValidationError):
            IncidentCreateRequest(latitude=14.5995, longitude=lon)

    # ─── Non-negative numeric fields ──────────────────────────────────────

    @pytest.mark.parametrize(
        "field,valid",
        [
            ("civilian_injured", [0, 1, 100]),
            ("civilian_deaths", [0, 1, 999]),
            ("firefighter_injured", [0, 1, 50]),
            ("firefighter_deaths", [0, 1, 10]),
            ("families_affected", [0, 1, 500]),
            ("structures_affected", [0, 1, 200]),
            ("households_affected", [0, 1, 300]),
            ("individuals_affected", [0, 1, 1000]),
        ],
    )
    def test_non_negative_numeric_valid(self, field, valid):
        """Non-negative integer fields accept >=0."""
        for val in valid:
            kwargs = {"latitude": 14.5995, "longitude": 120.9842, field: val}
            obj = IncidentCreateRequest(**kwargs)
            assert getattr(obj, field) == val

    @pytest.mark.parametrize(
        "field,invalids",
        [
            ("civilian_injured", [-1, -100]),
            ("civilian_deaths", [-1, -999]),
            ("firefighter_injured", [-1, -50]),
            ("firefighter_deaths", [-1, -10]),
            ("families_affected", [-1, -500]),
            ("structures_affected", [-1, -200]),
            ("households_affected", [-1, -300]),
            ("individuals_affected", [-1, -1000]),
        ],
    )
    def test_non_negative_numeric_invalid(self, field, invalids):
        """Non-negative integer fields reject <0."""
        for val in invalids:
            with pytest.raises(ValidationError):
                IncidentCreateRequest(**{"latitude": 14.5995, "longitude": 120.9842, field: val})

    @pytest.mark.parametrize(
        "field,valid",
        [
            ("estimated_damage_php", [0.0, 1000.50, 999999.99]),
            ("distance_from_station_km", [0.0, 5.2, 100.0]),
        ],
    )
    def test_non_negative_float_valid(self, field, valid):
        """Non-negative float fields accept >=0."""
        for val in valid:
            kwargs = {"latitude": 14.5995, "longitude": 120.9842, field: val}
            obj = IncidentCreateRequest(**kwargs)
            assert getattr(obj, field) == val

    @pytest.mark.parametrize(
        "field,invalids",
        [
            ("estimated_damage_php", [-0.01, -1000.0]),
            ("distance_from_station_km", [-0.1, -50.0]),
        ],
    )
    def test_non_negative_float_invalid(self, field, invalids):
        """Non-negative float fields reject <0."""
        for val in invalids:
            with pytest.raises(ValidationError):
                IncidentCreateRequest(**{"latitude": 14.5995, "longitude": 120.9842, field: val})

    def test_total_response_time_minutes_valid(self):
        """total_response_time_minutes accepts >=0."""
        obj = IncidentCreateRequest(
            latitude=14.5995, longitude=120.9842, total_response_time_minutes=30
        )
        assert obj.total_response_time_minutes == 30
        obj2 = IncidentCreateRequest(
            latitude=14.5995, longitude=120.9842, total_response_time_minutes=0
        )
        assert obj2.total_response_time_minutes == 0

    def test_total_response_time_minutes_invalid(self):
        """total_response_time_minutes rejects <0."""
        with pytest.raises(ValidationError):
            IncidentCreateRequest(
                latitude=14.5995, longitude=120.9842, total_response_time_minutes=-1
            )

    # ─── String max_length ────────────────────────────────────────────────

    @pytest.mark.parametrize(
        "field,limit",
        [
            ("alarm_level", 255),
            ("general_category", 255),
            ("sub_category", 255),
            ("fire_station_name", 255),
            ("caller_name", 255),
            ("caller_number", 255),
            ("establishment_name", 255),
            ("street_address", 255),
            ("landmark", 255),
            ("recommendations", 2000),
            ("narrative_report", 10000),
        ],
    )
    def test_string_max_length_valid(self, field, limit):
        """String fields accept length == limit."""
        kwargs = {"latitude": 14.5995, "longitude": 120.9842, field: "x" * limit}
        obj = IncidentCreateRequest(**kwargs)
        assert len(getattr(obj, field)) == limit

    @pytest.mark.parametrize(
        "field,limit",
        [
            ("alarm_level", 255),
            ("general_category", 255),
            ("sub_category", 255),
            ("fire_station_name", 255),
            ("caller_name", 255),
            ("caller_number", 255),
            ("establishment_name", 255),
            ("street_address", 255),
            ("landmark", 255),
            ("recommendations", 2000),
            ("narrative_report", 10000),
        ],
    )
    def test_string_max_length_invalid(self, field, limit):
        """String fields reject length > limit."""
        kwargs = {"latitude": 14.5995, "longitude": 120.9842, field: "x" * (limit + 1)}
        with pytest.raises(ValidationError):
            IncidentCreateRequest(**kwargs)

    # ─── Semantic date validation (D11) ───────────────────────────────────

    def test_notification_dt_recent_past_valid(self):
        """notification_dt in the recent past validates."""
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        obj = IncidentCreateRequest(latitude=14.5995, longitude=120.9842, notification_dt=past)
        assert obj.notification_dt == past

    def test_notification_dt_now_valid(self):
        """notification_dt at current time validates."""
        now = datetime.now(timezone.utc).isoformat()
        obj = IncidentCreateRequest(latitude=14.5995, longitude=120.9842, notification_dt=now)
        assert obj.notification_dt == now

    def test_notification_dt_within_tolerance_valid(self):
        """notification_dt within 5-min tolerance validates."""
        near_future = (datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat()
        obj = IncidentCreateRequest(
            latitude=14.5995, longitude=120.9842, notification_dt=near_future
        )
        assert obj.notification_dt == near_future

    def test_notification_dt_beyond_tolerance_invalid(self):
        """notification_dt beyond 5-min future tolerance raises ValidationError."""
        far_future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        with pytest.raises(ValidationError):
            IncidentCreateRequest(latitude=14.5995, longitude=120.9842, notification_dt=far_future)

    def test_notification_dt_none_valid(self):
        """notification_dt=None is accepted (optional field)."""
        obj = IncidentCreateRequest(latitude=14.5995, longitude=120.9842)
        assert obj.notification_dt is None

    # ─── Unknown/bad date format ──────────────────────────────────────────

    def test_notification_dt_invalid_format_rejected(self):
        """notification_dt with non-ISO format raises ValidationError."""
        with pytest.raises(ValidationError):
            IncidentCreateRequest(
                latitude=14.5995, longitude=120.9842, notification_dt="not-a-date"
            )

    # ─── Valid minimal create ─────────────────────────────────────────────

    def test_minimal_valid(self):
        """Minimal valid IncidentCreateRequest passes."""
        obj = IncidentCreateRequest(latitude=14.5995, longitude=120.9842)
        assert obj.latitude == 14.5995
        assert obj.longitude == 120.9842
        assert obj.civilian_injured == 0  # default

    @pytest.mark.parametrize(
        "field",
        [
            "region_id",
            "specific_type",
            "occupancy_type",
            "city_id",
            "responder_type",
            "fire_origin",
            "extent_of_damage",
            "stage_of_fire",
            "province_district",
            "city_municipality",
            "barangay",
            "incident_type_code",
            "parent_incident_id",
            "owner_name",
            "occupant_name",
            "receiver_name",
            "prepared_by_officer",
            "noted_by_officer",
            "remarks",
            "client_id",
        ],
    )
    def test_optional_fields_accept_none(self, field):
        """Optional fields accept None."""
        kwargs = {"latitude": 14.5995, "longitude": 120.9842, field: None}
        obj = IncidentCreateRequest(**kwargs)
        assert getattr(obj, field) is None


# ═══════════════════════════════════════════════════════════════════════════
# IncidentUpdateRequest
# ═══════════════════════════════════════════════════════════════════════════


class TestIncidentUpdateRequest:
    """IncidentUpdateRequest validation bounds."""

    # ─── Coordinate bounds (all optional) ─────────────────────────────────

    @pytest.mark.parametrize("lat", [-90, 0, 14.5995, 90])
    def test_latitude_valid(self, lat):
        obj = IncidentUpdateRequest(latitude=lat)
        assert obj.latitude == lat

    @pytest.mark.parametrize("lat", [-90.1, -100, 90.1, 999])
    def test_latitude_invalid(self, lat):
        with pytest.raises(ValidationError):
            IncidentUpdateRequest(latitude=lat)

    @pytest.mark.parametrize("lon", [-180, 0, 120.9842, 180])
    def test_longitude_valid(self, lon):
        obj = IncidentUpdateRequest(longitude=lon)
        assert obj.longitude == lon

    @pytest.mark.parametrize("lon", [-180.1, -200, 180.1, 999])
    def test_longitude_invalid(self, lon):
        with pytest.raises(ValidationError):
            IncidentUpdateRequest(longitude=lon)

    def test_coordinates_none_valid(self):
        """Coordinates are optional in update request."""
        obj = IncidentUpdateRequest()
        assert obj.latitude is None
        assert obj.longitude is None

    # ─── Non-negative numeric fields (all optional) ───────────────────────

    @pytest.mark.parametrize(
        "field,valid",
        [
            ("civilian_injured", [0, 1]),
            ("civilian_deaths", [0, 5]),
            ("firefighter_injured", [0, 3]),
            ("firefighter_deaths", [0, 1]),
            ("families_affected", [0, 100]),
            ("structures_affected", [0, 50]),
            ("households_affected", [0, 100]),
            ("individuals_affected", [0, 500]),
            ("vehicles_affected", [0, 20]),
        ],
    )
    def test_non_negative_numeric_valid(self, field, valid):
        for val in valid:
            obj = IncidentUpdateRequest(**{field: val})
            assert getattr(obj, field) == val

    @pytest.mark.parametrize(
        "field",
        [
            "civilian_injured",
            "civilian_deaths",
            "firefighter_injured",
            "firefighter_deaths",
            "families_affected",
            "structures_affected",
            "households_affected",
            "individuals_affected",
            "vehicles_affected",
        ],
    )
    def test_non_negative_numeric_invalid(self, field):
        with pytest.raises(ValidationError):
            IncidentUpdateRequest(**{field: -1})

    @pytest.mark.parametrize(
        "field",
        [
            "estimated_damage_php",
            "distance_from_station_km",
        ],
    )
    def test_non_negative_float_invalid(self, field):
        with pytest.raises(ValidationError):
            IncidentUpdateRequest(**{field: -0.1})

    def test_total_response_time_minutes_invalid(self):
        with pytest.raises(ValidationError):
            IncidentUpdateRequest(total_response_time_minutes=-1)

    # ─── String max_length ────────────────────────────────────────────────

    @pytest.mark.parametrize(
        "field,limit",
        [
            ("alarm_level", 255),
            ("general_category", 255),
            ("sub_category", 255),
            ("fire_station_name", 255),
            ("caller_name", 255),
            ("caller_number", 255),
            ("establishment_name", 255),
            ("street_address", 255),
            ("landmark", 255),
            ("recommendations", 2000),
            ("narrative_report", 10000),
        ],
    )
    def test_string_max_length_invalid(self, field, limit):
        with pytest.raises(ValidationError):
            IncidentUpdateRequest(**{field: "x" * (limit + 1)})

    # ─── Semantic date validation ─────────────────────────────────────────

    def test_notification_dt_beyond_tolerance_invalid(self):
        far_future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        with pytest.raises(ValidationError):
            IncidentUpdateRequest(notification_dt=far_future)

    def test_notification_dt_within_tolerance_valid(self):
        near_future = (datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat()
        obj = IncidentUpdateRequest(notification_dt=near_future)
        assert obj.notification_dt == near_future

    # ─── Empty update should always pass ──────────────────────────────────

    def test_empty_update_valid(self):
        """An empty IncidentUpdateRequest (no fields) passes."""
        obj = IncidentUpdateRequest()
        assert obj.force_update is False

    def test_force_update_flag(self):
        """force_update defaults to False."""
        obj = IncidentUpdateRequest()
        assert obj.force_update is False
        obj2 = IncidentUpdateRequest(force_update=True)
        assert obj2.force_update is True
