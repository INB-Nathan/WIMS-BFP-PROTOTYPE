"""Civilian triage policy constants and pure helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException

TERMINAL_REPORT_STATUSES = {
    "ACTIONED",
    "REJECTED_BOGUS",
    "REJECTED_DUPLICATE",
    "REJECTED_INSUFFICIENT",
    "REJECTED_TIMEOUT",
}

CLAIM_STALE_MINUTES = 10
AGING_MINUTES = 60
TIMEOUT_RISK_MINUTES = 90
DANGER_MINUTES = 120


@dataclass(frozen=True)
class TriagePolicy:
    """Single triage-policy interface for civilian-report proximity/time values.

    SQL callers bind these values as SQLAlchemy parameters so a policy change
    takes effect at every query seam without editing SQL text (issue #718).
    Distances are meters measured on PostGIS geography; time values use the
    unit named in the field (hours or seconds). Field semantics:

    related_report_radius_meters (meters):
        Neighborhood radius for the related-report seams — intake trust
        (api/routes/civilian.py _trust_score), duplicate suggestions
        (suggest_duplicate_reports), and queue projection
        (queue_projection.get_queue). All three test proximity with
        ST_DWithin on geography, which admits pairs at the boundary
        (distance <= radius).

    related_report_window_hours (hours):
        Time window for the same three seams, with seam-dependent direction:
        - Intake trust and duplicate suggestions use a ONE-SIDED LOOKBACK:
          ``created_at >= now() - make_interval(hours => ...)`` — only reports
          created within the last N hours count.
        - Queue projection uses a SYMMETRIC +/- window around each report's
          own created_at: ``r2.created_at`` between ``r.created_at - N hours``
          and ``r.created_at + N hours``.

    merge_candidate_radius_meters (meters):
        Radius for cluster merge candidate discovery
        (workflow.get_merge_candidates_command) and final merge revalidation
        (workflow.merge_clusters_command). Discovery uses ST_DWithin on
        geography (admits pairs at the boundary); final revalidation
        deliberately retains the PRE-EXISTING STRICT-DISTANCE BOUNDARY
        (``ST_Distance(...) < radius``, strictly less than), so a pair exactly
        at the radius is suggested but refused at merge time.

    merge_candidate_window_seconds (seconds):
        Symmetric time window for both merge seams:
        ``ABS(EXTRACT(EPOCH FROM (created_at difference))) <= window``.
        Unlike related_report_window_hours, there is no one-sided variant.

    gps_mismatch_meters (meters):
        GPS-consistency threshold. A report whose gps_distance_m is strictly
        greater than this value is flagged gps_mismatch; intake trust grants
        the +10 consistency signal only when gps_distance_m <= this value.
    """

    related_report_radius_meters: int = 100
    related_report_window_hours: int = 1
    merge_candidate_radius_meters: int = 250
    merge_candidate_window_seconds: int = 3600
    gps_mismatch_meters: int = 200


TRIAGE_POLICY = TriagePolicy()

__all__ = [
    "TERMINAL_REPORT_STATUSES",
    "CLAIM_STALE_MINUTES",
    "AGING_MINUTES",
    "TIMEOUT_RISK_MINUTES",
    "DANGER_MINUTES",
    "TriagePolicy",
    "TRIAGE_POLICY",
    "is_cluster_claim_stale",
    "validate_terminal_status",
    "severity",
    "aging_flags",
    "role_can_access_queue",
    "role_can_work_cluster",
    "role_can_take_over_claim",
    "role_can_correct_terminal",
]


def is_cluster_claim_stale(updated_at: datetime | None, now: datetime | None = None) -> bool:
    if updated_at is None:
        return True
    now = now or datetime.now(timezone.utc)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return (now - updated_at).total_seconds() >= CLAIM_STALE_MINUTES * 60


def validate_terminal_status(status: str) -> str:
    normalized = status.strip().upper()
    if normalized not in TERMINAL_REPORT_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported terminal status")
    return normalized


def severity(related_count: int, trust_score: int) -> str:
    neighborhood_size = related_count + 1
    if neighborhood_size >= 5 and trust_score >= 50:
        return "HIGH"
    if neighborhood_size >= 2 and trust_score >= 30:
        return "MEDIUM"
    return "LOW"


def aging_flags(created_at: datetime, now: datetime | None = None) -> tuple[bool, bool, bool]:
    now = now or datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    age_min = (now - created_at).total_seconds() / 60
    return (
        age_min > AGING_MINUTES,
        age_min > TIMEOUT_RISK_MINUTES,
        age_min > DANGER_MINUTES,
    )


def role_can_access_queue(role: str | None) -> bool:
    return role in ("REGIONAL_ENCODER", "NATIONAL_VALIDATOR")


def role_can_work_cluster(role: str | None) -> bool:
    return role in ("REGIONAL_ENCODER", "NATIONAL_VALIDATOR", "SYSTEM_ADMIN")


def role_can_take_over_claim(role: str | None) -> bool:
    return role in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN")


def role_can_correct_terminal(role: str | None) -> bool:
    return role in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN")
