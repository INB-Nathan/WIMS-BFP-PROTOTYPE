"""National Analyst Analytics API — Read-only Intelligence Loop.

All endpoints require NATIONAL_ANALYST or SYSTEM_ADMIN.
Scoped to verified, non-archived incidents only.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_analyst_or_admin
from database import get_db

from tasks.exports import export_incidents_csv_task

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ---------------------------------------------------------------------------
# Base filter: verified + non-archived
# ---------------------------------------------------------------------------
_VERIFIED_ARCHIVED = "fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE"


def _build_heatmap_where(
    start_date: Optional[str],
    end_date: Optional[str],
    region_id: Optional[int],
    alarm_level: Optional[str],
    incident_type: Optional[str],
) -> tuple[str, dict]:
    clauses = [_VERIFIED_ARCHIVED]
    params: dict[str, Any] = {}
    if start_date:
        clauses.append("nd.notification_dt >= CAST(:start_date AS timestamptz)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("nd.notification_dt <= CAST(:end_date AS timestamptz)")
        params["end_date"] = end_date
    if region_id is not None:
        clauses.append("fi.region_id = :region_id")
        params["region_id"] = region_id
    if alarm_level:
        clauses.append("nd.alarm_level = :alarm_level")
        params["alarm_level"] = alarm_level
    if incident_type:
        clauses.append("nd.general_category = :incident_type")
        params["incident_type"] = incident_type
    return " AND ".join(clauses), params


@router.get("/heatmap")
def get_heatmap(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db)],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    alarm_level: Optional[str] = None,
    incident_type: Optional[str] = None,
):
    """
    GeoJSON-compatible heatmap data for verified incidents.
    """
    where_sql, params = _build_heatmap_where(
        start_date, end_date, region_id, alarm_level, incident_type
    )
    rows = db.execute(
        text(f"""
            SELECT fi.incident_id,
                   ST_X(fi.location::geometry) AS lon,
                   ST_Y(fi.location::geometry) AS lat,
                   nd.alarm_level, nd.general_category, nd.notification_dt
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
        """),
        params,
    ).fetchall()

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(r[1]), float(r[2])]},
            "properties": {
                "incident_id": r[0],
                "alarm_level": r[3],
                "general_category": r[4],
                "notification_dt": r[5].isoformat() if r[5] else None,
            },
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


def _build_trends_where(
    start_date: Optional[str],
    end_date: Optional[str],
    region_id: Optional[int],
    incident_type: Optional[str],
) -> tuple[str, dict]:
    clauses = [_VERIFIED_ARCHIVED]
    params: dict[str, Any] = {}
    if start_date:
        clauses.append("nd.notification_dt >= CAST(:start_date AS timestamptz)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("nd.notification_dt <= CAST(:end_date AS timestamptz)")
        params["end_date"] = end_date
    if region_id is not None:
        clauses.append("fi.region_id = :region_id")
        params["region_id"] = region_id
    if incident_type:
        clauses.append("nd.general_category = :incident_type")
        params["incident_type"] = incident_type
    return " AND ".join(clauses), params


@router.get("/trends")
def get_trends(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db)],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    incident_type: Optional[str] = None,
    interval: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
):
    """
    Time-series counts for line/bar charts.
    """
    where_sql, params = _build_trends_where(
        start_date, end_date, region_id, incident_type
    )
    trunc_val = {"daily": "day", "weekly": "week", "monthly": "month"}[interval]

    rows = db.execute(
        text(f"""
            SELECT date_trunc('{trunc_val}', nd.notification_dt) AS bucket, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql} AND nd.notification_dt IS NOT NULL
            GROUP BY date_trunc('{trunc_val}', nd.notification_dt)
            ORDER BY bucket
        """),
        params,
    ).fetchall()

    return {
        "data": [{"bucket": r[0].isoformat() if r[0] else None, "count": r[1]} for r in rows]
    }


def _count_in_range(
    db: Session,
    range_start: str,
    range_end: str,
    region_id: Optional[int],
    incident_type: Optional[str],
) -> int:
    clauses = [
        _VERIFIED_ARCHIVED,
        "nd.notification_dt >= CAST(:range_start AS timestamptz)",
        "nd.notification_dt <= CAST(:range_end AS timestamptz)",
    ]
    params: dict[str, Any] = {
        "range_start": range_start,
        "range_end": range_end,
    }
    if region_id is not None:
        clauses.append("fi.region_id = :region_id")
        params["region_id"] = region_id
    if incident_type:
        clauses.append("nd.general_category = :incident_type")
        params["incident_type"] = incident_type
    where_sql = " AND ".join(clauses)
    result = db.execute(
        text(f"""
            SELECT COUNT(*)
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
        """),
        params,
    ).scalar()
    return result or 0


@router.get("/comparative")
def get_comparative(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db)],
    range_a_start: str = Query(...),
    range_a_end: str = Query(...),
    range_b_start: str = Query(...),
    range_b_end: str = Query(...),
    region_id: Optional[int] = Query(None),
    incident_type: Optional[str] = None,
):
    """
    Comparative counts for two date ranges with percentage variance.
    """
    count_a = _count_in_range(db, range_a_start, range_a_end, region_id, incident_type)
    count_b = _count_in_range(db, range_b_start, range_b_end, region_id, incident_type)

    variance_pct = 0.0
    if count_a > 0:
        variance_pct = ((count_b - count_a) / count_a) * 100

    return {
        "range_a": {"start": range_a_start, "end": range_a_end, "count": count_a},
        "range_b": {"start": range_b_start, "end": range_b_end, "count": count_b},
        "variance_percent": round(variance_pct, 2),
    }


class ExportCsvRequest(BaseModel):
    filters: dict[str, Any] = {}
    columns: list[str] = []


@router.post("/export/csv")
def export_csv(
    body: ExportCsvRequest,
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """
    Dispatch Celery task for CSV export. Returns task_id.
    """
    result = export_incidents_csv_task.delay(
        filters=body.filters,
        columns=body.columns,
    )
    return {"task_id": result.id}
