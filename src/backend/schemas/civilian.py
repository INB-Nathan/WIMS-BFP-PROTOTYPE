"""Civilian report API schemas — Zero-Trust Public Portal."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

import math


CitizenCategory = Literal["STRUCTURAL", "NON_STRUCTURAL", "TRANSPORTATION", "UNSURE"]
ReportingContext = Literal["WITNESS", "NEARBY", "SECONDHAND"]
SafetyStatus = Literal["I_AM_SAFE", "I_NEED_HELP", "SOMEONE_ELSE_NEEDS_HELP", "UNKNOWN"]


class CivilianReportCreate(BaseModel):
    """Request body for POST /api/civilian/reports (no auth)."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    category: CitizenCategory
    sub_category: str | None = Field(default=None, max_length=120)
    reported_at: datetime | None = None
    device_id: str | None = Field(default=None, max_length=128)
    reporting_context: ReportingContext = "WITNESS"
    safety_status: SafetyStatus = "UNKNOWN"
    phone_latitude: float | None = Field(default=None, ge=-90, le=90)
    phone_longitude: float | None = Field(default=None, ge=-180, le=180)
    gps_distance_m: float | None = Field(default=None, ge=0)
    gps_warning_confirmed: bool = False
    witness_name: str | None = Field(default=None, max_length=160)
    witness_phone: str | None = Field(default=None, max_length=80)
    previous_report_id: int | None = Field(default=None, gt=0)
    source_url: str | None = Field(default=None, max_length=2048)
    client_report_id: str | None = Field(default=None, max_length=128)


class CivilianReportAppend(BaseModel):
    """Request body for PATCH /api/civilian/reports/{report_id}/append."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    category: CitizenCategory
    sub_category: str | None = Field(default=None, max_length=120)
    reported_at: datetime | None = None
    device_id: str | None = Field(default=None, max_length=128)
    reporting_context: ReportingContext
    safety_status: SafetyStatus = "UNKNOWN"
    phone_latitude: float | None = Field(default=None, ge=-90, le=90)
    phone_longitude: float | None = Field(default=None, ge=-180, le=180)
    gps_distance_m: float | None = Field(default=None, ge=0)
    gps_warning_confirmed: bool = False
    witness_name: str | None = Field(default=None, max_length=160)
    witness_phone: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=1000)


class CivilianReportResponse(BaseModel):
    """Response body for created civilian report."""

    report_id: int
    latitude: float
    longitude: float
    category: str | None = None
    sub_category: str | None = None
    reporting_context: str | None = None
    safety_status: str | None = None
    witness_name: str | None = None
    witness_phone: str | None = None
    trust_score: int
    status: str
    status_explanation: str | None = None
    guidance: str | None = None
    escalation_guidance: str | None = None
    related_cluster_status: str | None = None
    previous_report_id: int | None = None
    nearest_station_name: str | None = None
    nearest_station_phone: str | None = None
    routing_distance_m: float | None = None
    routing_duration_s: float | None = None
    routing_data_source: str | None = None
    photo_count: int = 0
    submitter_type: str = "anonymous"
    tracking_token: str | None = None
    tracking_url: str | None = None
    link_count: int = 0
    created_at: datetime


class CivilianReportTimelineItem(BaseModel):
    report_id: int
    status: str
    category: str | None = None
    sub_category: str | None = None
    safety_status: str | None = None
    reporting_context: str | None = None
    status_explanation: str | None = None
    created_at: datetime
    description: str | None = None


class CivilianReportTimelineResponse(BaseModel):
    report_id: int
    timeline: list[CivilianReportTimelineItem]
    followups: list[CivilianFollowupItem] = []


class DuplicateSuggestionItem(BaseModel):
    report_id: int
    distance_m: float
    category: str | None = None
    sub_category: str | None = None
    safety_status: str | None = None
    status: str
    created_at: datetime
    nearest_station_name: str | None = None


class DuplicateSuggestionResponse(BaseModel):
    suggestions: list[DuplicateSuggestionItem]


class NotifyRegisterRequest(BaseModel):
    """Body for POST /api/civilian/reports/{report_id}/notify."""

    device_id: str = Field(..., min_length=1, max_length=128)
    fcm_token: str = Field(..., min_length=1, max_length=4096)


class NotifyRegisterResponse(BaseModel):
    """Response for notification registration."""

    status: str  # "registered" | "already_registered"
    report_id: int


class MyReportItem(BaseModel):
    """A single report belonging to the requesting device."""

    report_id: int
    category: str | None = None
    sub_category: str | None = None
    status: str
    safety_status: str | None = None
    created_at: datetime
    latitude: float
    longitude: float


class MyReportResponse(BaseModel):
    """Response body for GET /api/civilian/reports — the device's own report history."""

    reports: list[MyReportItem]


class ReportClusterCenter(BaseModel):
    """Anchor used for the public report-area query."""

    latitude: float
    longitude: float


