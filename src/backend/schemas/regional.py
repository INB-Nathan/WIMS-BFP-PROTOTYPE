"""Pydantic schemas for the Regional Encoder / National Validator API."""

from __future__ import annotations

import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from pydantic import BaseModel, Field, field_validator

# ─── Shared helpers (D4 string length tiers, D11 tolerance) ──────────────

_LABEL_MAX = 255  # D4: short labels / names / titles
_DESC_MAX = 2000  # D4: descriptions / notes / recommendations
_NARRATIVE_MAX = 10000  # D4: narratives / detailed reports
_ISO_DT_MAX = 40  # generous cap for ISO-8601 datetime strings

_D11_TOLERANCE_MINUTES = 5  # D11: clock-skew tolerance for occurrence/report dates

# ─── Type aliases for reprising Field(max_length=…) boilerplate (cf. incident_bundle.py) ──

LabelField = Annotated[str | None, Field(default=None, max_length=_LABEL_MAX)]
DescField = Annotated[str | None, Field(default=None, max_length=_DESC_MAX)]
NarrativeField = Annotated[str | None, Field(default=None, max_length=_NARRATIVE_MAX)]
IsoDtField = Annotated[str | None, Field(default=None, max_length=_ISO_DT_MAX)]


def _validate_not_future_date(value: str | None, field_name: str) -> str | None:
    """Validate that an ISO datetime string is not beyond `now() + tolerance` UTC.

    Per D11: occurrence/report dates cannot exceed now() + 5 minutes UTC.
    Scheduling/planning fields are whitelisted (handled per-schema).
    """
    if value is None:
        return value
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        raise ValueError(f"{field_name} must be a valid ISO-8601 datetime string, got: {value!r}")
    # Naive datetimes are treated as UTC (per D11 canonical time semantics)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    cutoff = datetime.now(timezone.utc) + timedelta(minutes=_D11_TOLERANCE_MINUTES)
    if dt > cutoff:
        raise ValueError(
            f"{field_name} must not be more than {_D11_TOLERANCE_MINUTES} minutes in the "
            f"future (got {value!r})"
        )
    return value


# =====================================================================
# Response schemas
# =====================================================================


class RegionalStatsResponse(BaseModel):
    total_incidents: int
    total_incidents_this_week: int = 0
    by_category: list[dict[str, Any]]
    by_alarm_level: list[dict[str, Any]]
    by_status: list[dict[str, Any]]
    wildland_total: int = 0
    by_wildland_type: list[dict[str, Any]] = []
    structures_affected: int = 0
    households_affected: int = 0
    families_affected: int = 0
    individuals_affected: int = 0
    vehicles_affected: int = 0


# =====================================================================
# IncidentCreateRequest
# =====================================================================


class IncidentCreateRequest(BaseModel):
    """Create a new fire incident with nonsensitive + optional sensitive details.

    Validation per D3 (byte limits), D4 (string max_length), D11 (time semantics).
    """

    # ── Coordinates (required, bounded) ────────────────────────────────────
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    # ── Numeric identifiers ────────────────────────────────────────────────
    region_id: int | None = None
    city_id: int | None = None
    parent_incident_id: int | None = None

    # ── Date / time (D11 — semantic future-date rejection) ─────────────────
    notification_dt: IsoDtField

    # ── String labels (D4: 255) ────────────────────────────────────────────
    alarm_level: LabelField
    general_category: LabelField
    sub_category: LabelField
    specific_type: LabelField
    occupancy_type: LabelField
    responder_type: LabelField
    fire_origin: LabelField
    extent_of_damage: LabelField
    stage_of_fire: LabelField
    fire_station_name: LabelField
    province_district: LabelField
    city_municipality: LabelField
    barangay: LabelField
    incident_type_code: LabelField
    street_address: LabelField
    landmark: LabelField
    caller_name: LabelField
    caller_number: LabelField
    establishment_name: LabelField
    owner_name: LabelField
    occupant_name: LabelField
    receiver_name: LabelField
    prepared_by_officer: LabelField
    noted_by_officer: LabelField

    # ── String descriptions / notes (D4: 2000) ────────────────────────────
    recommendations: DescField
    remarks: DescField

    # ── String narrative (D4: 10000) ──────────────────────────────────────
    narrative_report: NarrativeField

    # ── Non-negative numerics (counts) ─────────────────────────────────────
    civilian_injured: int = Field(default=0, ge=0)
    civilian_deaths: int = Field(default=0, ge=0)
    firefighter_injured: int = Field(default=0, ge=0)
    firefighter_deaths: int = Field(default=0, ge=0)
    families_affected: int = Field(default=0, ge=0)
    structures_affected: int = Field(default=0, ge=0)
    households_affected: int = Field(default=0, ge=0)
    individuals_affected: int = Field(default=0, ge=0)

    # ── Non-negative numerics (floats / optional) ──────────────────────────
    distance_from_station_km: float | None = Field(None, ge=0)
    estimated_damage_php: float | None = Field(None, ge=0)
    total_response_time_minutes: int | None = Field(None, ge=0)

    # ── Idempotency ───────────────────────────────────────────────────────
    client_id: LabelField

    # ── Validators ─────────────────────────────────────────────────────────

    @field_validator("notification_dt")
    @classmethod
    def validate_notification_dt(cls, v: str | None) -> str | None:
        """D11: notification/report date must not exceed now() + 5 min UTC."""
        return _validate_not_future_date(v, "notification_dt")


