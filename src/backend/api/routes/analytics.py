"""National Analyst Analytics API — Read-only Intelligence Loop.

All endpoints require NATIONAL_ANALYST or SYSTEM_ADMIN.
Scoped to verified, non-archived incidents only.
Queries wims.analytics_incident_facts (read model) instead of raw operational tables.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_analyst_or_admin
from database import get_db
from services.analytics_read_model import (
    count_in_range,
    get_heatmap_points,
    get_trends,
    verify_indexed_access,
)

from tasks.exports import export_incidents_csv_task

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


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
    Uses wims.analytics_incident_facts (indexed access).
    """
    points = get_heatmap_points(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        alarm_level=alarm_level,
        incident_type=incident_type,
    )
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
            "properties": {
                "incident_id": p["incident_id"],
                "alarm_level": p["alarm_level"],
                "general_category": p["general_category"],
                "notification_dt": p["notification_dt"],
            },
        }
        for p in points
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/trends")
def get_trends_route(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db)],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    interval: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
):
    """
    Time-series counts for line/bar charts.
    Uses wims.analytics_incident_facts (indexed access).
    """
    data = get_trends(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        incident_type=incident_type,
        alarm_level=alarm_level,
        interval=interval,
    )
    return {"data": data}


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
    alarm_level: Optional[str] = None,
):
    """
    Comparative counts for two date ranges with percentage variance.
    Uses wims.analytics_incident_facts (indexed access).
    """
    count_a = count_in_range(
        db,
        range_a_start,
        range_a_end,
        region_id=region_id,
        incident_type=incident_type,
        alarm_level=alarm_level,
    )
    count_b = count_in_range(
        db,
        range_b_start,
        range_b_end,
        region_id=region_id,
        incident_type=incident_type,
        alarm_level=alarm_level,
    )

    variance_pct = 0.0
    if count_a > 0:
        variance_pct = ((count_b - count_a) / count_a) * 100

    return {
        "range_a": {"start": range_a_start, "end": range_a_end, "count": count_a},
        "range_b": {"start": range_b_start, "end": range_b_end, "count": count_b},
        "variance_percent": round(variance_pct, 2),
    }


@router.get("/execution-plans")
def get_execution_plans(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """
    Return EXPLAIN output for analytics queries.
    Evidence that filtered queries use indexed access or pre-aggregated objects.
    """
    return verify_indexed_access(db)


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
