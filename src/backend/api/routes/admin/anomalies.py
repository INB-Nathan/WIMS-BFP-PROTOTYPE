"""System Admin API — behavioral anomaly detection management.

List/filter anomaly detections and manage their lifecycle status
(NEW → ACKNOWLEDGED → RESOLVED).  Every status transition is audited.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin, get_db_with_rls

logger = logging.getLogger("wims.admin.anomalies")
router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALID_STATUSES: frozenset[str] = frozenset({"NEW", "ACKNOWLEDGED", "RESOLVED"})
VALID_SEVERITIES: frozenset[str] = frozenset({"LOW", "MEDIUM", "HIGH", "CRITICAL"})
VALID_TRANSITIONS: dict[str, set[str]] = {
    "NEW": {"ACKNOWLEDGED"},
    "ACKNOWLEDGED": {"RESOLVED"},
    "RESOLVED": set(),  # terminal — no further transitions
}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class AnomalyStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        upper = v.upper()
        if upper not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {v}. Must be one of {sorted(VALID_STATUSES)}")
        return upper


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/anomalies")
def list_anomalies(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    status: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    anomaly_type: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List behavioral anomaly detections with optional filters and pagination.

    SYSTEM_ADMIN only (RLS-enforced via get_db_with_rls).
    """
    where_clauses: list[str] = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}

    if status is not None:
        where_clauses.append("status = :status")
        params["status"] = status.upper()
    if severity is not None:
        where_clauses.append("severity = :severity")
        params["severity"] = severity.upper()
    if anomaly_type is not None:
        where_clauses.append("anomaly_type = :anomaly_type")
        params["anomaly_type"] = anomaly_type.upper()

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    rows = db.execute(
        text(f"""
            SELECT anomaly_id, anomaly_type, subject_user_id, severity,
                   details, detected_at, status, dedup_key
            FROM wims.anomaly_detections
            {where_sql}
            ORDER BY detected_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    # Aggregate query params — exclude pagination
    agg_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    total = (
        db.execute(
            text(f"SELECT COUNT(*) FROM wims.anomaly_detections {where_sql}"),
            agg_params,
        ).scalar()
        or 0
    )

    # Status aggregate counts (same filter scope as total)
    status_rows = db.execute(
        text(f"""
            SELECT status, COUNT(*) as cnt
            FROM wims.anomaly_detections
            {where_sql}
            GROUP BY status
        """),
        agg_params,
    ).fetchall()
    counts: dict[str, int] = {row[0]: row[1] for row in status_rows}
    # Ensure all three statuses are present even if zero in filtered set
    for s in VALID_STATUSES:
        counts.setdefault(s, 0)

    # Type facets (same filter scope)
    type_rows = db.execute(
        text(f"""
            SELECT anomaly_type, COUNT(*) as cnt
            FROM wims.anomaly_detections
            {where_sql}
            GROUP BY anomaly_type
            ORDER BY cnt DESC, anomaly_type
        """),
        agg_params,
    ).fetchall()
    type_facets = [{"type": row[0], "count": row[1]} for row in type_rows]

    return {
        "items": [
            {
                "anomaly_id": r[0],
                "anomaly_type": r[1],
                "subject_user_id": str(r[2]) if r[2] else None,
                "severity": r[3],
                "details": r[4]
                if isinstance(r[4], dict)
                else (json.loads(r[4]) if isinstance(r[4], str) else {}),
                "detected_at": r[5].isoformat() if r[5] else None,
                "status": r[6],
                "dedup_key": r[7],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
        "counts": counts,
        "type_facets": type_facets,
    }


@router.patch("/anomalies/{anomaly_id}")
def update_anomaly_status(
    anomaly_id: int,
    body: AnomalyStatusUpdate,
    admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Transition anomaly detection status.

    Allowed transitions:
        NEW → ACKNOWLEDGED
        ACKNOWLEDGED → RESOLVED
        RESOLVED → (terminal, no further transitions)

    Each transition is audit-logged with action_type ANOMALY_ACK/ANOMALY_RESOLVE.
    """
    # Fetch current state
    row = db.execute(
        text(
            "SELECT anomaly_id, anomaly_type, severity, status, subject_user_id "
            "FROM wims.anomaly_detections WHERE anomaly_id = :anomaly_id"
        ),
        {"anomaly_id": anomaly_id},
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Anomaly not found")

    current_status = row[3]

    # Validate transition
    new_status = body.status
    allowed = VALID_TRANSITIONS.get(current_status, set())
    if new_status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot transition from {current_status} to {new_status}. "
                f"Allowed transitions: {sorted(allowed)}"
            ),
        )

    # Update
    now = datetime.now(timezone.utc)
    audit_action = "ANOMALY_ACK" if new_status == "ACKNOWLEDGED" else "ANOMALY_RESOLVE"

    db.execute(
        text("""
            UPDATE wims.anomaly_detections
            SET status = :status,
                details = details || CAST(:audit_blob AS jsonb)
            WHERE anomaly_id = :anomaly_id
        """),
        {
            "status": new_status,
            "anomaly_id": anomaly_id,
            "audit_blob": json.dumps(
                {
                    "status_changed_at": now.isoformat(),
                    "status_changed_by": admin["user_id"],
                    "previous_status": current_status,
                    "new_status": new_status,
                    "action": audit_action,
                }
            ),
        },
    )

    # Audit trail
    db.execute(
        text("""
            INSERT INTO wims.system_audit_trails
                (user_id, action_type, table_affected, record_id,
                 ip_address, user_agent)
            VALUES (
                CAST(:user_id AS uuid),
                :action_type,
                'anomaly_detections',
                :record_id,
                :ip_address,
                :user_agent
            )
        """),
        {
            "user_id": admin["user_id"],
            "action_type": audit_action,
            "record_id": anomaly_id,
            "ip_address": _safe_ip(admin),
            "user_agent": "anomalies-api",
        },
    )

    db.commit()

    logger.info(
        "Anomaly %d transitioned %s → %s by %s",
        anomaly_id,
        current_status,
        new_status,
        admin["user_id"],
    )

    return {
        "status": "ok",
        "anomaly_id": anomaly_id,
        "previous_status": current_status,
        "new_status": new_status,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_ip(user: dict) -> str | None:
    """Extract client IP from user dict if present (injected by middleware)."""
    return user.get("ip_address") or None
