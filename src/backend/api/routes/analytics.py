"""National Analyst Analytics API — Read-only Intelligence Loop.

All endpoints require NATIONAL_ANALYST or SYSTEM_ADMIN.
Scoped to verified, non-archived incidents only.
Queries wims.analytics_incident_facts (read model) instead of raw operational tables.
"""

from __future__ import annotations

import os
from typing import Annotated, Any, Optional

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from celery_config import celery_app
from auth import get_analyst_or_admin
from database import get_db_with_rls
from services.analytics_read_model import (
    count_in_range,
    get_filter_options,
    get_heatmap_points,
    get_trends,
    get_type_distribution,
    get_response_time_by_region,
    get_compare_regions,
    get_top_n,
    verify_indexed_access,
)

from tasks.exports import (
    export_incidents_csv_task,
    export_incidents_pdf_task,
    export_incidents_excel_task,
)
from tasks.analytics_refresh import refresh_materialized_views

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.post("/refresh-views", status_code=status.HTTP_202_ACCEPTED)
def trigger_materialized_view_refresh(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """Queue a non-blocking CONCURRENTLY refresh for analytics materialized views."""
    result = refresh_materialized_views.delay(concurrent=True)
    return {"task_id": result.id, "status": "queued"}


@router.get("/heatmap")
def get_heatmap(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    region_ids: Optional[str] = Query(None, description="Comma-separated region IDs"),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    alarm_level: Optional[str] = None,
    incident_type: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """
    GeoJSON-compatible heatmap data for verified incidents.
    Uses wims.analytics_incident_facts (indexed access).
    """
    if damage_min is not None and damage_max is not None and damage_max < damage_min:
        raise HTTPException(
            status_code=422,
            detail="damage_max must be greater than or equal to damage_min",
        )

    parsed_region_ids: Optional[list[int]] = None
    if region_ids:
        try:
            parsed_region_ids = [int(x.strip()) for x in region_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(
                status_code=422, detail="region_ids must be comma-separated integers"
            )

    points = get_heatmap_points(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        region_ids=parsed_region_ids,
        province=province,
        municipality=municipality,
        alarm_level=alarm_level,
        incident_type=incident_type,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
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
    db: Annotated[Session, Depends(get_db_with_rls)],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    region_ids: Optional[str] = Query(None, description="Comma-separated region IDs"),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    interval: str = Query("daily", pattern="^(daily|weekly|monthly|quarterly|yearly)$"),
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """
    Time-series counts for line/bar charts.
    Uses wims.analytics_incident_facts (indexed access).
    """
    parsed_region_ids: Optional[list[int]] = None
    if region_ids:
        try:
            parsed_region_ids = [int(x.strip()) for x in region_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(
                status_code=422, detail="region_ids must be comma-separated integers"
            )

    data = get_trends(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        region_ids=parsed_region_ids,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        interval=interval,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )
    return {"data": data}


@router.get("/comparative")
def get_comparative(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    range_a_start: str = Query(...),
    range_a_end: str = Query(...),
    range_b_start: str = Query(...),
    range_b_end: str = Query(...),
    region_id: Optional[int] = Query(None),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
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
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )
    count_b = count_in_range(
        db,
        range_b_start,
        range_b_end,
        region_id=region_id,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
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
    db: Annotated[Session, Depends(get_db_with_rls)],
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
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """
    Dispatch Celery task for CSV export. Returns task_id.

    The task runs with the requesting user's RLS context so that
    exported data is filtered by their role and assigned region.
    """
    result = export_incidents_csv_task.delay(
        user_id=str(current_user["user_id"]),
        filters=body.filters,
        columns=body.columns,
    )
    return {"task_id": result.id}


@router.post("/export/pdf")
def export_pdf(
    body: ExportCsvRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """Dispatch Celery task for PDF export. Returns task_id."""
    result = export_incidents_pdf_task.delay(
        user_id=str(current_user["user_id"]),
        filters=body.filters,
        columns=body.columns,
    )
    return {"task_id": result.id}


@router.post("/export/excel")
def export_excel(
    body: ExportCsvRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """Dispatch Celery task for Excel export. Returns task_id."""
    result = export_incidents_excel_task.delay(
        user_id=str(current_user["user_id"]),
        filters=body.filters,
        columns=body.columns,
    )
    return {"task_id": result.id}


@router.get("/export/{task_id}")
def download_export(
    task_id: str,
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """Download a completed Celery export artifact."""
    result = AsyncResult(task_id, app=celery_app)
    if result.state == "PENDING":
        raise HTTPException(status_code=409, detail="Export is still pending")
    if result.failed():
        raise HTTPException(status_code=409, detail="Export failed")

    path = result.result
    if not isinstance(path, str):
        raise HTTPException(status_code=404, detail="Export result is unavailable")
    if not os.path.exists(path) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Export file is unavailable")

    extension = os.path.splitext(path)[1].lower()
    media_types = {
        ".csv": "text/csv",
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    return FileResponse(
        path,
        media_type=media_types.get(extension, "application/octet-stream"),
        filename=os.path.basename(path),
    )


@router.get("/filter-options")
def filter_options_route(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    field: str = Query(..., pattern="^(province|municipality)$"),
    region_id: Optional[int] = Query(None),
    province: Optional[str] = Query(None),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """Cascading geography filter options for analyst dashboards."""
    try:
        return get_filter_options(
            db,
            field=field,
            region_id=region_id,
            province=province,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/type-distribution")
def get_type_distribution_route(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Incident count by type (for pie chart)."""
    data = get_type_distribution(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )
    return data


@router.get("/response-time-by-region")
def get_response_time_by_region_route(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Average/min/max response time grouped by region."""
    data = get_response_time_by_region(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )
    return data


@router.get("/compare-regions")
def compare_regions_route(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    region_ids: str = Query(..., description="Comma-separated region IDs (min 2)"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Cross-region comparison. Requires at least 2 region IDs."""
    try:
        parsed = [int(x.strip()) for x in region_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="region_ids must be comma-separated integers")
    if len(parsed) < 2:
        raise HTTPException(status_code=422, detail="At least 2 region_ids required for comparison")
    data = get_compare_regions(
        db,
        region_ids=parsed,
        start_date=start_date,
        end_date=end_date,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )
    return data


@router.get("/top-n")
def top_n_route(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    metric: str = Query(..., pattern="^(incidents|response_time|casualties)$"),
    dimension: str = Query(..., pattern="^(fire_station|region|municipality)$"),
    limit: int = Query(10, ge=1, le=50),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Configurable top-N analysis by metric and dimension."""
    data = get_top_n(
        db,
        metric=metric,
        dimension=dimension,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )
    return data


@router.post("/incidents/{incident_id}/narrative")
async def generate_narrative(
    incident_id: int,
    user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Generate an AI narrative for a verified fire incident via Qwen2.5-3B.
    Only works on VERIFIED incidents. Stores result in fire_incidents.ai_narrative.
    """
    from services.ai_service import generate_incident_narrative

    return await generate_incident_narrative(incident_id, db)


@router.post("/incidents/batch-narratives", status_code=202)
def trigger_batch_narratives(
    user: Annotated[dict, Depends(get_analyst_or_admin)],
    limit: int = Query(default=50, ge=1, le=500),
):
    """
    Trigger batch AI narrative generation for VERIFIED incidents
    without narratives. Dispatches to Celery task.
    """
    from tasks.narrative import batch_generate_narratives

    task = batch_generate_narratives.delay(limit=limit)
    return {"task_id": task.id, "limit": limit}
