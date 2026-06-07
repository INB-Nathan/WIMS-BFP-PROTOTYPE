"""System Admin API — audit oversight routes."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls

router = APIRouter()


@router.get("/audit-logs")
def get_audit_logs(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user_id: Optional[int] = Query(default=None),
    action_type: Optional[str] = Query(default=None),
    table_affected: Optional[str] = Query(default=None),
    ip_address: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
):
    """Fetch system audit trails with optional filters and pagination."""
    where_clauses: list[str] = []
    params: dict = {"limit": limit, "offset": offset}

    if user_id is not None:
        where_clauses.append("user_id = :user_id")
        params["user_id"] = user_id
    if action_type is not None:
        where_clauses.append("action_type = :action_type")
        params["action_type"] = action_type
    if table_affected is not None:
        where_clauses.append("table_affected = :table_affected")
        params["table_affected"] = table_affected
    if ip_address is not None:
        where_clauses.append("ip_address = :ip_address")
        params["ip_address"] = ip_address
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
            SELECT audit_id, user_id, action_type, table_affected, record_id,
                   ip_address, user_agent, timestamp
            FROM wims.system_audit_trails
            {where_sql}
            ORDER BY timestamp DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    total = (
        db.execute(
            text(f"SELECT COUNT(*) FROM wims.system_audit_trails {where_sql}"),
            params,
        ).scalar()
        or 0
    )

    return {
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
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
