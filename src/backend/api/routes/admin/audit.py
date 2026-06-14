"""System Admin API — audit oversight routes."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from services.ai_service import analyze_audit_logs

router = APIRouter()


class AuditLogsAnalyzeRequest(BaseModel):
    audit_ids: list[int]


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
    q: Optional[str] = Query(default=None),
):
    """Fetch system audit trails with optional filters, full-text search, and pagination."""
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
            SELECT audit_id, user_id, action_type, table_affected, record_id,
                   ip_address, user_agent, timestamp,
                   old_values, new_values
            FROM wims.system_audit_trails
            {where_sql}
            ORDER BY {order_by}
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

    def _row_value(row, key: str, index: int):
        mapping = getattr(row, "_mapping", None)
        if mapping is not None:
            return mapping.get(key)
        return row[index] if len(row) > index else None

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
                "old_values": _row_value(r, "old_values", 8),
                "new_values": _row_value(r, "new_values", 9),
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/audit-logs/analyze")
async def analyze_audit_entries(
    body: AuditLogsAnalyzeRequest,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Run AI analysis on selected audit log entries via Ollama."""
    return await analyze_audit_logs(body.audit_ids, db)
