"""System Admin API — security telemetry routes."""

import json
import os
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from services.ai_service import analyze_threat_log
from services.event_bus import publish_security_event_sync

router = APIRouter()

VALID_HITL_ACTIONS = ("CONFIRM_THREAT", "FALSE_POSITIVE", "REQUEST_MORE_INFO")

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
):
    """Fetch security threat logs with optional filters and pagination."""
    where_clauses: list[str] = []
    params: dict = {"limit": limit, "offset": offset}

    if source_ip is not None:
        where_clauses.append("source_ip = :source_ip")
        params["source_ip"] = source_ip
    if severity is not None:
        where_clauses.append("severity_level = :severity")
        params["severity"] = severity
    if date_from is not None:
        where_clauses.append("timestamp >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from
    if date_to is not None:
        where_clauses.append("timestamp <= CAST(:date_to AS timestamptz)")
        params["date_to"] = date_to

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    rows = db.execute(
        text(f"""
            SELECT log_id, timestamp, source_ip, destination_ip, suricata_sid,
                   severity_level, raw_payload, xai_narrative, xai_confidence,
                   admin_action_taken, resolved_at, reviewed_by, hitl_decision
            FROM wims.security_threat_logs
            {where_sql}
            ORDER BY timestamp DESC
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
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
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
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Security log not found")

    # M13b: security_alert email trigger
    if (
        body.action == "CONFIRM_THREAT"
        and log_metadata is not None
        and log_metadata[0] in ("HIGH", "CRITICAL")
    ):
        # Security alerts are critical — intentionally bypass email_opt_in preference
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
            dashboard_link = f"{frontend_url}/admin/security-dashboard"
            send_email_task.delay(
                to=admin_emails,
                template_name="security_alert",
                context={
                    "severity": log_metadata[0],
                    "summary": log_metadata[1] or "No details available",
                    "detected_at": (log_metadata[2].isoformat() if log_metadata[2] else "Unknown"),
                    "dashboard_link": dashboard_link,
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
