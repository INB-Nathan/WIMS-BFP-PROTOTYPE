"""System Admin API — security telemetry routes."""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from services.ai_service import analyze_threat_log
from services.event_bus import publish_security_event_sync
from services.suricata_ingestion import _create_security_incident
from utils.audit import log_system_audit

logger = logging.getLogger("wims.admin")
router = APIRouter()

VALID_HITL_ACTIONS = ("CONFIRM_THREAT", "FALSE_POSITIVE", "REQUEST_MORE_INFO")

_VALID_SEVERITIES = frozenset({"LOW", "MEDIUM", "HIGH", "CRITICAL"})

_VALID_CLASSIFICATIONS = frozenset(
    {
        "internet_background_noise",
        "scanner",
        "bot_probe",
        "credential_probe",
        "high_signal_threat",
        "unclassified",
    }
)

HITL_ACTION_LABELS: dict[str, str] = {
    "CONFIRM_THREAT": "Confirmed Threat",
    "FALSE_POSITIVE": "False Positive (Dismissed)",
    "REQUEST_MORE_INFO": "More Info Requested",
}


class SecurityLogUpdate(BaseModel):
    action: str | None = None
    note: str | None = None
    admin_action_taken: str | None = None
    resolved_at: str | None = None


@router.get("/security-logs")
def get_security_logs(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    source_ip: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    classification: Optional[str] = Query(default=None),
):
    """Fetch security threat logs with optional filters, full-text search, and pagination."""
    where_clauses: list[str] = []
    params: dict = {"limit": limit, "offset": offset}

    if source_ip is not None:
        where_clauses.append("source_ip = :source_ip")
        params["source_ip"] = source_ip
    if severity is not None:
        requested = [s.strip().upper() for s in severity.split(",") if s.strip()]
        valid_sevs = [s for s in requested if s in _VALID_SEVERITIES]
        if valid_sevs:
            if len(valid_sevs) == 1:
                where_clauses.append("severity_level = :sev0")
                params["sev0"] = valid_sevs[0]
            else:
                placeholders = ", ".join(f":sev{i}" for i in range(len(valid_sevs)))
                where_clauses.append(f"severity_level IN ({placeholders})")
                for i, s in enumerate(valid_sevs):
                    params[f"sev{i}"] = s
    if classification is not None:
        requested = [c.strip() for c in classification.split(",") if c.strip()]
        invalid = [c for c in requested if c not in _VALID_CLASSIFICATIONS]
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid classification value(s): {', '.join(invalid)}. "
                f"Valid values: {', '.join(sorted(_VALID_CLASSIFICATIONS))}",
            )
        if requested:
            if len(requested) == 1:
                where_clauses.append("classification = :cls0")
                params["cls0"] = requested[0]
            else:
                placeholders = ", ".join(f":cls{i}" for i in range(len(requested)))
                where_clauses.append(f"classification IN ({placeholders})")
                for i, c in enumerate(requested):
                    params[f"cls{i}"] = c
    if date_from is not None:
        where_clauses.append("timestamp >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from
    if date_to is not None:
        where_clauses.append("timestamp <= CAST(:date_to AS timestamptz)")
        params["date_to"] = date_to
    if q:
        q = q.strip()
    if q:
        where_clauses.append("search_vector @@ websearch_to_tsquery('english', :q)")
        params["q"] = q

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    order_by = (
        "ts_rank(search_vector, websearch_to_tsquery('english', :q)) DESC"
        if q
        else "timestamp DESC"
    )

    rows = db.execute(
        text(f"""
            SELECT log_id, timestamp, source_ip, destination_ip, suricata_sid,
                   severity_level, raw_payload, xai_narrative, xai_confidence,
                   admin_action_taken, resolved_at, reviewed_by, hitl_decision,
                   classification, suricata_signature, suricata_category
            FROM wims.security_threat_logs
            {where_sql}
            ORDER BY {order_by}
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    total = (
        db.execute(
            text(f"SELECT COUNT(*) FROM wims.security_threat_logs {where_sql}"),
            params,
        ).scalar()
        or 0
    )

    return {
        "items": [
            {
                "log_id": r[0],
                "timestamp": r[1].isoformat() if r[1] else None,
                "source_ip": r[2],
                "destination_ip": r[3],
                "suricata_sid": r[4],
                "severity_level": r[5],
                "raw_payload": r[6],
                "xai_narrative": r[7],
                "xai_confidence": float(r[8]) if r[8] is not None else None,
                "admin_action_taken": r[9],
                "resolved_at": r[10].isoformat() if r[10] else None,
                "reviewed_by": str(r[11]) if r[11] else None,
                "hitl_decision": r[12],
                "classification": r[13],
                "suricata_signature": r[14],
                "suricata_category": r[15],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/security-logs/summary")
def get_security_logs_summary(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Aggregated security telemetry summary for the monitoring dashboard.

    Returns severity distribution counts, unreviewed threat count, total count,
    and the 5 most recent logs that have an XAI narrative.
    """
    sev_rows = db.execute(
        text(
            "SELECT severity_level, COUNT(*) FROM wims.security_threat_logs GROUP BY severity_level"
        )
    ).fetchall()
    by_severity: dict[str, int] = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    for row in sev_rows:
        level = (row[0] or "").upper()
        if level in by_severity:
            by_severity[level] = int(row[1])

    unreviewed = int(
        db.execute(
            text("SELECT COUNT(*) FROM wims.security_threat_logs WHERE hitl_decision IS NULL")
        ).scalar()
        or 0
    )

    total = int(db.execute(text("SELECT COUNT(*) FROM wims.security_threat_logs")).scalar() or 0)

    narrative_rows = db.execute(
        text(
            "SELECT log_id, severity_level, xai_narrative, timestamp "
            "FROM wims.security_threat_logs "
            "WHERE xai_narrative IS NOT NULL "
            "ORDER BY timestamp DESC "
            "LIMIT 5"
        )
    ).fetchall()
    recent_narratives = [
        {
            "log_id": r[0],
            "severity_level": r[1],
            "xai_narrative": r[2],
            "timestamp": r[3].isoformat() if r[3] else None,
        }
        for r in narrative_rows
    ]

    return {
        "by_severity": by_severity,
        "unreviewed_count": unreviewed,
        "total": total,
        "recent_narratives": recent_narratives,
    }


@router.post("/security-logs/{log_id}/analyze")
async def analyze_security_log(
    log_id: int,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Run AI analysis on a security threat log via Ollama. Updates xai_narrative and xai_confidence."""
    return await analyze_threat_log(log_id, db)


@router.patch("/security-logs/{log_id}")
def update_security_log(
    log_id: int,
    body: SecurityLogUpdate,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Update security log — structured HITL action or legacy free-text admin_action_taken."""
    updates: list[str] = []
    params: dict = {"log_id": log_id}

    # Fetch log metadata BEFORE UPDATE for email trigger context
    log_metadata = None
    if body.action == "CONFIRM_THREAT":
        log_metadata = db.execute(
            text(
                "SELECT severity_level, xai_narrative, timestamp "
                "FROM wims.security_threat_logs WHERE log_id = :log_id"
            ),
            {"log_id": log_id},
        ).fetchone()

    if body.action is not None:
        if body.action not in VALID_HITL_ACTIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid action. Must be one of: {', '.join(VALID_HITL_ACTIONS)}",
            )
        admin_action_taken = HITL_ACTION_LABELS[body.action]
        updates.append("admin_action_taken = :admin_action_taken")
        params["admin_action_taken"] = admin_action_taken

        now = datetime.now(timezone.utc).isoformat()
        decision_dict: dict[str, Any] = {
            "action": body.action,
            "note": body.note,
            "reviewed_by": _admin["user_id"],
            "reviewed_at": now,
        }
        updates.append("hitl_decision = CAST(:hitl_decision AS jsonb)")
        params["hitl_decision"] = json.dumps(decision_dict)

        if body.action in ("CONFIRM_THREAT", "FALSE_POSITIVE"):
            updates.append("resolved_at = now()")
        elif body.action == "REQUEST_MORE_INFO":
            updates.append("resolved_at = NULL")

    elif body.admin_action_taken is not None:
        updates.append("admin_action_taken = :admin_action_taken")
        params["admin_action_taken"] = body.admin_action_taken

    if body.resolved_at is not None:
        updates.append("resolved_at = CAST(:resolved_at AS timestamptz)")
        params["resolved_at"] = body.resolved_at

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    sql = f"UPDATE wims.security_threat_logs SET {', '.join(updates)} WHERE log_id = :log_id"
    result = db.execute(text(sql), params)
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Security log not found")

    log_system_audit(
        db,
        _admin["user_id"],
        "HITL_REVIEW",
        "security_threat_logs",
        log_id,
        request=request,
        new_values={
            "endpoint_action": body.action,
            "method": "PATCH",
            "path": f"/api/admin/security-logs/{log_id}",
            "log_id": log_id,
            "outcome": "SUCCESS",
        },
    )

    # M10d: breach record — must be created inside the HITL transaction while RLS
    # context (SET LOCAL) is still active. HIGH/CRITICAL confirmed threats are
    # presumptive data breaches under RA 10173 (issue #171).
    new_breach_id: int | None = None
    breach_detected_at: datetime | None = None
    breach_npc_deadline: datetime | None = None
    if (
        body.action == "CONFIRM_THREAT"
        and log_metadata is not None
        and log_metadata[0] in ("HIGH", "CRITICAL")
    ):
        breach_detected_at = datetime.now(timezone.utc)
        breach_npc_deadline = breach_detected_at + timedelta(hours=72)
        breach_row = db.execute(
            text(
                "INSERT INTO wims.breach_notifications"
                " (threat_log_id, detected_at, npc_deadline_at, status, reported_by)"
                " VALUES ("
                " :log_id, :detected_at, :npc_deadline_at, 'DETECTED',"
                " (SELECT user_id FROM wims.users WHERE user_id = CAST(:reported_by AS uuid))"
                ")"
                " RETURNING breach_id"
            ),
            {
                "log_id": log_id,
                "detected_at": breach_detected_at,
                "npc_deadline_at": breach_npc_deadline,
                "reported_by": _admin["user_id"],
            },
        ).fetchone()
        new_breach_id = breach_row[0]
        log_system_audit(
            db,
            _admin["user_id"],
            "BREACH_DETECTED",
            "breach_notifications",
            new_breach_id,
            request=request,
            new_values={
                "endpoint_action": body.action,
                "method": "PATCH",
                "path": f"/api/admin/security-logs/{log_id}",
                "log_id": log_id,
                "breach_id": new_breach_id,
                "outcome": "SUCCESS",
            },
        )

    db.commit()

    # M13b + M10d: email dispatch — runs after commit (Celery tasks, no RLS needed)
    if (
        body.action == "CONFIRM_THREAT"
        and log_metadata is not None
        and log_metadata[0] in ("HIGH", "CRITICAL")
    ):
        # Security/breach alerts bypass email_opt_in — critical regulatory notifications
        admin_emails = [
            row[0]
            for row in db.execute(
                text(
                    "SELECT email FROM wims.users"
                    " WHERE role = 'SYSTEM_ADMIN' AND is_active = TRUE AND email IS NOT NULL"
                )
            ).fetchall()
        ]
        if admin_emails:
            from tasks.notifications import send_email_task

            frontend_url = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
            send_email_task.delay(
                to=admin_emails,
                template_name="security_alert",
                context={
                    "severity": log_metadata[0],
                    "summary": log_metadata[1] or "No details available",
                    "detected_at": (log_metadata[2].isoformat() if log_metadata[2] else "Unknown"),
                    "dashboard_link": f"{frontend_url}/admin/monitoring",
                },
            )
            if new_breach_id is not None:
                send_email_task.delay(
                    to=admin_emails,
                    template_name="breach_alert",
                    context={
                        "breach_id": new_breach_id,
                        "severity": log_metadata[0],
                        "summary": log_metadata[1] or "No details available",
                        "detected_at": breach_detected_at.isoformat(),
                        "npc_deadline": breach_npc_deadline.isoformat(),
                        "dashboard_link": f"{frontend_url}/admin/breach",
                    },
                )

    # Publish real-time SSE event
    publish_security_event_sync(
        "security.hitl_confirmed",
        log_id=log_id,
        actor_id=_admin["user_id"],
        extra={"action": body.action} if body.action else {},
    )

    return {"status": "ok", "log_id": log_id}


@router.post("/security-logs/{log_id}/create-incident")
def create_incident_from_alert(
    log_id: int,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Manually create a DRAFT fire incident from a reviewed security alert."""
    row = db.execute(
        text("""
            SELECT log_id, source_ip, suricata_sid, raw_payload
            FROM wims.security_threat_logs
            WHERE log_id = :log_id
        """),
        {"log_id": log_id},
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Security log not found")

    from services.suricata_ingestion import _security_incident_exists

    if _security_incident_exists(db, log_id):
        raise HTTPException(status_code=409, detail="An incident already exists for this alert")

    source_ip = row[1] or "unknown"
    suricata_sid = row[2] or 0
    raw_payload = row[3] or ""

    try:
        incident_id = _create_security_incident(
            db,
            log_id=log_id,
            source_ip=source_ip,
            suricata_sid=suricata_sid,
            raw_payload=raw_payload,
        )
        db.execute(
            text("""
                UPDATE wims.security_threat_logs
                SET reviewed_by = CAST(:uid AS uuid)
                WHERE log_id = :log_id
            """),
            {"uid": _admin["user_id"], "log_id": log_id},
        )
        log_system_audit(
            db,
            _admin["user_id"],
            "CREATE_INCIDENT_FROM_ALERT",
            "security_threat_logs",
            log_id,
            request=request,
            new_values={
                "endpoint_action": "CREATE_INCIDENT",
                "method": "POST",
                "path": f"/api/admin/security-logs/{log_id}/create-incident",
                "log_id": log_id,
                "incident_id": incident_id,
                "outcome": "SUCCESS",
            },
        )
        db.commit()
        return {"status": "ok", "incident_id": incident_id}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An incident already exists for this alert")
    except Exception:
        logger.exception("Failed to create incident from alert log_id=%s", log_id)
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to create incident from alert",
        )


@router.get("/security-logs/{log_id}/related-audit")
def get_related_audit(
    log_id: int,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Return audit trail rows related to the given security log.

    Queries system_audit_trails for rows within ±1 hour of the alert's
    timestamp where either:
      - table_affected = 'security_threat_logs' AND record_id = log_id, OR
      - old_values or new_values JSONB contains a log_id matching the requested id.

    Returns an empty list when no related audit rows exist; 404 if the alert
    itself is missing.
    """
    # Verify the alert exists first
    alert = db.execute(
        text("SELECT log_id, timestamp FROM wims.security_threat_logs WHERE log_id = :log_id"),
        {"log_id": log_id},
    ).fetchone()
    if alert is None:
        raise HTTPException(status_code=404, detail="Security log not found")

    alert_ts = alert[1]
    window_start = None
    window_end = None
    if alert_ts is not None:
        window_start = alert_ts - timedelta(hours=1)
        window_end = alert_ts + timedelta(hours=1)

    # Query audit rows: direct match via table_affected + record_id OR JSONB log_id match
    query = text(
        """
        SELECT audit_id, user_id, action_type, table_affected, record_id,
               ip_address, user_agent, timestamp, new_values, old_values
        FROM wims.system_audit_trails
        WHERE (
            (table_affected = 'security_threat_logs' AND record_id = :log_id)
            OR (new_values ->> 'log_id') = CAST(:log_id_str AS text)
            OR (old_values ->> 'log_id') = CAST(:log_id_str2 AS text)
        )
        {time_window}
        ORDER BY timestamp DESC
        LIMIT 100
    """.format(
            time_window=(
                "AND timestamp >= CAST(:window_start AS timestamptz) AND timestamp <= CAST(:window_end AS timestamptz)"
                if window_start and window_end
                else ""
            )
        )
    )

    params: dict = {
        "log_id": log_id,
        "log_id_str": str(log_id),
        "log_id_str2": str(log_id),
    }
    if window_start and window_end:
        params["window_start"] = window_start
        params["window_end"] = window_end

    rows = db.execute(query, params).fetchall()

    return {
        "log_id": log_id,
        "items": [
            {
                "audit_id": r[0],
                "user_id": str(r[1]) if r[1] else None,
                "action_type": r[2],
                "table_affected": r[3],
                "record_id": r[4],
                "ip_address": r[5],
                "user_agent": r[6],
                "timestamp": r[7].isoformat() if r[7] else None,
                "new_values": r[8],
                "old_values": r[9],
            }
            for r in rows
        ],
    }
