"""Pydantic schemas for the Regional Encoder / National Validator API."""

from __future__ import annotations

import uuid as _uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator


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


class IncidentCreateRequest(BaseModel):
    """Create a new fire incident with nonsensitive + optional sensitive details."""

    latitude: float
    longitude: float
    region_id: int | None = None
    notification_dt: str | None = None
    alarm_level: str | None = None
    general_category: str | None = None
    sub_category: str | None = None
    specific_type: str | None = None
    occupancy_type: str | None = None
    city_id: int | None = None
    distance_from_station_km: float | None = None
    estimated_damage_php: float | None = None
    civilian_injured: int = 0
    civilian_deaths: int = 0
    firefighter_injured: int = 0
    firefighter_deaths: int = 0
    families_affected: int = 0
    structures_affected: int = 0
    households_affected: int = 0
    individuals_affected: int = 0
    responder_type: str | None = None
    fire_origin: str | None = None
    extent_of_damage: str | None = None
    stage_of_fire: str | None = None
    fire_station_name: str | None = None
    total_response_time_minutes: int | None = None
    recommendations: str | None = None
    province_district: str | None = None
    city_municipality: str | None = None
    barangay: str | None = None
    incident_type_code: str | None = None
    parent_incident_id: int | None = None
    street_address: str | None = None
    landmark: str | None = None
    caller_name: str | None = None
    caller_number: str | None = None
    narrative_report: str | None = None
    owner_name: str | None = None
    occupant_name: str | None = None
    establishment_name: str | None = None
    receiver_name: str | None = None
    prepared_by_officer: str | None = None
    noted_by_officer: str | None = None
    remarks: str | None = None


class IncidentUpdateRequest(BaseModel):
    """Update an existing DRAFT/PENDING incident."""

    notification_dt: str | None = None
    alarm_level: str | None = None
    general_category: str | None = None
    sub_category: str | None = None
    specific_type: str | None = None
    occupancy_type: str | None = None
    city_id: int | None = None
    distance_from_station_km: float | None = None
    estimated_damage_php: float | None = None
    civilian_injured: int | None = None
    civilian_deaths: int | None = None
    firefighter_injured: int | None = None
    firefighter_deaths: int | None = None
    families_affected: int | None = None
    structures_affected: int | None = None
    households_affected: int | None = None
    individuals_affected: int | None = None
    responder_type: str | None = None
    fire_origin: str | None = None
    extent_of_damage: str | None = None
    extent_total_floor_area_sqm: float | None = None
    extent_total_land_area_hectares: float | None = None
    stage_of_fire: str | None = None
    general_description_of_involved: str | None = None
    fire_station_name: str | None = None
    total_response_time_minutes: int | None = None
    vehicles_affected: int | None = None
    recommendations: str | None = None
    province_district: str | None = None
    city_municipality: str | None = None
    barangay: str | None = None
    incident_type_code: str | None = None
    street_address: str | None = None
    landmark: str | None = None
    caller_name: str | None = None
    caller_number: str | None = None
    narrative_report: str | None = None
    owner_name: str | None = None
    occupant_name: str | None = None
    establishment_name: str | None = None
    receiver_name: str | None = None
    prepared_by_officer: str | None = None
    noted_by_officer: str | None = None
    remarks: str | None = None
    alarm_timeline: dict | None = None
    resources_deployed: dict | None = None
    problems_encountered: list | None = None
    other_personnel: list | None = None
    personnel_on_duty: dict | None = None
    casualty_details: dict | None = None
    disposition: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    client_updated_at: datetime | None = None
    force_update: bool = False


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