class ReportClusterArea(BaseModel):
    """A public-safe area of recent civilian report pressure."""

    area_id: str
    latitude: float
    longitude: float
    radius_m: int
    count_bucket: str
    age_bucket: str


class CivilianFollowupCreate(BaseModel):
    """Request body for POST /api/civilian/reports/{report_id}/followup — no auth."""

    device_id: str = Field(..., min_length=1, max_length=128)
    followup_text: str = Field(..., min_length=1, max_length=2000)


class CivilianFollowupItem(BaseModel):
    """A single follow-up entry returned in timeline / triage context."""

    followup_id: int
    followup_text: str
    created_at: datetime


class CivilianFollowupResponse(BaseModel):
    """Response body for successful follow-up submission."""

    followup_id: int
    report_id: int
    followup_text: str
    created_at: datetime


class ReportClusterResponse(BaseModel):
    """Response body for GET /api/civilian/report-clusters."""

    mode: str
    center: ReportClusterCenter | None = None
    radius_m: int | None = None
    window_minutes: int = 60
    min_reports: int
    truncated: bool = False
    stale: bool = False
    degraded: bool = False
    areas: list[ReportClusterArea]


class BrowserGPSFields(BaseModel):
    """Optional browser GPS fields for photo upload.

    All-or-none validation: if any field is provided, all four are required.
    """

    browser_gps_lat: float | None = None
    browser_gps_lon: float | None = None
    browser_gps_accuracy: float | None = None
    browser_gps_captured_at: datetime | None = None

    @field_validator("browser_gps_lat")
    @classmethod
    def _check_lat_range(cls, v: float | None) -> float | None:
        if v is not None and not (-90 <= v <= 90):
            raise ValueError("browser_gps_lat must be in [-90, 90]")
        return v

    @field_validator("browser_gps_lon")
    @classmethod
    def _check_lon_range(cls, v: float | None) -> float | None:
        if v is not None and not (-180 <= v <= 180):
            raise ValueError("browser_gps_lon must be in [-180, 180]")
        return v

    @field_validator("browser_gps_accuracy")
    @classmethod
    def _check_accuracy(cls, v: float | None) -> float | None:
        if v is not None:
            if math.isnan(v) or math.isinf(v):
                raise ValueError("browser_gps_accuracy must be finite")
            if v < 0:
                raise ValueError("browser_gps_accuracy must be >= 0")
        return v

    @field_validator("browser_gps_captured_at")
    @classmethod
    def _check_timestamp(cls, v: datetime | None) -> datetime | None:
        if v is not None:
            if v.tzinfo is None:
                raise ValueError("browser_gps_captured_at must be timezone-aware")
        return v

    @model_validator(mode="before")
    @classmethod
    def check_all_or_none(cls, values: dict) -> dict:
        """Validate all-or-none: if any GPS field is set, all four must be set."""
        present = sum(
            1
            for f in (
                "browser_gps_lat",
                "browser_gps_lon",
                "browser_gps_accuracy",
                "browser_gps_captured_at",
            )
            if values.get(f) is not None
        )
        if present not in (0, 4):
            raise ValueError("Browser GPS fields must be all-or-none: provide all four or none")
        return values


class ContributorProfileResponse(BaseModel):
    """Registered contributor profile with trust score, badge, and lifetime stats."""

    trust_score: int
    badge: str
    total_reports: int
    actioned_reports: int
    pending_reports: int
    first_report_at: datetime | None = None
    last_report_at: datetime | None = None


class ContributorReportItem(BaseModel):
    """A single report entry in a contributor's paginated history."""

    report_id: int
    created_at: datetime
    category: str | None = None
    sub_category: str | None = None
    status: str
    latitude: float
    longitude: float


class ContributorReportsResponse(BaseModel):
    """Paginated contributor report history."""

    reports: list[ContributorReportItem]
    total: int
    page: int
    limit: int
    pages: int


class LeaderboardEntry(BaseModel):
    """A single entry on the contributor leaderboard."""

    rank: int
    user_id: str
    display_name: str | None = None
    trust_score: int
    badge: str
    report_count: int


class ContributorStatsResponse(BaseModel):
    """Contributor vanity metrics with monthly trend data."""

    trust_score: int
    badge: str
    total_reports: int
    actioned_reports: int
    pending_reports: int
    monthly_report_counts: list[dict] = []


class PhotoUploadResponse(BaseModel):
    """Response body for successful photo upload (201) or duplicate (200).

    When ``duplicate`` is True, ``photo_id`` is None because the INSERT
    was silently skipped (ON CONFLICT DO NOTHING). Fresh uploads always
    carry a non-null ``photo_id``.
    """

    photo_id: str | None = None
    report_id: int
    duplicate: bool = False
    file_size_bytes: int
    mime_type: str
    image_width: int
    image_height: int
    exif_gps_status: str
    browser_gps_status: str
    gps_consensus: str | None = None
    photo_reported_distance_m: float | None = None