# =====================================================================
# IncidentUpdateRequest
# =====================================================================


class IncidentUpdateRequest(BaseModel):
    """Update an existing DRAFT/PENDING incident.

    All fields optional — partial updates are the norm.
    Validation per D3/D4/D11, mirroring IncidentCreateRequest bounds.
    """

    # ── Date / time (D11) ─────────────────────────────────────────────────
    notification_dt: IsoDtField

    # ── String labels (D4: 255) ────────────────────────────────────────────
    alarm_level: LabelField
    general_category: LabelField
    sub_category: LabelField
    specific_type: LabelField
    occupancy_type: LabelField
    responder_type: LabelField
    fire_origin: LabelField
    extent_of_damage: LabelField
    stage_of_fire: LabelField
    general_description_of_involved: DescField
    fire_station_name: LabelField
    province_district: LabelField
    city_municipality: LabelField
    barangay: LabelField
    incident_type_code: LabelField
    street_address: LabelField
    landmark: LabelField
    caller_name: LabelField
    caller_number: LabelField
    establishment_name: LabelField
    owner_name: LabelField
    occupant_name: LabelField
    receiver_name: LabelField
    prepared_by_officer: LabelField
    noted_by_officer: LabelField

    # ── String narrative (D4: 10000) ──────────────────────────────────────
    disposition: NarrativeField
    narrative_report: NarrativeField

    # ── String descriptions / notes (D4: 2000) ────────────────────────────
    recommendations: DescField
    remarks: DescField

    # ── Non-negative numerics (counts, optional) ───────────────────────────
    civilian_injured: int | None = Field(None, ge=0)
    civilian_deaths: int | None = Field(None, ge=0)
    firefighter_injured: int | None = Field(None, ge=0)
    firefighter_deaths: int | None = Field(None, ge=0)
    families_affected: int | None = Field(None, ge=0)
    structures_affected: int | None = Field(None, ge=0)
    households_affected: int | None = Field(None, ge=0)
    individuals_affected: int | None = Field(None, ge=0)
    vehicles_affected: int | None = Field(None, ge=0)

    # ── Non-negative numerics (floats / optional) ──────────────────────────
    distance_from_station_km: float | None = Field(None, ge=0)
    estimated_damage_php: float | None = Field(None, ge=0)
    extent_total_floor_area_sqm: float | None = None
    extent_total_land_area_hectares: float | None = None
    total_response_time_minutes: int | None = Field(None, ge=0)

    # ── Numeric identifiers ────────────────────────────────────────────────
    city_id: int | None = None

    # ── Coordinates (optional on update) ───────────────────────────────────
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)

    # ── Structured blobs (no deep validation — trusted server merge) ───────
    alarm_timeline: dict | None = None
    resources_deployed: dict | None = None
    problems_encountered: list | None = None
    other_personnel: list | None = None
    personnel_on_duty: dict | None = None
    casualty_details: dict | None = None

    # ── Sync / idempotency ─────────────────────────────────────────────────
    client_updated_at: datetime | None = None
    force_update: bool = False

    # ── Validators ─────────────────────────────────────────────────────────

    @field_validator("notification_dt")
    @classmethod
    def validate_notification_dt(cls, v: str | None) -> str | None:
        """D11: notification/report date must not exceed now() + 5 min UTC."""
        return _validate_not_future_date(v, "notification_dt")


# =====================================================================
# Verification / correction / admin schemas
# =====================================================================


class VerificationActionRequest(BaseModel):
    """Body for PATCH /api/regional/incidents/{incident_id}/verification."""

    action: str  # "accept" | "accept_replace" | "pending" | "reject"
    notes: str | None = None
    original_incident_id: int | None = None  # For accept_replace: ID to supersede
    client_id: str | None = None  # UUID from offline queue — idempotency key (#267)

    @field_validator("client_id")
    @classmethod
    def validate_client_id_uuid(cls, v: str | None) -> str | None:
        """Ensure client_id is a valid UUID string or None."""
        if v is None:
            return v
        try:
            _uuid.UUID(v)
        except (ValueError, AttributeError):
            raise ValueError(f"client_id must be a valid UUID, got: {v!r}")
        return v


class ClientIdRequest(BaseModel):
    """Optional idempotency key body for offline retryable validator actions."""

    client_id: str | None = None

    @field_validator("client_id")
    @classmethod
    def validate_client_id_uuid(cls, v: str | None) -> str | None:
        """Ensure client_id is a valid UUID string or None."""
        if v is None:
            return v
        try:
            _uuid.UUID(v)
        except (ValueError, AttributeError):
            raise ValueError(f"client_id must be a valid UUID, got: {v!r}")
        return v


class CorrectionRequest(BaseModel):
    """Body for PATCH /api/regional/incidents/{incident_id}/correct."""

    corrections: dict
    notes: str | None = None


class BulkApproveRequest(BaseModel):
    incident_ids: list[int]
    notes: str | None = None
