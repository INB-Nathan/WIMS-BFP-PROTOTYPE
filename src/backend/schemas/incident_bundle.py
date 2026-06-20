"""Typed Pydantic schemas for incident bundle upload (POST /api/incidents/upload-bundle).

Replaces the previous ``Annotated[dict[str, Any], Body(...)]`` trust-boundary body
with a backward-compatible typed model.  The schema mirrors the existing online/offline
payload shape so that frontend callers and offline queue entries continue to work
without changes.

Field validators enforce:
  - Coordinate bounds (–90/90 lat, –180/180 lon)
  - Non-negative numeric fields (structures_affected, households_affected, …)
  - String max-length limits (per DB column widths)
  - ISO-8601 date string format for client-supplied timestamps
  - UUID format for client_id
  - Max nested JSON depth on ``resources_deployed`` and ``alarm_timeline``
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Annotated, Any, Optional
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field, field_validator


# ---------------------------------------------------------------------------
# Reusable type aliases — coerce JSON ``null`` to a safe default
# ---------------------------------------------------------------------------


def _zero(v: Any) -> Any:
    """Coerce ``None`` → 0 (same as legacy ``_safe_int`` / ``_safe_float``)."""
    return 0 if v is None else v


def _blank(v: Any) -> str:
    """Coerce ``None`` → ``""``."""
    return "" if v is None else v


def _empty_dict(v: Any) -> dict:
    """Coerce ``None`` → ``{}``."""
    return {} if v is None else v


def _empty_list(v: Any) -> list:
    """Coerce ``None`` → ``[]``."""
    return [] if v is None else v


DefaultZeroInt = Annotated[int, BeforeValidator(_zero)]
DefaultZeroFloat = Annotated[float, BeforeValidator(_zero)]
DefaultBlankStr = Annotated[str, BeforeValidator(_blank)]
DefaultEmptyDict = Annotated[dict, BeforeValidator(_empty_dict)]
DefaultEmptyList = Annotated[list, BeforeValidator(_empty_list)]


# ---------------------------------------------------------------------------
# Nested JSON depth guard
# ---------------------------------------------------------------------------

_MAX_JSON_DEPTH = int(os.getenv("WIMS_MAX_JSON_DEPTH", "10"))


def _check_json_depth(obj: Any, field_name: str, _current: int = 0, _path: str = "") -> None:
    """Recursively validate that *obj* does not exceed ``WIMS_MAX_JSON_DEPTH``.

    Depth is counted as the number of nested containers (dict or list).
    A flat ``{"a": 1}`` has depth 1; ``{"a": {"b": 1}}`` has depth 2.
    """
    if isinstance(obj, (dict, list)):
        _current += 1
        if _current > _MAX_JSON_DEPTH:
            raise ValueError(
                f"Max JSON depth ({_MAX_JSON_DEPTH}) exceeded in `{field_name}`{_path}"
            )
        if isinstance(obj, dict):
            for v in obj.values():
                _check_json_depth(v, field_name, _current, _path)
        else:
            for v in obj:
                _check_json_depth(v, field_name, _current, _path)


# ---------------------------------------------------------------------------
# Non-sensitive bundle incident details
# ---------------------------------------------------------------------------


class BundleNonsensitiveDetails(BaseModel):
    """Sub-dict ``incident_nonsensitive_details`` inside each bundle item.

    All fields have safe defaults to match the legacy ``_safe_int`` /
    ``_safe_float`` behaviour when JSON keys are missing or ``null``.
    """

    incident_type_code: Optional[str] = None
    city_id: Optional[int] = None
    notification_dt: Optional[str] = None
    alarm_level: DefaultBlankStr = ""
    general_category: DefaultBlankStr = ""
    sub_category: DefaultBlankStr = ""
    responder_type: DefaultBlankStr = ""
    fire_origin: DefaultBlankStr = ""
    extent_of_damage: DefaultBlankStr = ""
    structures_affected: DefaultZeroInt = 0
    households_affected: DefaultZeroInt = 0
    families_affected: DefaultZeroInt = 0
    individuals_affected: DefaultZeroInt = 0
    vehicles_affected: DefaultZeroInt = 0
    total_response_time_minutes: DefaultZeroInt = 0
    total_gas_consumed_liters: DefaultZeroFloat = 0.0
    resources_deployed: DefaultEmptyDict = {}
    alarm_timeline: DefaultEmptyDict = {}
    problems_encountered: DefaultEmptyList = []
    recommendations: DefaultBlankStr = ""
    fire_station_name: DefaultBlankStr = ""
    stage_of_fire: DefaultBlankStr = ""
    extent_total_floor_area_sqm: Optional[float] = None
    extent_total_land_area_hectares: Optional[float] = None
    distance_to_fire_scene_km: Optional[float] = None
    distance_from_station_km: Optional[float] = None
    city_municipality: DefaultBlankStr = ""
    province_district: DefaultBlankStr = ""
    barangay: DefaultBlankStr = ""
    extent_description: Optional[str] = None
    extent_objects_count: DefaultZeroInt = 0
    general_description_of_involved: Optional[str] = None
    other_personnel: DefaultEmptyList = []
    incident_address: DefaultBlankStr = ""
    nearest_landmark: DefaultBlankStr = ""
    estimated_damage_php: Optional[float] = None

    # ── Coerce empty notification_dt strings to None ────────────────────
    @field_validator("notification_dt")
    @classmethod
    def _coerce_notification_dt(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        stripped = v.strip()
        return stripped if stripped else None

    # ── JSON depth guard ────────────────────────────────────────────────
    @field_validator("resources_deployed", "alarm_timeline")
    @classmethod
    def _guard_depth(cls, v: dict, info: Any) -> dict:
        if isinstance(v, dict):
            _check_json_depth(v, info.field_name)
        return v

    # ── Non-negative numeric fields ─────────────────────────────────────
    @field_validator(
        "structures_affected",
        "households_affected",
        "families_affected",
        "individuals_affected",
        "vehicles_affected",
        "total_response_time_minutes",
        "extent_objects_count",
    )
    @classmethod
    def _non_negative_int(cls, v: int) -> int:
        if v < 0:
            raise ValueError(f"Value must be non-negative, got {v}")
        return v

    @field_validator("total_gas_consumed_liters")
    @classmethod
    def _non_negative_float(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"Value must be non-negative, got {v}")
        return v

    # ── String max lengths ──────────────────────────────────────────────
    @field_validator(
        "alarm_level",
        "general_category",
        "sub_category",
        "responder_type",
        "stage_of_fire",
        "incident_type_code",
    )
    @classmethod
    def _short_string(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 100:
            raise ValueError("String exceeds max length of 100 chars")
        return v

    @field_validator(
        "fire_origin",
        "extent_of_damage",
        "fire_station_name",
        "city_municipality",
        "province_district",
        "barangay",
        "incident_address",
        "nearest_landmark",
    )
    @classmethod
    def _medium_string(cls, v: str) -> str:
        if len(v) > 500:
            raise ValueError("String exceeds max length of 500 chars")
        return v

    @field_validator(
        "recommendations",
        "extent_description",
        "general_description_of_involved",
    )
    @classmethod
    def _long_string(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 2000:
            raise ValueError("String exceeds max length of 2000 chars")
        return v


# ---------------------------------------------------------------------------
# Sensitive bundle incident details
# ---------------------------------------------------------------------------


class BundleSensitiveDetails(BaseModel):
    """Sub-dict ``incident_sensitive_details`` inside each bundle item."""

    caller_name: Optional[str] = None
    caller_number: Optional[str] = None
    owner_name: Optional[str] = None
    occupant_name: Optional[str] = None
    receiver_name: DefaultBlankStr = ""
    establishment_name: DefaultBlankStr = ""
    narrative_report: Optional[str] = None
    disposition: DefaultBlankStr = ""
    prepared_by_officer: Optional[str] = None
    noted_by_officer: Optional[str] = None
    disposition_prepared_by: Optional[str] = None
    disposition_noted_by: Optional[str] = None
    personnel_on_duty: DefaultEmptyDict = {}
    street_address: DefaultBlankStr = ""
    landmark: DefaultBlankStr = ""
    casualty_details: Optional[dict] = None
    is_icp_present: bool = False
    icp_location: DefaultBlankStr = ""

    # ── String max lengths ──────────────────────────────────────────────
    @field_validator(
        "caller_name",
        "caller_number",
        "owner_name",
        "occupant_name",
        "receiver_name",
        "establishment_name",
        "prepared_by_officer",
        "noted_by_officer",
        "disposition_prepared_by",
        "disposition_noted_by",
        "icp_location",
    )
    @classmethod
    def _medium_string(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 500:
            raise ValueError("String exceeds max length of 500 chars")
        return v

    @field_validator("narrative_report", "disposition", "street_address", "landmark")
    @classmethod
    def _long_string(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 2000:
            raise ValueError("String exceeds max length of 2000 chars")
        return v


# ---------------------------------------------------------------------------
# Single bundle incident item
# ---------------------------------------------------------------------------


class BundleIncidentItem(BaseModel):
    """One incident entry inside the ``incidents`` array."""

    client_id: Optional[str] = None
    longitude: DefaultZeroFloat = 0.0
    latitude: DefaultZeroFloat = 0.0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    incident_nonsensitive_details: BundleNonsensitiveDetails = Field(
        default_factory=BundleNonsensitiveDetails
    )
    incident_sensitive_details: BundleSensitiveDetails = Field(
        default_factory=BundleSensitiveDetails
    )

    # ── Coordinate bounds ───────────────────────────────────────────────
    @field_validator("latitude")
    @classmethod
    def _lat_bounds(cls, v: float) -> float:
        if v < -90 or v > 90:
            raise ValueError(f"latitude must be between -90 and 90, got {v}")
        return v

    @field_validator("longitude")
    @classmethod
    def _lon_bounds(cls, v: float) -> float:
        if v < -180 or v > 180:
            raise ValueError(f"longitude must be between -180 and 180, got {v}")
        return v

    # ── client_id UUID validation ───────────────────────────────────────
    @field_validator("client_id")
    @classmethod
    def _client_id_uuid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            stripped = v.strip()
            if not stripped:
                return None
            try:
                UUID(stripped)
            except (ValueError, AttributeError):
                raise ValueError(f"client_id must be a valid UUID, got {v!r}")
            return stripped
        return v

    # ── ISO-8601 timestamp validation ────────────────────────────────────
    @field_validator("created_at", "updated_at")
    @classmethod
    def _iso_timestamp(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not isinstance(v, str) or not v.strip():
            return None
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            # Treat naive timestamps as UTC (common client/offline payload case)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            # Clamp to current UTC time (same as legacy _parse_client_ts)
            now_utc = datetime.now(timezone.utc)
            if dt > now_utc:
                return now_utc.isoformat()
            return dt.isoformat()
        except (ValueError, OverflowError, TypeError):
            raise ValueError(f"Invalid ISO-8601 timestamp: {v!r}")


# ---------------------------------------------------------------------------
# Top-level bundle request body
# ---------------------------------------------------------------------------


class IncidentBundleCreate(BaseModel):
    """Typed body for ``POST /api/incidents/upload-bundle``.

    Replaces the prior ``Annotated[dict[str, Any], Body(...)]`` trust-boundary
    body while preserving backward compatibility with existing callers.
    """

    incidents: list[BundleIncidentItem] = Field(..., min_length=1)
    region_id: Optional[int] = None

    @field_validator("incidents")
    @classmethod
    def _count_cap(cls, v: list) -> list:
        _max = int(os.getenv("WIMS_MAX_BUNDLE_SIZE", "200"))
        if len(v) > _max:
            raise ValueError(f"Bundle exceeds maximum of {_max} incidents per request.")
        return v
