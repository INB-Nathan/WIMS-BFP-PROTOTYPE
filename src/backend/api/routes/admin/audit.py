"""System Admin API — audit oversight routes."""

import csv
import io
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from services.ai_service import analyze_audit_logs
from services.audit_export import build_audit_where
from services.audit_export_orchestration import (
    AuditExportAuditError,
    AuditExportTooLargeError,
    build_admin_export,
)
from services.audit_export_verifier import (
    ArchiveTooLargeError,
    ArchiveValidationError,
    verify_online_package,
)
from services.kms.openbao_client import OpenBaoClient, OpenBaoClientError
from schemas.audit_export import AuditExportVerificationResponse
from utils.audit import log_system_audit

logger = logging.getLogger(__name__)

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
        where_clauses.append("sat.user_id = :user_id")
        params["user_id"] = user_id
    if action_type is not None:
        where_clauses.append("sat.action_type = :action_type")
        params["action_type"] = action_type
    if table_affected is not None:
        where_clauses.append("sat.table_affected = :table_affected")
        params["table_affected"] = table_affected
    if ip_address is not None:
        where_clauses.append("sat.ip_address = :ip_address")
        params["ip_address"] = ip_address
    if date_from is not None:
        where_clauses.append("sat.timestamp >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from
    if date_to is not None:
        where_clauses.append("sat.timestamp <= CAST(:date_to AS timestamptz)")
        params["date_to"] = date_to
    if q:
        q = q.strip()
    if q:
        where_clauses.append("sat.search_vector @@ websearch_to_tsquery('english', :q)")
        params["q"] = q

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    order_by = (
        "ts_rank(sat.search_vector, websearch_to_tsquery('english', :q)) DESC"
        if q
        else "sat.timestamp DESC"
    )

    rows = db.execute(
        text(f"""
            SELECT sat.audit_id, sat.user_id, sat.action_type, sat.table_affected,
                   sat.record_id, sat.ip_address, sat.user_agent, sat.timestamp,
                   sat.old_values, sat.new_values,
                   u.username
            FROM wims.system_audit_trails sat
            LEFT JOIN wims.users u ON sat.user_id = u.user_id
            {where_sql}
            ORDER BY {order_by}
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    total = (
        db.execute(
            text(f"SELECT COUNT(*) FROM wims.system_audit_trails sat {where_sql}"),
            params,
        ).scalar()
        or 0
    )

    def _row_value(row, key: str, index: int):
        mapping = getattr(row, "_mapping", None)
        if mapping is not None:
            return mapping.get(key)
        return row[index] if len(row) > index else None

    # Index of username column in the SELECT (10 columns before it)
    _USERNAME_IDX = 10

    return {
        "items": [
            {
                "audit_id": r[0],
                "user_id": str(r[1]) if r[1] else None,
                "user_name": r[_USERNAME_IDX]
                if len(r) > _USERNAME_IDX and r[_USERNAME_IDX]
                else None,
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


@router.get("/audit-logs/export")
def export_audit_logs(
    admin: Annotated[dict, Depends(get_system_admin)],
    request: Request,
    db: Annotated[Session, Depends(get_db_with_rls)],
    user_id: Optional[int] = Query(default=None),
    action_type: Optional[str] = Query(default=None),
    table_affected: Optional[str] = Query(default=None),
    ip_address: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
):
    """Export the system audit trail as CSV (RP-23). Honors the same filters as
    the list endpoint. SYSTEM_ADMIN only.

    RP-23: the export action itself is recorded in the audit trail so a
    SYSTEM_ADMIN cannot deny exporting sensitive audit data.
    """
    where_sql, params = build_audit_where(
        user_id=user_id,
        action_type=action_type,
        table_affected=table_affected,
        ip_address=ip_address,
        date_from=date_from,
        date_to=date_to,
        q=q,
    )

    rows = db.execute(
        text(f"""
            SELECT sat.audit_id, sat.timestamp, u.username, sat.user_id,
                   sat.action_type, sat.table_affected, sat.record_id,
                   sat.result, sat.ip_address, sat.correlation_id, sat.user_agent
            FROM wims.system_audit_trails sat
            LEFT JOIN wims.users u ON sat.user_id = u.user_id
            {where_sql}
            ORDER BY sat.timestamp DESC
        """),
        params,
    ).fetchall()

    # RP-23: record the export action itself in the audit trail so a
    # SYSTEM_ADMIN cannot deny exporting sensitive audit data.
    # If the audit write fails, log and continue — the CSV export still
    # succeeds (the data was already fetched).
    try:
        log_system_audit(
            db,
            admin["user_id"],
            "AUDIT_EXPORT",
            "wims.system_audit_trails",
            None,
            request,
        )
        db.commit()
    except Exception:
        logger.warning("Failed to record AUDIT_EXPORT audit row", exc_info=True)
        db.rollback()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "audit_id",
            "timestamp",
            "username",
            "user_id",
            "action_type",
            "table_affected",
            "record_id",
            "result",
            "ip_address",
            "correlation_id",
            "user_agent",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r[0],
                r[1].isoformat() if r[1] else "",
                r[2] or "",
                str(r[3]) if r[3] else "",
                r[4],
                r[5] or "",
                r[6] if r[6] is not None else "",
                r[7] or "",
                r[8] or "",
                r[9] or "",
                (r[10] or "").replace("\n", " "),
            ]
        )

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=system_audit_trail.csv"},
    )


@router.get("/audit-logs/export/secure")
def export_secure_audit_logs(
    admin: Annotated[dict, Depends(get_system_admin)],
    request: Request,
    db: Annotated[Session, Depends(get_db_with_rls)],
    user_id: Optional[int] = Query(default=None),
    action_type: Optional[str] = Query(default=None),
    table_affected: Optional[str] = Query(default=None),
    ip_address: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
):
    """Return a signed, tamper-evident CSV/PDF audit export package."""
    try:
        package = build_admin_export(
            db,
            admin,
            {
                "user_id": user_id,
                "action_type": action_type,
                "table_affected": table_affected,
                "ip_address": ip_address,
                "date_from": date_from,
                "date_to": date_to,
                "q": q,
            },
            request,
        )
    except AuditExportTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except OpenBaoClientError as exc:
        raise HTTPException(status_code=503, detail="audit signing service unavailable") from exc
    except AuditExportAuditError as exc:
        raise HTTPException(
            status_code=500, detail="secure export audit could not be recorded"
        ) from exc
    return Response(
        content=package.zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="audit-export-{package.export_uuid}.zip"'
        },
    )


@router.post("/audit-logs/export/verify", response_model=AuditExportVerificationResponse)
def verify_secure_audit_export(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    file: UploadFile = File(...),
):
    """Verify a signed audit export and report per-component checks."""
    payload = file.file.read(100 * 1024 * 1024 + 1)
    try:
        verified, warnings, checks, manifest = verify_online_package(
            payload, client=OpenBaoClient(), db=db
        )
    except ArchiveTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ArchiveValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OpenBaoClientError as exc:
        raise HTTPException(status_code=503, detail="audit signing service unavailable") from exc
    return AuditExportVerificationResponse(
        verified=verified,
        warnings=warnings,
        checks=checks,
        manifest=manifest,
    )


@router.post("/audit-logs/analyze")
async def analyze_audit_entries(
    body: AuditLogsAnalyzeRequest,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Run AI analysis on selected audit log entries via Ollama."""
    return await analyze_audit_logs(body.audit_ids, db)
