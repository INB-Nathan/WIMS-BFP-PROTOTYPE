"""Triage Queue and Promotion Workflow — ENCODER/VALIDATOR only."""

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from database import get_db_with_rls
from services.analytics_read_model import sync_incident_to_analytics
from tasks.notifications import send_status_notification
from utils.audit import log_system_audit

router = APIRouter(prefix="/api/triage", tags=["triage"])
logger = logging.getLogger(__name__)


# ─── Schemas ─────────────────────────────────────────────────────────────────


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
    previous_report_id: int | None
    station: StationContext


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
    related_count: int  # total suggested in 100m/1hr window
    reports: list[TriageReportEntry]
    station: StationContext


class TriageQueueResponse(BaseModel):
    clusters: list[TriageClusterEntry]
    polled_at: datetime
    total_reports: int


TERMINAL_REPORT_STATUSES = {
    "ACTIONED",
    "REJECTED_BOGUS",
    "REJECTED_DUPLICATE",
    "REJECTED_INSUFFICIENT",
    "REJECTED_TIMEOUT",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _require_encoder_or_validator(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """Require REGIONAL_ENCODER or NATIONAL_VALIDATOR role."""
    role = current_user.get("role")
    if role not in ("REGIONAL_ENCODER", "NATIONAL_VALIDATOR"):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' does not have permission to access this resource",
        )
    return current_user


def _require_cluster_workflow_actor(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """Require a role that can participate in civilian cluster workflow."""
    role = current_user.get("role")
    if role not in ("REGIONAL_ENCODER", "NATIONAL_VALIDATOR", "SYSTEM_ADMIN"):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' does not have permission to access this resource",
        )
    return current_user


def _is_cluster_claim_stale(updated_at: datetime | None, now: datetime | None = None) -> bool:
    if updated_at is None:
        return True
    now = now or datetime.now(timezone.utc)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return (now - updated_at).total_seconds() >= 15 * 60


def _cluster_claim_response(row) -> ClusterClaimResponse:
    return ClusterClaimResponse(
        cluster_id=row[0],
        status=row[1],
        assigned_to=row[6],
        assigned_to_user_id=str(row[2]) if row[2] else None,
        review_started_at=(
            row[3].replace(tzinfo=timezone.utc) if row[3] and row[3].tzinfo is None else row[3]
        ),
        updated_at=(
            row[4].replace(tzinfo=timezone.utc) if row[4] and row[4].tzinfo is None else row[4]
        ),
        claim_is_stale=_is_cluster_claim_stale(row[4]),
    )


def _fetch_cluster_for_update(db: Session, cluster_id: int):
    return db.execute(
        text("""
            SELECT c.cluster_id, c.status, c.assigned_to, c.review_started_at,
                   c.updated_at, c.internal_note, u.username AS assigned_username
            FROM wims.citizen_report_clusters c
            LEFT JOIN wims.users u ON u.user_id = c.assigned_to
            WHERE c.cluster_id = :cid
            FOR UPDATE OF c
        """),
        {"cid": cluster_id},
    ).fetchone()


def _append_internal_note(existing: str | None, user_id: str, action: str, note: str) -> str:
    timestamp = datetime.now(timezone.utc).isoformat()
    entry = f"[{timestamp}] {action} by {user_id}: {note}"
    return f"{existing}\n{entry}" if existing else entry


def _ensure_cluster_claim(db: Session, cluster_id: int, user: dict) -> object:
    cluster = _fetch_cluster_for_update(db, cluster_id)
    if cluster is None:
        raise HTTPException(status_code=404, detail="Cluster not found")
    if cluster[1] == "CLUSTER_CLOSED":
        raise HTTPException(status_code=409, detail="Cluster is closed")
    if str(cluster[2]) != str(user["user_id"]):
        raise HTTPException(status_code=409, detail="Cluster must be claimed by the current user")
    if _is_cluster_claim_stale(cluster[4]):
        raise HTTPException(
            status_code=409, detail="Cluster claim is stale; refresh or reclaim before acting"
        )
    return cluster


def _validate_terminal_status(status: str) -> str:
    normalized = status.strip().upper()
    if normalized not in TERMINAL_REPORT_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported terminal status")
    return normalized


def _notify_reports(report_ids: list[int], status: str) -> None:
    for report_id in report_ids:
        _enqueue_status_notification(report_id, status)


def _enqueue_status_notification(report_id: int, status: str) -> None:
    try:
        send_status_notification.delay(report_id, status)
    except Exception:
        logger.exception(
            "Failed to enqueue status notification for report_id=%s status=%s",
            report_id,
            status,
        )


def _severity(related_count: int, trust_score: int) -> str:
    """Read-time severity per ADR:
    HIGH  — ≥5 reports in the 100m/1hr neighborhood, including this report,
             AND trust ≥50
    MEDIUM— ≥2 reports in the 100m/1hr neighborhood, including this report,
             AND trust ≥30
    LOW   — everything else"""
    neighborhood_size = related_count + 1
    if neighborhood_size >= 5 and trust_score >= 50:
        return "HIGH"
    if neighborhood_size >= 2 and trust_score >= 30:
        return "MEDIUM"
    return "LOW"


def _aging_flags(created_at: datetime) -> tuple[bool, bool]:
    now = datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    age_min = (now - created_at).total_seconds() / 60
    return age_min > 60, age_min > 90


def _build_station_context(row) -> StationContext:
    name = row[0]
    distance_m = row[1]
    phone = row[2]
    return StationContext(
        name=name,
        distance_m=float(distance_m) if distance_m is not None else None,
        phone_available=bool(phone and phone.strip()),
    )


def _build_trust_breakdown(
    has_category,
    has_sub_category,
    has_reported_at,
    has_device_id,
    has_witness_name,
    has_witness_phone,
    nearest_500m,
    nearest_2km,
    nearest_5km,
) -> TrustBreakdown:
    """Build trust breakdown from signal boolean columns."""
    included, missing = [], []
    if has_category:
        included.append("category")
    else:
        missing.append("category")
    if has_sub_category:
        included.append("sub_category")
    else:
        missing.append("sub_category")
    if has_reported_at:
        included.append("reported_at")
    else:
        missing.append("reported_at")
    if has_device_id:
        included.append("device_id")
    else:
        missing.append("device_id")
    if has_witness_name:
        included.append("witness_name")
    if has_witness_phone:
        included.append("witness_phone")
    if nearest_500m:
        included.append("station_500m")
    elif nearest_2km:
        included.append("station_2km")
    elif nearest_5km:
        included.append("station_5km")
    else:
        missing.append("station_proximity")

    return TrustBreakdown(
        score=0,  # set by caller
        included_signals=included,
        missing_signals=missing,
        gps_mismatch=False,  # set by caller
        duplicate_device_count_30m=0,
    )


# ─── GET /api/triage/queue ────────────────────────────────────────────────────


@router.get("/queue", response_model=TriageQueueResponse)
def get_triage_queue(
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    # Quick filters
    needs_help: bool = Query(False),
    someone_else_needs_help: bool = Query(False),
    aging: bool = Query(False),
    timeout_risk: bool = Query(False),
    confidence: str | None = Query(None),  # HIGH | MEDIUM | LOW
    unreviewed: bool = Query(False),
    claimed_by_me: bool = Query(False),
    actioned_today: bool = Query(False),
    rejected_today: bool = Query(False),
) -> TriageQueueResponse:
    """
    Cluster-oriented civilian report triage queue for validators.

    Grouping logic:
    - Reports that are explicit members of the same cluster are grouped together.
    - Reports without an explicit cluster appear as singleton entries.
    - Each cluster entry also carries a `related_count` of reports within 100m/1hr
      (ST_DWithin computed at read time) to support severity and outlier detection.

    Ordering: life-safety → aging → timeout_risk → severity → cluster_size →
              avg_trust → oldest_report_time

    Privacy: device_id, ip_hash, notification tokens are never exposed.
             Duplicate-device signals are shown as counts, not raw IDs.
    """

    user_id = user.get("user_id")
    now = datetime.now(timezone.utc)
    params: dict = {}

    # ── Base filter ─────────────────────────────────────────────────────────
    # The default queue is active/non-terminal reports. Terminal quick filters
    # intentionally switch modes so validators can inspect today's outcomes.
    if actioned_today:
        base_filters = ["cr.status = 'ACTIONED' AND cr.created_at >= :today"]
        params["today"] = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif rejected_today:
        base_filters = ["cr.status LIKE 'REJECTED_%' AND cr.created_at >= :today"]
        params["today"] = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        base_filters = [
            "cr.status NOT IN ('ACTIONED','REJECTED_BOGUS','REJECTED_DUPLICATE','REJECTED_INSUFFICIENT','REJECTED_TIMEOUT')"
        ]

    if needs_help:
        base_filters.append("cr.safety_status = 'I_NEED_HELP'")
    if someone_else_needs_help:
        base_filters.append("cr.safety_status = 'SOMEONE_ELSE_NEEDS_HELP'")
    if unreviewed:
        base_filters.append("cr.status = 'PENDING'")

    # Ensure active public signal rows have a durable cluster workflow record.
    # Read-time spatial grouping is still used for suggestions/severity, but
    # validators need a cluster id before they can claim and apply actions.
    db.execute(
        text("""
            WITH unclustered AS (
                SELECT cr.report_id
                FROM wims.citizen_reports cr
                WHERE cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM wims.citizen_report_cluster_members cm
                      JOIN wims.citizen_report_clusters cc ON cc.cluster_id = cm.cluster_id
                      WHERE cm.report_id = cr.report_id
                        AND cc.status != 'CLUSTER_CLOSED'
                  )
            ),
            created AS (
                INSERT INTO wims.citizen_report_clusters (anchor_report_id, status)
                SELECT report_id, 'CLUSTER_MONITORING'
                FROM unclustered
                RETURNING cluster_id, anchor_report_id
            )
            INSERT INTO wims.citizen_report_cluster_members (cluster_id, report_id)
            SELECT cluster_id, anchor_report_id
            FROM created
            ON CONFLICT DO NOTHING
        """)
    )
    db.commit()

    # Aging and timeout_risk are applied post-compute (age computed from created_at)
    # Confidence and claimed_by_me depend on computed severity / CTE aliases, so
    # they are applied post-fetch.
    where_clause = " AND ".join(base_filters)

    # ── Fetch active reports with cluster membership, station context, signals ─
    # Columns selected for trust breakdown + station context, NO privacy fields.
    rows = db.execute(
        text(f"""
            WITH latest_clusters AS (
                -- Per report: latest cluster membership (if any)
                SELECT DISTINCT ON (cm.report_id)
                       cm.report_id,
                       cc.cluster_id,
                       cc.status        AS cluster_status,
                       cc.assigned_to,
                       cc.review_started_at,
                       cc.anchor_report_id
                FROM wims.citizen_report_cluster_members cm
                JOIN wims.citizen_report_clusters cc ON cc.cluster_id = cm.cluster_id
                WHERE cc.status != 'CLUSTER_CLOSED'
                ORDER BY cm.report_id, cc.updated_at DESC NULLS LAST
            ),
            related_counts AS (
                -- Count reports within 100m / 1hr for each report (excl. self)
                SELECT
                    r.report_id,
                    COUNT(r2.report_id) AS related_count
                FROM wims.citizen_reports r
                LEFT JOIN LATERAL (
                    SELECT r2.report_id
                    FROM wims.citizen_reports r2
                    WHERE r2.report_id != r.report_id
                      AND r2.status NOT LIKE 'REJECTED_%'
                      AND r2.status != 'ACTIONED'
                      AND ST_DWithin(r.location::geography, r2.location::geography, 100)
                      AND r2.created_at >= r.created_at - interval '1 hour'
                      AND r2.created_at <= r.created_at + interval '1 hour'
                ) r2 ON TRUE
                WHERE r.status NOT LIKE 'REJECTED_%' AND r.status != 'ACTIONED'
                GROUP BY r.report_id
            ),
            station_info AS (
                SELECT
                    cr.report_id,
                    fs.station_name,
                    ST_Distance(cr.location::geography, fs.location::geography) AS distance_m,
                    fs.phone
                FROM wims.citizen_reports cr
                LEFT JOIN wims.ref_fire_stations fs ON fs.station_id = cr.nearest_station_id
            ),
            dup_counts AS (
                -- Duplicate device signals within 30 min for each report
                SELECT
                    cr.report_id,
                    COUNT(cr2.report_id) AS dup_count_30m
                FROM wims.citizen_reports cr
                LEFT JOIN LATERAL (
                    SELECT cr2.report_id, cr2.device_id
                    FROM wims.citizen_reports cr2
                    WHERE cr.device_id IS NOT NULL
                      AND cr2.device_id IS NOT NULL
                      AND cr2.device_id = cr.device_id
                      AND cr2.created_at >= now() - interval '30 minutes'
                      AND cr2.report_id != cr.report_id
                ) cr2 ON TRUE
                GROUP BY cr.report_id
            )
            SELECT
                cr.report_id,
                ST_Y(cr.location::geometry) AS lat,
                ST_X(cr.location::geometry) AS lon,
                cr.category,
                cr.sub_category,
                cr.reporting_context,
                cr.safety_status,
                cr.status,
                cr.status_explanation,
                cr.trust_score,
                cr.gps_distance_m,
                cr.link_count,
                cr.created_at,
                cr.reported_at,
                cr.previous_report_id,

                -- Signal booleans for trust breakdown
                (cr.category IS NOT NULL)::bool AS has_category,
                (cr.sub_category IS NOT NULL)::bool AS has_sub_category,
                (cr.reported_at IS NOT NULL)::bool AS has_reported_at,
                (cr.device_id IS NOT NULL)::bool AS has_device_id,
                (cr.witness_name IS NOT NULL)::bool AS has_witness_name,
                (cr.witness_phone IS NOT NULL)::bool AS has_witness_phone,

                -- Station proximity tiers
                EXISTS(SELECT 1 FROM wims.ref_fire_stations WHERE nearest_station_id = station_id AND ST_DWithin(cr.location::geography, location::geography, 500)) AS nearest_500m,
                EXISTS(SELECT 1 FROM wims.ref_fire_stations WHERE nearest_station_id = station_id AND ST_DWithin(cr.location::geography, location::geography, 2000)) AS nearest_2km,
                EXISTS(SELECT 1 FROM wims.ref_fire_stations WHERE nearest_station_id = station_id AND ST_DWithin(cr.location::geography, location::geography, 5000)) AS nearest_5km,

                -- Cluster
                lc.cluster_id,
                lc.cluster_status,
                lc.assigned_to,
                lc.review_started_at,
                lc.anchor_report_id,

                -- Related count
                COALESCE(rc.related_count, 0) AS related_count,

                -- Station
                si.station_name,
                si.distance_m,
                si.phone,

                -- Duplicate count
                COALESCE(dc.dup_count_30m, 0) AS dup_count_30m

            FROM wims.citizen_reports cr
            LEFT JOIN latest_clusters lc ON lc.report_id = cr.report_id
            LEFT JOIN related_counts rc ON rc.report_id = cr.report_id
            LEFT JOIN station_info si ON si.report_id = cr.report_id
            LEFT JOIN dup_counts dc ON dc.report_id = cr.report_id
            WHERE {where_clause}
            ORDER BY
                cr.safety_status = 'I_NEED_HELP' DESC,
                cr.safety_status = 'SOMEONE_ELSE_NEEDS_HELP' DESC,
                (cr.created_at < now() - interval '60 minutes') DESC,
                (cr.created_at < now() - interval '90 minutes') DESC,
                rc.related_count DESC NULLS LAST,
                COUNT(lc.cluster_id) OVER () DESC,
                AVG(cr.trust_score) OVER () DESC,
                cr.created_at ASC
        """),
        params,
    ).fetchall()

    # ── Build report entries ──────────────────────────────────────────────────
    # Build report entries with cluster metadata captured in one pass
    # Row indices mapped from the SELECT clause
    entries: list[TriageReportEntry] = []
    report_cluster_info: dict[
        int, tuple
    ] = {}  # report_id → (cluster_id, cluster_status, assigned_to, review_started_at, anchor_report_id)

    for row in rows:
        # Column indices:
        #  0: report_id          12: created_at          24: cluster_id
        #  1: lat                13: reported_at          25: cluster_status
        #  2: lon                14: previous_report_id   26: assigned_to
        #  3: category            15: has_category         27: review_started_at
        #  4: sub_category        16: has_sub_category     28: anchor_report_id
        #  5: reporting_context  17: has_reported_at      29: related_count
        #  6: safety_status       18: has_device_id        30: station_name
        #  7: status             19: has_witness_name     31: distance_m
        #  8: status_explanation 20: has_witness_phone     32: phone
        #  9: trust_score        21: nearest_500m          33: dup_count_30m
        # 10: gps_distance_m     22: nearest_2km
        # 11: link_count         23: nearest_5km
        cluster_id = row[24]
        cluster_status = row[25]
        assigned_to_uuid = row[26]
        review_started_at = row[27]
        anchor_report_id = row[28]

        # Trust breakdown from signal boolean columns (indices 15-20)
        has_category = row[15]
        has_sub_category = row[16]
        has_reported_at = row[17]
        has_device_id = row[18]
        has_witness_name = row[19]
        has_witness_phone = row[20]
        nearest_500m = row[21]
        nearest_2km = row[22]
        nearest_5km = row[23]

        tb = _build_trust_breakdown(
            has_category,
            has_sub_category,
            has_reported_at,
            has_device_id,
            has_witness_name,
            has_witness_phone,
            nearest_500m,
            nearest_2km,
            nearest_5km,
        )
        tb.duplicate_device_count_30m = int(row[33] or 0)
        gps_distance_m = row[10]
        tb.gps_mismatch = bool(gps_distance_m is not None and float(gps_distance_m) > 200)
        tb.score = int(row[9] or 0)

        created_at_val = row[12]
        is_aging, is_timeout_risk = _aging_flags(created_at_val)
        sev = _severity(int(row[29] or 0), tb.score)

        if aging and not is_aging:
            continue
        if timeout_risk and not is_timeout_risk:
            continue
        if confidence and sev != confidence:
            continue
        if claimed_by_me and str(assigned_to_uuid) != str(user_id):
            continue

        station = StationContext(
            name=row[30],
            distance_m=float(row[31]) if row[31] is not None else None,
            phone_available=bool(row[32] and str(row[32]).strip()),
        )

        entry = TriageReportEntry(
            report_id=row[0],
            latitude=float(row[1]),
            longitude=float(row[2]),
            category=row[3],
            sub_category=row[4],
            reporting_context=row[5],
            safety_status=row[6],
            status=row[7],
            status_explanation=row[8],
            trust_breakdown=tb,
            severity=sev,
            related_count=int(row[29] or 0),
            linked_count=int(row[11] or 0),
            created_at=created_at_val.replace(tzinfo=timezone.utc)
            if created_at_val.tzinfo is None
            else created_at_val,
            reported_at=row[13].replace(tzinfo=timezone.utc)
            if row[13] and row[13].tzinfo is None
            else row[13],
            is_aging=is_aging,
            is_timeout_risk=is_timeout_risk,
            previous_report_id=row[14],
            station=station,
        )
        entries.append(entry)

        report_cluster_info[row[0]] = (
            cluster_id,
            cluster_status,
            assigned_to_uuid,
            review_started_at,
            anchor_report_id,
        )

    # ── Group into clusters ───────────────────────────────────────────────────
    cluster_map: dict[int | str, TriageClusterEntry] = {}

    for entry in entries:
        cluster_id, cluster_status, assigned_to_uuid, review_started_at, anchor_report_id = (
            report_cluster_info.get(entry.report_id, (None, None, None, None, None))
        )

        cluster_key = cluster_id if cluster_id is not None else f"singleton:{entry.report_id}"

        if cluster_key not in cluster_map:
            # Resolve assigned_to display name
            assigned_to_name = None
            if assigned_to_uuid:
                name_row = db.execute(
                    text("SELECT username FROM wims.users WHERE user_id = :uid"),
                    {"uid": assigned_to_uuid},
                ).fetchone()
                if name_row:
                    assigned_to_name = name_row[0]

            cluster_map[cluster_key] = TriageClusterEntry(
                cluster_id=cluster_id,
                anchor_report_id=anchor_report_id,
                cluster_status=cluster_status,
                assigned_to=assigned_to_name,
                review_started_at=(
                    review_started_at.replace(tzinfo=timezone.utc)
                    if review_started_at and review_started_at.tzinfo is None
                    else review_started_at
                ),
                member_count=0,
                has_life_safety=False,
                severity="LOW",
                avg_trust=0.0,
                oldest_report_at=entry.created_at,
                is_aging=entry.is_aging,
                is_timeout_risk=entry.is_timeout_risk,
                related_count=0,
                reports=[],
                station=entry.station,
            )

        cluster_map[cluster_key].reports.append(entry)
        cluster_map[cluster_key].member_count += 1

        if entry.safety_status in ("I_NEED_HELP", "SOMEONE_ELSE_NEEDS_HELP"):
            cluster_map[cluster_key].has_life_safety = True
        if entry.is_aging:
            cluster_map[cluster_key].is_aging = True
        if entry.is_timeout_risk:
            cluster_map[cluster_key].is_timeout_risk = True
        if entry.related_count > cluster_map[cluster_key].related_count:
            cluster_map[cluster_key].related_count = entry.related_count

    # ── Compute cluster-level aggregates ─────────────────────────────────────
    for cluster in cluster_map.values():
        if cluster.reports:
            trust_scores = [r.trust_breakdown.score for r in cluster.reports]
            cluster.avg_trust = sum(trust_scores) / len(trust_scores)
            severities = [r.severity for r in cluster.reports]
            if "HIGH" in severities:
                cluster.severity = "HIGH"
            elif "MEDIUM" in severities:
                cluster.severity = "MEDIUM"
            oldest = min(r.created_at for r in cluster.reports)
            cluster.oldest_report_at = (
                oldest.replace(tzinfo=timezone.utc) if oldest.tzinfo is None else oldest
            )

    # ── Sort clusters by priority ordering ────────────────────────────────────
    sorted_clusters = sorted(
        cluster_map.values(),
        key=lambda c: (
            not c.has_life_safety,
            not c.is_aging,
            not c.is_timeout_risk,
            c.severity == "LOW",
            -c.member_count,
            -c.avg_trust,
            c.oldest_report_at,
        ),
    )

    return TriageQueueResponse(
        clusters=sorted_clusters,
        polled_at=datetime.now(timezone.utc),
        total_reports=len(entries),
    )


# ─── Cluster claim/activity workflow ──────────────────────────────────────────


@router.post("/clusters/{cluster_id}/claim", response_model=ClusterClaimResponse)
def claim_cluster(
    cluster_id: int,
    body: ClusterClaimRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> ClusterClaimResponse:
    """Claim a civilian report cluster for validator review.

    Active claims block ordinary takeover. After 15 minutes without activity,
    NATIONAL_VALIDATOR or SYSTEM_ADMIN may take over with an audit reason.
    """
    user_id = user["user_id"]
    role = user.get("role")
    now = datetime.now(timezone.utc)

    try:
        cluster = _fetch_cluster_for_update(db, cluster_id)
        if cluster is None:
            raise HTTPException(status_code=404, detail="Cluster not found")
        if cluster[1] == "CLUSTER_CLOSED":
            raise HTTPException(status_code=409, detail="Cannot claim a closed cluster")

        assigned_to = cluster[2]
        assigned_to_current_user = str(assigned_to) == str(user_id) if assigned_to else False
        has_active_claim = bool(assigned_to and not _is_cluster_claim_stale(cluster[4], now))
        takeover = bool(assigned_to and not assigned_to_current_user)

        if takeover and has_active_claim:
            raise HTTPException(status_code=409, detail="Cluster is actively claimed")

        audit_action = "CLUSTER_CLAIM"
        internal_note = cluster[5]

        if takeover:
            if role not in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN"):
                raise HTTPException(
                    status_code=403, detail="Only higher-privilege users can take over stale claims"
                )
            reason = (body.reason or "").strip()
            if not reason:
                raise HTTPException(
                    status_code=422, detail="Takeover reason is required for stale claims"
                )
            audit_action = "CLUSTER_STALE_TAKEOVER"
            timestamp = now.isoformat()
            takeover_note = f"[{timestamp}] stale takeover by {user_id}: {reason}"
            internal_note = f"{internal_note}\n{takeover_note}" if internal_note else takeover_note

        db.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET status = 'CLUSTER_UNDER_REVIEW',
                    assigned_to = :uid,
                    review_started_at = CASE
                        WHEN assigned_to IS DISTINCT FROM :uid THEN :now
                        ELSE COALESCE(review_started_at, :now)
                    END,
                    updated_at = :now,
                    acted_by = :uid,
                    internal_note = :internal_note
                WHERE cluster_id = :cid
            """),
            {
                "cid": cluster_id,
                "uid": user_id,
                "now": now,
                "internal_note": internal_note,
            },
        )

        log_system_audit(
            db=db,
            user_id=user_id,
            action_type=audit_action,
            table_affected="citizen_report_clusters",
            record_id=cluster_id,
            request=request,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    row = db.execute(
        text("""
            SELECT c.cluster_id, c.status, c.assigned_to, c.review_started_at,
                   c.updated_at, c.internal_note, u.username AS assigned_username
            FROM wims.citizen_report_clusters c
            LEFT JOIN wims.users u ON u.user_id = c.assigned_to
            WHERE c.cluster_id = :cid
        """),
        {"cid": cluster_id},
    ).fetchone()
    return _cluster_claim_response(row)


@router.post("/clusters/{cluster_id}/activity", response_model=ClusterClaimResponse)
def refresh_cluster_activity(
    cluster_id: int,
    body: ClusterActivityRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> ClusterClaimResponse:
    """Refresh a cluster claim after meaningful validator activity."""
    user_id = user["user_id"]
    now = datetime.now(timezone.utc)
    action = body.action.strip().upper() if body.action else "REFRESH"
    if not action:
        action = "REFRESH"

    try:
        cluster = _fetch_cluster_for_update(db, cluster_id)
        if cluster is None:
            raise HTTPException(status_code=404, detail="Cluster not found")
        if cluster[1] == "CLUSTER_CLOSED":
            raise HTTPException(status_code=409, detail="Cannot refresh a closed cluster")
        if str(cluster[2]) != str(user_id):
            raise HTTPException(
                status_code=409, detail="Cluster is not claimed by the current user"
            )

        internal_note = cluster[5]
        note = (body.note or "").strip()
        if note:
            activity_note = f"[{now.isoformat()}] activity {action} by {user_id}: {note}"
            internal_note = f"{internal_note}\n{activity_note}" if internal_note else activity_note

        db.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET updated_at = :now,
                    acted_by = :uid,
                    internal_note = :internal_note
                WHERE cluster_id = :cid
            """),
            {"cid": cluster_id, "uid": user_id, "now": now, "internal_note": internal_note},
        )

        log_system_audit(
            db=db,
            user_id=user_id,
            action_type=f"CLUSTER_ACTIVITY_{action[:40]}",
            table_affected="citizen_report_clusters",
            record_id=cluster_id,
            request=request,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    row = db.execute(
        text("""
            SELECT c.cluster_id, c.status, c.assigned_to, c.review_started_at,
                   c.updated_at, c.internal_note, u.username AS assigned_username
            FROM wims.citizen_report_clusters c
            LEFT JOIN wims.users u ON u.user_id = c.assigned_to
            WHERE c.cluster_id = :cid
        """),
        {"cid": cluster_id},
    ).fetchone()
    return _cluster_claim_response(row)


@router.get("/clusters/{cluster_id}/activity", response_model=ClusterActivityResponse)
def get_cluster_activity(
    cluster_id: int,
    _user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> ClusterActivityResponse:
    """Return a privacy-safe activity/history projection for a cluster."""
    cluster = db.execute(
        text("""
            SELECT cluster_id, created_at, assigned_to, review_started_at,
                   status, status_note, internal_note, acted_by, updated_at
            FROM wims.citizen_report_clusters
            WHERE cluster_id = :cid
        """),
        {"cid": cluster_id},
    ).fetchone()
    if cluster is None:
        raise HTTPException(status_code=404, detail="Cluster not found")

    events: list[ClusterActivityEntry] = [
        ClusterActivityEntry(
            event_type="CLUSTER_CREATED",
            occurred_at=cluster[1],
            actor_user_id=str(cluster[7]) if cluster[7] else None,
            new_status=cluster[4],
            note=cluster[6],
        )
    ]

    member_rows = db.execute(
        text("""
            SELECT cm.report_id, cm.linked_by, u.username, cm.created_at
            FROM wims.citizen_report_cluster_members cm
            LEFT JOIN wims.users u ON u.user_id = cm.linked_by
            WHERE cm.cluster_id = :cid
            ORDER BY cm.created_at ASC, cm.report_id ASC
        """),
        {"cid": cluster_id},
    ).fetchall()
    for row in member_rows:
        events.append(
            ClusterActivityEntry(
                event_type="REPORT_ADDED",
                occurred_at=row[3],
                actor_user_id=str(row[1]) if row[1] else None,
                actor_username=row[2],
                report_id=row[0],
            )
        )

    audit_rows = db.execute(
        text("""
            SELECT sat.action_type, sat.user_id, u.username, sat.timestamp
            FROM wims.system_audit_trails sat
            LEFT JOIN wims.users u ON u.user_id = sat.user_id
            WHERE sat.table_affected = 'citizen_report_clusters'
              AND sat.record_id = :cid
            ORDER BY sat.timestamp ASC, sat.audit_id ASC
        """),
        {"cid": cluster_id},
    ).fetchall()
    for row in audit_rows:
        events.append(
            ClusterActivityEntry(
                event_type=row[0],
                occurred_at=row[3],
                actor_user_id=str(row[1]) if row[1] else None,
                actor_username=row[2],
                new_status="CLUSTER_UNDER_REVIEW"
                if row[0] in ("CLUSTER_CLAIM", "CLUSTER_STALE_TAKEOVER")
                else None,
            )
        )

    events.sort(key=lambda event: event.occurred_at or datetime.min.replace(tzinfo=timezone.utc))
    return ClusterActivityResponse(cluster_id=cluster_id, events=events)


@router.get("/clusters/{cluster_id}/merge-candidates", response_model=MergeCandidateResponse)
def get_merge_candidates(
    cluster_id: int,
    _user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> MergeCandidateResponse:
    """Return conservative nearby cluster merge candidates within 250m and 1 hour."""
    cluster = db.execute(
        text("""
            SELECT c.cluster_id, c.anchor_report_id, a.location, a.created_at
            FROM wims.citizen_report_clusters c
            JOIN wims.citizen_reports a ON a.report_id = c.anchor_report_id
            WHERE c.cluster_id = :cid
              AND c.status != 'CLUSTER_CLOSED'
        """),
        {"cid": cluster_id},
    ).fetchone()
    if cluster is None:
        raise HTTPException(status_code=404, detail="Cluster not found")

    rows = db.execute(
        text("""
            SELECT c.cluster_id,
                   c.anchor_report_id,
                   ST_Distance(a.location::geography, target.location::geography) AS distance_m,
                   ABS(EXTRACT(EPOCH FROM (a.created_at - target.created_at))) / 60.0 AS minutes_apart,
                   c.status,
                   COUNT(cm.report_id) AS member_count
            FROM wims.citizen_report_clusters c
            JOIN wims.citizen_reports a ON a.report_id = c.anchor_report_id
            LEFT JOIN wims.citizen_report_cluster_members cm ON cm.cluster_id = c.cluster_id
            CROSS JOIN LATERAL (
                SELECT location, created_at
                FROM wims.citizen_reports
                WHERE report_id = :anchor_report_id
            ) target
            WHERE c.cluster_id != :cid
              AND c.status != 'CLUSTER_CLOSED'
              AND ST_DWithin(a.location::geography, target.location::geography, 250)
              AND ABS(EXTRACT(EPOCH FROM (a.created_at - target.created_at))) <= 3600
            GROUP BY c.cluster_id, c.anchor_report_id, a.location, target.location,
                     a.created_at, target.created_at, c.status
            ORDER BY distance_m ASC, minutes_apart ASC
            LIMIT 10
        """),
        {"cid": cluster_id, "anchor_report_id": cluster.anchor_report_id},
    ).fetchall()

    return MergeCandidateResponse(
        cluster_id=cluster_id,
        candidates=[
            MergeCandidate(
                cluster_id=row.cluster_id,
                anchor_report_id=row.anchor_report_id,
                distance_m=float(row.distance_m),
                minutes_apart=float(row.minutes_apart),
                status=row.status,
                member_count=int(row.member_count or 0),
            )
            for row in rows
        ],
    )


# ─── Cluster terminal/split/merge workflow ────────────────────────────────────


@router.post("/clusters/{cluster_id}/terminal-action", response_model=WorkflowResult)
def apply_cluster_terminal_action(
    cluster_id: int,
    body: TerminalActionRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    """Apply a civilian-visible terminal status to selected non-terminal rows."""
    status = _validate_terminal_status(body.status)
    explanation = body.status_explanation.strip()
    if not explanation:
        raise HTTPException(status_code=422, detail="status_explanation is required")
    report_ids = sorted(set(body.report_ids))
    if not report_ids:
        raise HTTPException(status_code=422, detail="At least one report_id is required")

    user_id = user["user_id"]
    try:
        cluster = _ensure_cluster_claim(db, cluster_id, user)
        members = db.execute(
            text("""
                SELECT cr.report_id, cr.status
                FROM wims.citizen_report_cluster_members cm
                JOIN wims.citizen_reports cr ON cr.report_id = cm.report_id
                WHERE cm.cluster_id = :cid AND cr.report_id = ANY(CAST(:report_ids AS integer[]))
                FOR UPDATE OF cr
            """),
            {"cid": cluster_id, "report_ids": report_ids},
        ).fetchall()
        found_ids = {row.report_id for row in members}
        missing = [rid for rid in report_ids if rid not in found_ids]
        if missing:
            raise HTTPException(status_code=404, detail=f"Reports not in cluster: {missing}")
        terminal_rows = [row.report_id for row in members if row.status in TERMINAL_REPORT_STATUSES]
        if terminal_rows:
            raise HTTPException(
                status_code=409, detail=f"Terminal rows require correction flow: {terminal_rows}"
            )

        result = db.execute(
            text("""
                UPDATE wims.citizen_reports
                SET status = :status,
                    status_explanation = :explanation,
                    internal_note = CASE
                        WHEN :internal_note IS NULL OR :internal_note = '' THEN internal_note
                        WHEN internal_note IS NULL THEN :internal_note
                        ELSE internal_note || E'\n' || :internal_note
                    END,
                    validated_by = :uid
                WHERE report_id = ANY(CAST(:report_ids AS integer[]))
                RETURNING report_id
            """),
            {
                "status": status,
                "explanation": explanation,
                "internal_note": (body.internal_note or "").strip(),
                "uid": user_id,
                "report_ids": report_ids,
            },
        )
        updated_ids = [row.report_id for row in result.fetchall()]

        new_cluster_status = "CLUSTER_ACTIONED" if status == "ACTIONED" else "CLUSTER_CLOSED"
        db.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET status = :cluster_status,
                    status_note = :explanation,
                    internal_note = :internal_note,
                    updated_at = now(),
                    closed_at = CASE WHEN :cluster_status = 'CLUSTER_CLOSED' THEN now() ELSE closed_at END,
                    acted_by = :uid
                WHERE cluster_id = :cid
            """),
            {
                "cid": cluster_id,
                "cluster_status": new_cluster_status,
                "explanation": explanation,
                "internal_note": _append_internal_note(
                    cluster[5],
                    str(user_id),
                    f"terminal {status}",
                    body.internal_note or explanation,
                ),
                "uid": user_id,
            },
        )

        for rid in updated_ids:
            log_system_audit(
                db, user_id, f"CITIZEN_REPORT_{status}", "citizen_reports", rid, request
            )
        log_system_audit(
            db, user_id, "CLUSTER_TERMINAL_ACTION", "citizen_report_clusters", cluster_id, request
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    _notify_reports(updated_ids, status)
    return WorkflowResult(
        status="applied", report_ids=updated_ids, cluster_id=cluster_id, updated=len(updated_ids)
    )


@router.post("/reports/{report_id}/correct", response_model=WorkflowResult)
def correct_terminal_report(
    report_id: int,
    body: CorrectionRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    """Correct a terminal civilian report decision with an audited reason."""
    role = user.get("role")
    if role not in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN"):
        raise HTTPException(
            status_code=403, detail="Only validators/admins can correct terminal decisions"
        )
    status = _validate_terminal_status(body.status)
    explanation = body.status_explanation.strip()
    reason = body.correction_reason.strip()
    if not explanation or not reason:
        raise HTTPException(
            status_code=422, detail="Correction reason and replacement explanation are required"
        )

    user_id = user["user_id"]
    try:
        row = db.execute(
            text(
                "SELECT status, internal_note FROM wims.citizen_reports WHERE report_id = :rid FOR UPDATE"
            ),
            {"rid": report_id},
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found")
        if row.status not in TERMINAL_REPORT_STATUSES:
            raise HTTPException(status_code=409, detail="Only terminal reports use correction flow")
        note = _append_internal_note(
            row.internal_note, str(user_id), f"correction {row.status}->{status}", reason
        )
        db.execute(
            text("""
                UPDATE wims.citizen_reports
                SET status = :status,
                    status_explanation = :explanation,
                    internal_note = :note,
                    validated_by = :uid
                WHERE report_id = :rid
            """),
            {
                "rid": report_id,
                "status": status,
                "explanation": explanation,
                "note": note,
                "uid": user_id,
            },
        )
        log_system_audit(
            db, user_id, "CITIZEN_REPORT_CORRECTION", "citizen_reports", report_id, request
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    _enqueue_status_notification(report_id, status)
    return WorkflowResult(status="corrected", report_ids=[report_id], updated=1)


@router.post("/clusters/{cluster_id}/split", response_model=WorkflowResult, status_code=201)
def split_cluster(
    cluster_id: int,
    body: ClusterSplitRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    """Split selected member rows into a new explicit cluster."""
    note = body.internal_note.strip()
    report_ids = sorted(set(body.report_ids))
    if not note or not report_ids:
        raise HTTPException(status_code=422, detail="report_ids and internal_note are required")
    user_id = user["user_id"]
    try:
        cluster = _ensure_cluster_claim(db, cluster_id, user)
        members = db.execute(
            text("""
                SELECT report_id
                FROM wims.citizen_report_cluster_members
                WHERE cluster_id = :cid AND report_id = ANY(CAST(:report_ids AS integer[]))
                FOR UPDATE
            """),
            {"cid": cluster_id, "report_ids": report_ids},
        ).fetchall()
        found_ids = [row.report_id for row in members]
        if len(found_ids) != len(report_ids):
            raise HTTPException(
                status_code=404, detail="All selected reports must be existing cluster members"
            )
        if len(found_ids) == 1:
            raise HTTPException(
                status_code=422, detail="Split requires at least two selected reports"
            )

        new_cluster = db.execute(
            text("""
                INSERT INTO wims.citizen_report_clusters
                    (anchor_report_id, status, assigned_to, review_started_at, internal_note, acted_by)
                VALUES (:anchor, 'CLUSTER_UNDER_REVIEW', :uid, now(), :note, :uid)
                RETURNING cluster_id
            """),
            {
                "anchor": found_ids[0],
                "uid": user_id,
                "note": _append_internal_note(None, str(user_id), "split", note),
            },
        ).fetchone()
        new_cluster_id = new_cluster.cluster_id
        db.execute(
            text("""
                DELETE FROM wims.citizen_report_cluster_members
                WHERE cluster_id = :cid AND report_id = ANY(CAST(:report_ids AS integer[]))
            """),
            {"cid": cluster_id, "report_ids": found_ids},
        )
        db.execute(
            text("""
                INSERT INTO wims.citizen_report_cluster_members (cluster_id, report_id, linked_by)
                SELECT :new_cid, unnest(CAST(:report_ids AS integer[])), :uid
            """),
            {"new_cid": new_cluster_id, "report_ids": found_ids, "uid": user_id},
        )
        db.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET internal_note = :note, updated_at = now(), acted_by = :uid
                WHERE cluster_id = :cid
            """),
            {
                "cid": cluster_id,
                "note": _append_internal_note(cluster[5], str(user_id), "split", note),
                "uid": user_id,
            },
        )
        log_system_audit(
            db, user_id, "CLUSTER_SPLIT", "citizen_report_clusters", cluster_id, request
        )
        log_system_audit(
            db,
            user_id,
            "CLUSTER_CREATED_BY_SPLIT",
            "citizen_report_clusters",
            new_cluster_id,
            request,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return WorkflowResult(
        status="split",
        cluster_id=cluster_id,
        new_cluster_id=new_cluster_id,
        report_ids=found_ids,
        updated=len(found_ids),
    )


@router.post("/clusters/{target_cluster_id}/merge", response_model=WorkflowResult)
def merge_clusters(
    target_cluster_id: int,
    body: ClusterMergeRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    """Merge a nearby source cluster into a claimed target cluster."""
    note = body.internal_note.strip()
    if not note or body.source_cluster_id == target_cluster_id:
        raise HTTPException(
            status_code=422, detail="source_cluster_id and internal_note are required"
        )
    user_id = user["user_id"]
    try:
        target = _ensure_cluster_claim(db, target_cluster_id, user)
        source = _fetch_cluster_for_update(db, body.source_cluster_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Source cluster not found")
        if source[1] == "CLUSTER_CLOSED":
            raise HTTPException(status_code=409, detail="Source cluster is already closed")

        source_members = db.execute(
            text(
                "SELECT report_id FROM wims.citizen_report_cluster_members WHERE cluster_id = :cid"
            ),
            {"cid": body.source_cluster_id},
        ).fetchall()
        report_ids = [row.report_id for row in source_members]
        db.execute(
            text("""
                INSERT INTO wims.citizen_report_cluster_members (cluster_id, report_id, linked_by)
                SELECT :target_cid, unnest(CAST(:report_ids AS integer[])), :uid
                ON CONFLICT (cluster_id, report_id) DO NOTHING
            """),
            {"target_cid": target_cluster_id, "report_ids": report_ids, "uid": user_id},
        )
        db.execute(
            text("""
                DELETE FROM wims.citizen_report_cluster_members
                WHERE cluster_id = :source_cid
            """),
            {"source_cid": body.source_cluster_id},
        )
        db.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET status = 'CLUSTER_CLOSED',
                    merged_into_cluster_id = :target_cid,
                    closed_at = now(),
                    updated_at = now(),
                    internal_note = :note,
                    acted_by = :uid
                WHERE cluster_id = :source_cid
            """),
            {
                "source_cid": body.source_cluster_id,
                "target_cid": target_cluster_id,
                "note": _append_internal_note(source[5], str(user_id), "merge into target", note),
                "uid": user_id,
            },
        )
        db.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET internal_note = :note, updated_at = now(), acted_by = :uid
                WHERE cluster_id = :target_cid
            """),
            {
                "target_cid": target_cluster_id,
                "note": _append_internal_note(target[5], str(user_id), "merge source", note),
                "uid": user_id,
            },
        )
        log_system_audit(
            db,
            user_id,
            "CLUSTER_MERGE_TARGET",
            "citizen_report_clusters",
            target_cluster_id,
            request,
        )
        log_system_audit(
            db,
            user_id,
            "CLUSTER_MERGE_SOURCE",
            "citizen_report_clusters",
            body.source_cluster_id,
            request,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return WorkflowResult(
        status="merged",
        cluster_id=target_cluster_id,
        report_ids=report_ids,
        updated=len(report_ids),
    )


# ─── Legacy endpoints ─────────────────────────────────────────────────────────


@router.get("/pending")
def get_pending_reports(
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Return citizen_reports where status == 'PENDING'.
    Requires ENCODER or VALIDATOR role.
    Deprecated: use GET /api/triage/queue instead.
    """
    rows = db.execute(
        text("""
            SELECT report_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
                   status, created_at
            FROM wims.citizen_reports
            WHERE status = 'PENDING'
            ORDER BY created_at ASC
        """),
    ).fetchall()

    return [
        {
            "report_id": r[0],
            "latitude": float(r[1]),
            "longitude": float(r[2]),
            "status": r[3],
            "created_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


@router.post("/{report_id}/promote", status_code=201)
def promote_report(
    report_id: int,
    request: Request,
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Deprecated Phase 1 endpoint.

    Civilian reports are public signal records in Phase 2 and must not create
    official fire_incidents. Validators should use cluster terminal actions.
    """
    raise HTTPException(
        status_code=410,
        detail="Civilian report promotion is disabled. Use /api/triage/queue and cluster terminal actions.",
    )
    report = db.execute(
        text("""
            SELECT report_id, location, status
            FROM wims.citizen_reports
            WHERE report_id = :rid
        """),
        {"rid": report_id},
    ).fetchone()

    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")

    if report[2] != "PENDING":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot promote report with status '{report[2]}'",
        )

    user_id = user["user_id"]

    region_row = db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    if region_row is None:
        raise HTTPException(status_code=500, detail="No ref_regions seed data")

    region_id = region_row[0]

    try:
        result = db.execute(
            text("""
                INSERT INTO wims.fire_incidents (region_id, encoder_id, location, verification_status)
                SELECT :region_id, :encoder_id, location, 'VERIFIED'
                FROM wims.citizen_reports
                WHERE report_id = :rid
                RETURNING incident_id
            """),
            {"region_id": region_id, "encoder_id": user_id, "rid": report_id},
        )
        row = result.fetchone()
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create incident")
        incident_id = row[0]

        db.execute(
            text("""
                UPDATE wims.citizen_reports
                SET status = 'VERIFIED', validated_by = :uid, verified_incident_id = :iid
                WHERE report_id = :rid
            """),
            {"uid": user_id, "iid": incident_id, "rid": report_id},
        )

        log_system_audit(
            db=db,
            user_id=user_id,
            action_type="PROMOTE_REPORT",
            table_affected="fire_incidents",
            record_id=incident_id,
            request=request,
        )

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    sync_incident_to_analytics(db, incident_id)
    db.commit()

    _enqueue_status_notification(report_id, "VERIFIED")

    return {"report_id": report_id, "incident_id": incident_id}


@router.post("/bulk-promote", status_code=201)
def bulk_promote_reports(
    body: BulkPromoteRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Deprecated Phase 1 endpoint. Civilian reports no longer create official incidents.
    """
    raise HTTPException(
        status_code=410,
        detail="Civilian bulk promotion is disabled. Use cluster terminal actions.",
    )
    user_id = user["user_id"]

    region_row = db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    if not region_row:
        raise HTTPException(status_code=500, detail="No ref_regions seed data")
    region_id = region_row[0]

    promoted = []
    failed = []

    for rid in body.report_ids:
        try:
            report = db.execute(
                text("SELECT status FROM wims.citizen_reports WHERE report_id = :rid"),
                {"rid": rid},
            ).fetchone()

            if not report or report[0] != "PENDING":
                failed.append(rid)
                continue

            result = db.execute(
                text("""
                    INSERT INTO wims.fire_incidents (region_id, encoder_id, location, verification_status)
                    SELECT :region_id, :encoder_id, location, 'VERIFIED'
                    FROM wims.citizen_reports
                    WHERE report_id = :rid
                    RETURNING incident_id
                """),
                {"region_id": region_id, "encoder_id": user_id, "rid": rid},
            )
            incident_id = result.fetchone()[0]

            db.execute(
                text("""
                    UPDATE wims.citizen_reports
                    SET status = 'VERIFIED', validated_by = :uid, verified_incident_id = :iid
                    WHERE report_id = :rid
                """),
                {"uid": user_id, "iid": incident_id, "rid": rid},
            )

            promoted.append({"report_id": rid, "incident_id": incident_id})
        except Exception:
            failed.append(rid)

    db.commit()

    for item in promoted:
        sync_incident_to_analytics(db, item["incident_id"])
    db.commit()

    for item in promoted:
        _enqueue_status_notification(item["report_id"], "VERIFIED")

    return {"promoted": promoted, "failed": failed}
