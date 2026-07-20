"""Privacy-minimized validator evidence workspace contracts."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from services.civilian_triage.models import ClusterActivityEntry


class EvidenceLocation(BaseModel):
    source: str
    available: bool
    latitude: float | None = None
    longitude: float | None = None
    accuracy_m: float | None = None
    approximate: bool = False
    distance_to_report_m: float | None = None


class WorkspacePhoto(BaseModel):
    photo_id: str
    content_url: str
    media_type: str
    image_width: int
    image_height: int
    capture_time: datetime | None = None
    exif_available: bool
    gps_consensus: str | None = None
    evidence_source: str | None = None
    image_to_report_distance_m: float | None = None
    device_to_exif_distance_m: float | None = None
    exif_location: EvidenceLocation


class ContributorCredibility(BaseModel):
    authenticated: bool
    trust_score: int | None = None
    badge: str | None = None
    total_reports: int | None = None
    actioned_reports: int | None = None
    pending_reports: int | None = None
    evidence_quality: float | None = None
    active_months: int | None = None


class WorkspaceFollowup(BaseModel):
    followup_id: int
    followup_text: str
    created_at: datetime


class WorkspaceStatusUpdate(BaseModel):
    update_id: int
    stage: str
    metadata: dict
    created_at: datetime


class WorkspaceReport(BaseModel):
    report_id: int
    category: str | None
    sub_category: str | None
    reporting_context: str | None
    safety_status: str | None
    status: str
    status_explanation: str | None
    description: str | None
    trust_score: int
    created_at: datetime
    reported_at: datetime | None
    previous_report_id: int | None
    report_location: EvidenceLocation
    device_location: EvidenceLocation
    ip_location: EvidenceLocation
    photos: list[WorkspacePhoto]
    contributor: ContributorCredibility
    followups: list[WorkspaceFollowup]
    feedback: list[WorkspaceStatusUpdate]
    contact_reveal_url: str


class WorkspaceCluster(BaseModel):
    cluster_id: int
    anchor_report_id: int
    status: str
    status_note: str | None
    assigned_to_user_id: str | None
    assigned_to: str | None
    review_started_at: datetime | None
    updated_at: datetime | None


class TriageWorkspaceResponse(BaseModel):
    cluster: WorkspaceCluster
    reports: list[WorkspaceReport]
    activity: list[ClusterActivityEntry]
    loaded_at: datetime


class ContactRevealResponse(BaseModel):
    report_id: int
    reporter_name: str
    reporter_phone: str | None
