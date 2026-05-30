"""Civilian triage workflow commands."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.event_bus import publish_verification_event
from services.civilian_triage.models import (
    ClusterActivityRequest,
    ClusterActivityResponse,
    ClusterActivityEntry,
    ClusterClaimRequest,
    ClusterClaimResponse,
    ClusterMergeRequest,
    ClusterSplitRequest,
    CorrectionRequest,
    MergeCandidate,
    MergeCandidateResponse,
    TerminalActionRequest,
    WorkflowResult,
)
from services.civilian_triage.notifications import enqueue_status_notification, notify_reports
from services.civilian_triage.policies import (
    TERMINAL_REPORT_STATUSES,
    is_cluster_claim_stale,
    validate_terminal_status,
)
from services.civilian_triage.repository import (
    append_internal_note,
    cluster_claim_response,
    ensure_cluster_claim,
    fetch_cluster_for_update,
)
from utils.audit import log_system_audit

# ─── Cluster claim/activity workflow ──────────────────────────────────────────


def claim_cluster_command(
    cluster_id: int,
    body: ClusterClaimRequest,
    request: Request,
    user: dict,
    db: Session,
) -> ClusterClaimResponse:
    """Claim a civilian report cluster for validator review.

    Active claims block ordinary takeover. After 15 minutes without activity,
    NATIONAL_VALIDATOR or SYSTEM_ADMIN may take over with an audit reason.
    """
    user_id = user["user_id"]
    role = user.get("role")
    now = datetime.now(timezone.utc)

    try:
        cluster = fetch_cluster_for_update(db, cluster_id)
        if cluster is None:
            raise HTTPException(status_code=404, detail="Cluster not found")
        if cluster[1] == "CLUSTER_CLOSED":
            raise HTTPException(status_code=409, detail="Cannot claim a closed cluster")

        assigned_to = cluster[2]
        assigned_to_current_user = str(assigned_to) == str(user_id) if assigned_to else False
        has_active_claim = bool(assigned_to and not is_cluster_claim_stale(cluster[4], now))
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

    # Publish real-time SSE event (fire-and-forget)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(
            publish_verification_event(
                "verification.cluster_claimed",
                cluster_id=cluster_id,
                action=audit_action,
                actor_id=user_id,
                actor_role=user.get("role"),
            )
        )
    except RuntimeError:
        pass

    return cluster_claim_response(row)


def refresh_cluster_activity_command(
    cluster_id: int,
    body: ClusterActivityRequest,
    request: Request,
    user: dict,
    db: Session,
) -> ClusterClaimResponse:
    """Refresh a cluster claim after meaningful validator activity."""
    user_id = user["user_id"]
    now = datetime.now(timezone.utc)
    action = body.action.strip().upper() if body.action else "REFRESH"
    if not action:
        action = "REFRESH"

    try:
        cluster = fetch_cluster_for_update(db, cluster_id)
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
    return cluster_claim_response(row)


def get_cluster_activity_command(
    cluster_id: int,
    db: Session,
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


def get_merge_candidates_command(
    cluster_id: int,
    db: Session,
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


def apply_terminal_action_command(
    cluster_id: int,
    body: TerminalActionRequest,
    request: Request,
    user: dict,
    db: Session,
) -> WorkflowResult:
    """Apply a civilian-visible terminal status to selected non-terminal rows."""
    status = validate_terminal_status(body.status)
    explanation = body.status_explanation.strip()
    if not explanation:
        raise HTTPException(status_code=422, detail="status_explanation is required")
    report_ids = sorted(set(body.report_ids))
    if not report_ids:
        raise HTTPException(status_code=422, detail="At least one report_id is required")

    user_id = user["user_id"]
    try:
        cluster = ensure_cluster_claim(db, cluster_id, user)
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
                "internal_note": append_internal_note(
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

    notify_reports(updated_ids, status)

    # Publish real-time SSE event (fire-and-forget)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(
            publish_verification_event(
                "verification.terminal_action",
                cluster_id=cluster_id,
                action=status,
                actor_id=user_id,
                actor_role=user.get("role"),
                extra={"report_ids": updated_ids, "status": status},
            )
        )
    except RuntimeError:
        pass

    return WorkflowResult(
        status="applied", report_ids=updated_ids, cluster_id=cluster_id, updated=len(updated_ids)
    )


def correct_terminal_report_command(
    report_id: int,
    body: CorrectionRequest,
    request: Request,
    user: dict,
    db: Session,
) -> WorkflowResult:
    """Correct a terminal civilian report decision with an audited reason."""
    role = user.get("role")
    if role not in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN"):
        raise HTTPException(
            status_code=403, detail="Only validators/admins can correct terminal decisions"
        )
    status = validate_terminal_status(body.status)
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
        note = append_internal_note(
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

    enqueue_status_notification(report_id, status)
    return WorkflowResult(status="corrected", report_ids=[report_id], updated=1)


def split_cluster_command(
    cluster_id: int,
    body: ClusterSplitRequest,
    request: Request,
    user: dict,
    db: Session,
) -> WorkflowResult:
    """Split selected member rows into a new explicit cluster."""
    note = body.internal_note.strip()
    report_ids = sorted(set(body.report_ids))
    if not note or not report_ids:
        raise HTTPException(status_code=422, detail="report_ids and internal_note are required")
    user_id = user["user_id"]
    try:
        cluster = ensure_cluster_claim(db, cluster_id, user)
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
                "note": append_internal_note(None, str(user_id), "split", note),
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
                "note": append_internal_note(cluster[5], str(user_id), "split", note),
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


def merge_clusters_command(
    target_cluster_id: int,
    body: ClusterMergeRequest,
    request: Request,
    user: dict,
    db: Session,
) -> WorkflowResult:
    """Merge a nearby source cluster into a claimed target cluster."""
    note = body.internal_note.strip()
    if not note or body.source_cluster_id == target_cluster_id:
        raise HTTPException(
            status_code=422, detail="source_cluster_id and internal_note are required"
        )
    user_id = user["user_id"]
    try:
        target = ensure_cluster_claim(db, target_cluster_id, user)
        source = fetch_cluster_for_update(db, body.source_cluster_id)
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
                "note": append_internal_note(source[5], str(user_id), "merge into target", note),
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
                "note": append_internal_note(target[5], str(user_id), "merge source", note),
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
