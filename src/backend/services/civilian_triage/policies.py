"""Civilian triage policy constants and pure helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

TERMINAL_REPORT_STATUSES = {
    "ACTIONED",
    "REJECTED_BOGUS",
    "REJECTED_DUPLICATE",
    "REJECTED_INSUFFICIENT",
    "REJECTED_TIMEOUT",
}

# Singleton clusters (member_count <= 1) cannot be ACTIONED.
# ACTIONED requires multiple corroborating reports — a lone signal
# can only be rejected, not confirmed as actioned.
SINGLETON_TERMINAL_STATUSES = TERMINAL_REPORT_STATUSES - {"ACTIONED"}

CLAIM_STALE_MINUTES = 15
RELATED_REPORT_RADIUS_METERS = 100
RELATED_REPORT_WINDOW_HOURS = 1
MERGE_CANDIDATE_RADIUS_METERS = 250
MERGE_CANDIDATE_WINDOW_SECONDS = 3600
AGING_MINUTES = 60
TIMEOUT_RISK_MINUTES = 90
DANGER_MINUTES = 120
GPS_MISMATCH_METERS = 200


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


def validate_singleton_terminal_status(status: str, member_count: int) -> str:
    """Validate a terminal action on a cluster with limited members.

    Singleton clusters (member_count <= 1) can only use REJECTED_*
    statuses. ACTIONED requires multiple corroborating reports.
    """
    normalized = validate_terminal_status(status)
    if member_count <= 1 and normalized not in SINGLETON_TERMINAL_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="ACTIONED requires a cluster with multiple corroborating reports. "
            "Use REJECTED_* statuses for singleton reports.",
        )
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
