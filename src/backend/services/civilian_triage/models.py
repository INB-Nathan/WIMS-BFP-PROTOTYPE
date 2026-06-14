"""Pydantic contracts for civilian triage routes and workflow modules."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class BulkPromoteRequest(BaseModel):
    report_ids: list[int]


class ClusterClaimRequest(BaseModel):
    reason: str | None = None


class ClusterActivityRequest(BaseModel):
    action: str = "REFRESH"
    note: str | None = None


class TerminalActionRequest(BaseModel):
    report_ids: list[int]
    status: str
    status_explanation: str
    internal_note: str | None = None


class CorrectionRequest(BaseModel):
    status: str
    status_explanation: str
    correction_reason: str


class ClusterSplitRequest(BaseModel):
    report_ids: list[int]
    internal_note: str


class ClusterMergeRequest(BaseModel):
    source_cluster_id: int
    internal_note: str


class WorkflowResult(BaseModel):
    status: str
    report_ids: list[int] = []
    cluster_id: int | None = None
    new_cluster_id: int | None = None
    updated: int = 0


class MergeCandidate(BaseModel):
    cluster_id: int
    anchor_report_id: int
    distance_m: float
    minutes_apart: float
    status: str
    member_count: int


class MergeCandidateResponse(BaseModel):
    cluster_id: int
    candidates: list[MergeCandidate]


class ClusterClaimResponse(BaseModel):
    cluster_id: int
    status: str
    assigned_to: str | None
    assigned_to_user_id: str | None
    review_started_at: datetime | None
    updated_at: datetime | None
    claim_is_stale: bool


class ClusterActivityEntry(BaseModel):
    event_type: str
    occurred_at: datetime | None
    actor_user_id: str | None = None
    actor_username: str | None = None
    report_id: int | None = None
    previous_status: str | None = None
    new_status: str | None = None
    note: str | None = None


class ClusterActivityResponse(BaseModel):
    cluster_id: int
    events: list[ClusterActivityEntry]


class TrustBreakdown(BaseModel):
    score: int
    included_signals: list[str]
    missing_signals: list[str]
    gps_mismatch: bool
    duplicate_device_count_30m: int


class StationContext(BaseModel):
    name: str | None
    distance_m: float | None
    phone_available: bool


class FollowupSummary(BaseModel):
    followup_id: int
    followup_text: str
    created_at: datetime


class TriageReportEntry(BaseModel):
    report_id: int
    latitude: float
    longitude: float
    category: str | None
    sub_category: str | None
    reporting_context: str | None
    safety_status: str | None
    status: str
    status_explanation: str | None
    trust_breakdown: TrustBreakdown
    severity: str  # HIGH | MEDIUM | LOW
    related_count: int  # reports within 100m / 1hr (excl. self)
    linked_count: int
    created_at: datetime
    reported_at: datetime | None
    is_aging: bool  # > 60 min
    is_timeout_risk: bool  # > 90 min
    is_danger: bool  # > 120 min — validator has taken no action
    previous_report_id: int | None
    station: StationContext
    followups: list[FollowupSummary] = []


class TriageClusterEntry(BaseModel):
    cluster_id: int | None  # null for ungrouped singleton entries
    anchor_report_id: int | None
    cluster_status: str | None
    assigned_to: str | None  # user display name
    review_started_at: datetime | None
    member_count: int
    has_life_safety: bool
    severity: str
    avg_trust: float
    oldest_report_at: datetime
    is_aging: bool
    is_timeout_risk: bool
    is_danger: bool  # cluster has any member > 120 min with no validator action
    related_count: int  # total suggested in 100m/1hr window
    reports: list[TriageReportEntry]
    station: StationContext


class TriageQueueResponse(BaseModel):
    clusters: list[TriageClusterEntry]
    polled_at: datetime
    total_reports: int
