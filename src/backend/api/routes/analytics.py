"""National Analyst Analytics API — Read-only Intelligence Loop.

All endpoints require NATIONAL_ANALYST or SYSTEM_ADMIN.
Scoped to verified, non-archived incidents only.
Queries wims.analytics_incident_facts (read model) instead of raw operational tables.
"""

from __future__ import annotations

import os
from typing import Annotated, Any, Literal, Optional

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy.orm import Session

from celery_config import celery_app
from auth import get_analyst_or_admin, get_national_analyst
from auth import get_db_with_rls
from sqlalchemy import text
from services.analytics.filters import build_analytics_filters
from services.regional_incidents.helpers import build_audit_log_query
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

from utils.analytics_validation import validate_iso_date, validate_date_range

from tasks.exports import (
    ALLOWED_EXPORT_COLUMNS,
    export_analyst_incidents_task,
    export_incidents_csv_task,
    export_incidents_pdf_task,
    export_incidents_excel_task,
    export_workflow_comparative_task,
    export_workflow_response_time_task,
    export_workflow_top_n_task,
    export_workflow_trends_task,
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
    fire_station: Optional[str] = Query(None),
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
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
    try:
        filters = build_analytics_filters(
            start_date=start_date,
            end_date=end_date,
            region_id=region_id,
            region_ids=region_ids,
            province=province,
            municipality=municipality,
            fire_station=fire_station,
            incident_type=incident_type,
            alarm_level=alarm_level,
            casualty_severity=casualty_severity,
            damage_min=damage_min,
            damage_max=damage_max,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    points = get_heatmap_points(
        db,
        **filters.as_task_filters(),
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
    fire_station: Optional[str] = Query(None),
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
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
    try:
        filters = build_analytics_filters(
            start_date=start_date,
            end_date=end_date,
            region_id=region_id,
            region_ids=region_ids,
            province=province,
            municipality=municipality,
            fire_station=fire_station,
            incident_type=incident_type,
            alarm_level=alarm_level,
            casualty_severity=casualty_severity,
            damage_min=damage_min,
            damage_max=damage_max,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    data = get_trends(
        db,
        interval=interval,
        **filters.as_task_filters(),
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
    fire_station: Optional[str] = Query(None),
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
    validate_iso_date(range_a_start, "range_a_start")
    validate_iso_date(range_a_end, "range_a_end")
    validate_date_range(range_a_start, range_a_end)
    validate_iso_date(range_b_start, "range_b_start")
    validate_iso_date(range_b_end, "range_b_end")
    validate_date_range(range_b_start, range_b_end)
    count_a = count_in_range(
        db,
        range_a_start,
        range_a_end,
        region_id=region_id,
        province=province,
        municipality=municipality,
        fire_station=fire_station,
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
        fire_station=fire_station,
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


class WorkflowComparativeExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    range_a_start: str
    range_a_end: str
    range_b_start: str
    range_b_end: str

    @field_validator("range_a_start", "range_a_end", "range_b_start", "range_b_end")
    @classmethod
    def validate_dates(cls, v: str) -> str:
        validate_iso_date(v, "date")
        return v


class WorkflowTrendsExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    interval: str = "daily"

    @field_validator("interval")
    @classmethod
    def validate_interval(cls, v: str) -> str:
        allowed = {"daily", "weekly", "monthly", "quarterly", "yearly"}
        if v not in allowed:
            raise ValueError(f"interval must be one of {allowed}")
        return v


class WorkflowResponseTimeExportRequest(BaseModel):
    filters: dict[str, Any] = {}


class WorkflowTopNExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    metric: str
    dimension: str
    mode: str
    selected_name: str | None = None
    metric_value: float | None = None

    @field_validator("metric")
    @classmethod
    def validate_metric(cls, v: str) -> str:
        allowed = {"incidents", "response_time", "casualties", "damage_cost"}
        if v not in allowed:
            raise ValueError(f"metric must be one of {allowed}")
        return v

    @field_validator("dimension")
    @classmethod
    def validate_dimension(cls, v: str) -> str:
        allowed = {"fire_station", "region", "municipality", "barangay"}
        if v not in allowed:
            raise ValueError(f"dimension must be one of {allowed}")
        return v

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        allowed = {"full", "selected"}
        if v not in allowed:
            raise ValueError(f"mode must be one of {allowed}")
        return v

    @model_validator(mode="after")
    def validate_selected_fields(self):
        if self.mode == "selected" and not self.selected_name:
            raise ValueError("selected_name required when mode is 'selected'")
        return self


class ExportCsvRequest(BaseModel):
    filters: dict[str, Any] = {}
    columns: list[str] = []
    export_mode: Literal["bulk", "afor"] = "bulk"

    @model_validator(mode="after")
    def validate_columns(self):
        invalid = [c for c in self.columns if c not in ALLOWED_EXPORT_COLUMNS]
        if invalid:
            raise ValueError(f"Invalid column(s): {', '.join(invalid)}")
        return self


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
    start_date = body.filters.get("start_date")
    end_date = body.filters.get("end_date")
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
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
    start_date = body.filters.get("start_date")
    end_date = body.filters.get("end_date")
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)

    if body.export_mode == "afor":
        incident_id = body.filters.get("incident_id")
        if not incident_id:
            raise HTTPException(
                status_code=400,
                detail="AFOR PDF export requires filters.incident_id",
            )
        result = export_analyst_incidents_task.delay(
            user_id=str(current_user["user_id"]),
            filters=body.filters,
            columns=body.columns,
            format="pdf",
            export_mode="afor",
        )
        return {"task_id": result.id}

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
    start_date = body.filters.get("start_date")
    end_date = body.filters.get("end_date")
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
    result = export_incidents_excel_task.delay(
        user_id=str(current_user["user_id"]),
        filters=body.filters,
        columns=body.columns,
    )
    return {"task_id": result.id}


# ─── Workflow Export Endpoints ──────────────────────────────────────────────────


@router.post("/export/workflow/comparative")
def export_workflow_comparative(
    body: WorkflowComparativeExportRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    validate_date_range(body.range_a_start, body.range_a_end)
    validate_date_range(body.range_b_start, body.range_b_end)
    _SAFE_FILTER_KEYS = {
        "start_date",
        "end_date",
        "region_id",
        "province",
        "municipality",
        "fire_station",
        "incident_type",
        "alarm_level",
        "casualty_severity",
        "damage_min",
        "damage_max",
        "barangay_name",
    }
    clean_filters = {k: v for k, v in body.filters.items() if k in _SAFE_FILTER_KEYS}
    filters = build_analytics_filters(**clean_filters).as_task_filters() if clean_filters else {}
    result = export_workflow_comparative_task.delay(
        user_id=str(current_user["user_id"]),
        range_a_start=body.range_a_start,
        range_a_end=body.range_a_end,
        range_b_start=body.range_b_start,
        range_b_end=body.range_b_end,
        filters=filters,
    )
    return {"task_id": result.id}


@router.post("/export/workflow/trends")
def export_workflow_trends(
    body: WorkflowTrendsExportRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    _SAFE_FILTER_KEYS = {
        "start_date",
        "end_date",
        "region_id",
        "province",
        "municipality",
        "fire_station",
        "incident_type",
        "alarm_level",
        "casualty_severity",
        "damage_min",
        "damage_max",
        "barangay_name",
    }
    clean_filters = {k: v for k, v in body.filters.items() if k in _SAFE_FILTER_KEYS}
    filters = build_analytics_filters(**clean_filters).as_task_filters() if clean_filters else {}
    result = export_workflow_trends_task.delay(
        user_id=str(current_user["user_id"]),
        interval=body.interval,
        filters=filters,
    )
    return {"task_id": result.id}


@router.post("/export/workflow/response-time")
def export_workflow_response_time(
    body: WorkflowResponseTimeExportRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    _SAFE_FILTER_KEYS = {
        "start_date",
        "end_date",
        "region_id",
        "province",
        "municipality",
        "fire_station",
        "incident_type",
        "alarm_level",
        "casualty_severity",
        "damage_min",
        "damage_max",
        "barangay_name",
    }
    clean_filters = {k: v for k, v in body.filters.items() if k in _SAFE_FILTER_KEYS}
    filters = build_analytics_filters(**clean_filters).as_task_filters() if clean_filters else {}
    result = export_workflow_response_time_task.delay(
        user_id=str(current_user["user_id"]),
        filters=filters,
    )
    return {"task_id": result.id}


@router.post("/export/workflow/top-n")
def export_workflow_top_n(
    body: WorkflowTopNExportRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    _SAFE_FILTER_KEYS = {
        "start_date",
        "end_date",
        "region_id",
        "province",
        "municipality",
        "fire_station",
        "incident_type",
        "alarm_level",
        "casualty_severity",
        "damage_min",
        "damage_max",
        "barangay_name",
    }
    clean_filters = {k: v for k, v in body.filters.items() if k in _SAFE_FILTER_KEYS}
    filters = build_analytics_filters(**clean_filters).as_task_filters() if clean_filters else {}
    result = export_workflow_top_n_task.delay(
        user_id=str(current_user["user_id"]),
        metric=body.metric,
        dimension=body.dimension,
        mode=body.mode,
        selected_name=body.selected_name,
        metric_value=body.metric_value,
        filters=filters,
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
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
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
    fire_station: Optional[str] = Query(None),
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Incident count by type (for pie chart)."""
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
    data = get_type_distribution(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        fire_station=fire_station,
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
    fire_station: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Average/min/max response time grouped by region."""
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
    data = get_response_time_by_region(
        db,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        fire_station=fire_station,
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
    fire_station: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Cross-region comparison. Requires at least 2 region IDs."""
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
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
        fire_station=fire_station,
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
    metric: str = Query(..., pattern="^(incidents|response_time|casualties|damage_cost)$"),
    dimension: str = Query(..., pattern="^(fire_station|region|municipality|barangay)$"),
    limit: int = Query(10, ge=1, le=50),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = Query(None),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    fire_station: Optional[str] = Query(None),
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
):
    """Configurable top-N analysis by metric and dimension."""
    validate_iso_date(start_date, "start_date")
    validate_iso_date(end_date, "end_date")
    validate_date_range(start_date, end_date)
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
        fire_station=fire_station,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )
    return data


@router.get("/audit-logs")
def get_analyst_audit_logs(
    user: Annotated[dict, Depends(get_national_analyst)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    region_id: Optional[int] = None,
    actor_username: Optional[str] = None,
    role: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Paginated audit-log query over wims.incident_verification_history.

    Mirrors the NATIONAL_VALIDATOR/REGIONAL_ENCODER audit-log endpoints —
    scoped to the calling analyst's own actions only (RP-25), never all
    users' actions. See build_audit_log_query() for the forced
    actor_user_id scope.
    """
    where_sql, params = build_audit_log_query(
        actor_user_id=str(user["user_id"]),
        date_from=date_from,
        date_to=date_to,
        region_id=region_id,
        actor_username=actor_username,
        role=role,
        action=action,
    )
    list_params = {**params, "limit": limit, "offset": offset}

    rows = db.execute(
        text(
            f"""
            SELECT
                ivh.history_id, ivh.target_id, fi.region_id,
                ivh.action_by_user_id, ivh.previous_status, ivh.new_status,
                ivh.notes, ivh.action_timestamp,
                u.username AS actor_username,
                rr.region_name AS region_display,
                ivh.action_label
            FROM wims.incident_verification_history ivh
            JOIN wims.fire_incidents fi ON fi.incident_id = ivh.target_id
            LEFT JOIN wims.users u ON u.user_id = ivh.action_by_user_id
            LEFT JOIN wims.ref_regions rr ON rr.region_id = fi.region_id
            WHERE {where_sql}
            ORDER BY ivh.action_timestamp DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        list_params,
    ).fetchall()

    total = (
        db.execute(
            text(
                f"""
            SELECT COUNT(*)
            FROM wims.incident_verification_history ivh
            JOIN wims.fire_incidents fi ON fi.incident_id = ivh.target_id
            LEFT JOIN wims.users u ON u.user_id = ivh.action_by_user_id
            WHERE {where_sql}
            """
            ),
            params,
        ).scalar()
        or 0
    )

    return {
        "items": [
            {
                "history_id": r[0],
                "incident_id": r[1],
                "region_id": r[2],
                "action_by_user_id": str(r[3]) if r[3] else None,
                "previous_status": r[4],
                "new_status": r[5],
                "notes": r[6],
                "action_timestamp": r[7].isoformat() if r[7] else None,
                "actor_username": r[8],
                "region_display": r[9],
                "action_label": r[10],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
