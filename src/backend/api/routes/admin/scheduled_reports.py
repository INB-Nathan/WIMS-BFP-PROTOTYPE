"""System Admin API — scheduled reports routes."""

import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls

router = APIRouter()

_CRON_RE = re.compile(
    r"^(\*|[0-5]?\d|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[01]?\d|2[0-3]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[12]?\d|3[01]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[01]?\d|1[0-2]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[0-6]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)?$"
)


class ScheduledReportCreate(BaseModel):
    name: str
    cron_expr: str
    format: Literal["pdf", "excel", "csv"]
    filters: dict[str, Any] = {}
    recipients: list[str] = []
    enabled: bool = True

    @field_validator("cron_expr")
    @classmethod
    def cron_must_be_valid(cls, v: str) -> str:
        if not _CRON_RE.match(v.strip()):
            raise ValueError("Invalid cron expression")
        return v


class ScheduledReportUpdate(BaseModel):
    enabled: bool


@router.post("/scheduled-reports", status_code=201)
def create_scheduled_report(
    body: ScheduledReportCreate,
    _user: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Create a scheduled analytics report."""
    result = db.execute(
        text("""
            INSERT INTO wims.scheduled_reports (name, cron_expr, format, filters, recipients, enabled)
            VALUES (:name, :cron_expr, :format, :filters, :recipients, :enabled)
            RETURNING id, name, cron_expr, format, recipients, enabled, created_at
        """),
        {
            "name": body.name,
            "cron_expr": body.cron_expr,
            "format": body.format,
            "filters": body.filters,
            "recipients": body.recipients,
            "enabled": body.enabled,
        },
    ).fetchone()
    db.commit()
    return {
        "id": result[0],
        "name": result[1],
        "cron_expr": result[2],
        "format": result[3],
        "recipients": result[4] if result[4] is not None else [],
        "enabled": result[5],
        "created_at": result[6].isoformat() if result[6] else None,
    }


@router.get("/scheduled-reports")
def list_scheduled_reports(
    _user: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """List all scheduled analytics reports."""
    rows = db.execute(
        text(
            "SELECT id, name, cron_expr, format, recipients, enabled, created_at FROM wims.scheduled_reports ORDER BY id DESC"
        )
    ).fetchall()
    return [
        {
            "id": r[0],
            "name": r[1],
            "cron_expr": r[2],
            "format": r[3],
            "recipients": r[4] if r[4] is not None else [],
            "enabled": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


@router.patch("/scheduled-reports/{report_id}", status_code=200)
def update_scheduled_report(
    report_id: int,
    body: ScheduledReportUpdate,
    _user: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Enable or disable a scheduled report."""
    result = db.execute(
        text("""
            UPDATE wims.scheduled_reports
            SET enabled = :enabled
            WHERE id = :id
            RETURNING id, name, enabled
        """),
        {"id": report_id, "enabled": body.enabled},
    ).fetchone()
    if result is None:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    db.commit()
    return {"status": "ok", "id": result[0], "name": result[1], "enabled": result[2]}
