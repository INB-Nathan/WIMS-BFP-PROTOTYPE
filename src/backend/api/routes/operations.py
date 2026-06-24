from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_incident_viewer, get_national_validator
from database import get_db
from schemas.operations import (
    FireStatus,
    LinkableReportSearchResponse,
    LinkReportRequest,
    OperationCreate,
    OperationLinkedReport,
    OperationResponse,
    OperationUpdate,
)
from utils.audit import log_system_audit

router = APIRouter(prefix="/api/operations", tags=["operations"])


LINKABLE_REPORT_STATUSES = {"PENDING", "UNDER_REVIEW", "LINKED", "ACTIONED"}


def _get_report_for_link(db: Session, report_id: int):
    return db.execute(
        text("SELECT report_id, status FROM wims.citizen_reports WHERE report_id = :rid FOR UPDATE"),
        {"rid": report_id},
    ).fetchone()


def _get_existing_operation_for_report(db: Session, report_id: int):
    return db.execute(
        text(
            "SELECT operation_id AS linked_operation_id "
            "FROM wims.operation_citizen_reports WHERE report_id = :rid"
        ),
        {"rid": report_id},
    ).fetchone()


def _apply_link_status_transition(db: Session, report_id: int, old_status: str) -> str:
    if old_status == "ACTIONED":
        return old_status
    if old_status not in LINKABLE_REPORT_STATUSES:
        raise HTTPException(status_code=400, detail="Report status is not linkable")
    db.execute(
        text("UPDATE wims.citizen_reports SET status = :status WHERE report_id = :rid"),
        {"status": "LINKED", "rid": report_id},
    )
    return "LINKED"


def _apply_unlink_status_transition(db: Session, report_id: int, old_status: str) -> str:
    if old_status == "ACTIONED":
        return old_status
    if old_status == "LINKED":
        db.execute(
            text("UPDATE wims.citizen_reports SET status = :status WHERE report_id = :rid"),
            {"status": "UNDER_REVIEW", "rid": report_id},
        )
        return "UNDER_REVIEW"
    return old_status


def _link_report_to_operation(
    db: Session,
    operation_id: int,
    report_id: int,
    current_user: dict,
) -> None:
    existing = _get_existing_operation_for_report(db, report_id)
    if existing and existing.linked_operation_id == operation_id:
        return
    if existing and existing.linked_operation_id != operation_id:
        raise HTTPException(
            status_code=409,
            detail=f"Report already linked to Operation #{existing.linked_operation_id}",
        )

    report = _get_report_for_link(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Citizen report not found")
    old_status = str(report.status)
    new_status = _apply_link_status_transition(db, report_id, old_status)

    db.execute(
        text(
            "INSERT INTO wims.operation_citizen_reports (operation_id, report_id) "
            "VALUES (:oid, :rid)"
        ),
        {"oid": operation_id, "rid": report_id},
    )
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="LINK_REPORT",
        table_affected="operation_citizen_reports",
        record_id=report_id,
        old_values={"status": old_status},
        new_values={"status": new_status, "operation_id": operation_id},
    )


def _linked_report_row_to_schema(row: Any) -> OperationLinkedReport:
    return OperationLinkedReport(
        report_id=row.report_id,
        status=str(row.status),
        category=row.category,
        sub_category=row.sub_category,
        reported_at=row.reported_at or getattr(row, "created_at", None),
        latitude=float(row.latitude) if row.latitude is not None else None,
        longitude=float(row.longitude) if row.longitude is not None else None,
        trust_score=row.trust_score,
        safety_status=row.safety_status,
        reporting_context=row.reporting_context,
        linked_operation_id=getattr(row, "linked_operation_id", None),
        linked_operation_label=getattr(row, "linked_operation_label", None),
        distance_meters=float(row.distance_meters) if getattr(row, "distance_meters", None) is not None else None,
    )


def _fetch_linked_reports_for_operations(
    db: Session,
    operation_ids: list[int],
) -> dict[int, list[OperationLinkedReport]]:
    if not operation_ids:
        return {}
    placeholders = ", ".join(f":oid{i}" for i in range(len(operation_ids)))
    params = {f"oid{i}": oid for i, oid in enumerate(operation_ids)}
    rows = db.execute(
        text(
            f"""
            SELECT
                ocr.operation_id,
                cr.report_id,
                cr.status,
                cr.category,
                cr.sub_category,
                cr.reported_at,
                cr.created_at,
                ST_Y(cr.location::geometry) AS latitude,
                ST_X(cr.location::geometry) AS longitude,
                cr.trust_score,
                cr.safety_status,
                cr.reporting_context,
                ocr.operation_id AS linked_operation_id,
                ('Operation #' || ocr.operation_id::text) AS linked_operation_label,
                CASE
                    WHEN op.latitude IS NOT NULL AND op.longitude IS NOT NULL THEN
                        ST_DistanceSphere(
                            cr.location::geometry,
                            ST_SetSRID(ST_MakePoint(op.longitude, op.latitude), 4326)
                        )
                    ELSE NULL
                END AS distance_meters
            FROM wims.operation_citizen_reports ocr
            JOIN wims.citizen_reports cr ON cr.report_id = ocr.report_id
            JOIN wims.operations op ON op.operation_id = ocr.operation_id
            WHERE ocr.operation_id IN ({placeholders})
            ORDER BY cr.reported_at DESC NULLS LAST, cr.created_at DESC
            """,
        ),
        params,
    ).fetchall()
    grouped: dict[int, list[OperationLinkedReport]] = {oid: [] for oid in operation_ids}
    for row in rows:
        grouped.setdefault(row.operation_id, []).append(_linked_report_row_to_schema(row))
    return grouped


def _row_to_response(
    row: Any,
    linked_report_ids: list[int] | None = None,
    db: Session | None = None,
    linked_reports: list[OperationLinkedReport] | None = None,
) -> OperationResponse:
    """Convert a DB row to an OperationResponse.

    When called from list_operations, linked_report_ids and linked_reports are
    pre-fetched in a batch via _fetch_linked_reports_for_operations to avoid N+1.
    When called from create/update/link/unlink, linked_report_ids is loaded via
    a single-row query against `db`, and linked_reports is left empty (callers
    in those paths do not need full report details).
    """
    if linked_report_ids is None and db is not None:
        result = db.execute(
            text("SELECT report_id FROM wims.operation_citizen_reports WHERE operation_id = :oid"),
            {"oid": row.operation_id},
        ).fetchall()
        linked_report_ids = [r.report_id for r in result]
    elif linked_report_ids is None:
        linked_report_ids = []
    if linked_reports is None:
        linked_reports = []
    return OperationResponse(
        operation_id=row.operation_id,
        fire_status=row.fire_status,
        start_time=row.start_time,
        location=row.location,
        size_hectares=row.size_hectares,
        notes=row.notes,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
        latitude=getattr(row, "latitude", None),
        longitude=getattr(row, "longitude", None),
        radius_meters=getattr(row, "radius_meters", None),
        linked_report_ids=linked_report_ids,
        linked_reports=linked_reports,
    )


# ---------------------------------------------------------------------------
# GET /api/operations — staff read (auth required)
#
# SECURITY (EP-29 / audit gap #3): this endpoint previously had no auth
# dependency, so unauthenticated callers received the full operational dataset
# (operation locations, statuses, linked citizen-report ids). It is now gated
# by get_incident_viewer, matching the write verbs (POST/PATCH/DELETE) which
# already require NATIONAL_VALIDATOR. The operations board is staff-only.
# ---------------------------------------------------------------------------


@router.get("", response_model=List[OperationResponse])
def list_operations(
    _viewer: Annotated[dict, Depends(get_incident_viewer)],
    status: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
) -> List[OperationResponse]:
    if status:
        placeholders = ", ".join(f":s{i}" for i in range(len(status)))
        params = {f"s{i}": s for i, s in enumerate(status)}
        rows = db.execute(
            text(
                f"SELECT * FROM wims.operations"
                f" WHERE fire_status IN ({placeholders})"
                f" ORDER BY created_at DESC"
            ),
            params,
        ).fetchall()
    else:
        rows = db.execute(text("SELECT * FROM wims.operations ORDER BY created_at DESC")).fetchall()

    if not rows:
        return []

    # Batch-fetch all linked report IDs in a single query (avoid N+1)
    op_ids = [r.operation_id for r in rows]
    placeholders = ", ".join(f":oid{i}" for i in range(len(op_ids)))
    link_params = {f"oid{i}": oid for i, oid in enumerate(op_ids)}
    link_rows = db.execute(
        text(
            f"SELECT operation_id, report_id FROM wims.operation_citizen_reports"
            f" WHERE operation_id IN ({placeholders})"
        ),
        link_params,
    ).fetchall()

    # Group linked report IDs by operation_id
    linked_by_op: dict[int, list[int]] = {oid: [] for oid in op_ids}
    for lr in link_rows:
        linked_by_op[lr.operation_id].append(lr.report_id)

    linked_reports_by_op = _fetch_linked_reports_for_operations(db, op_ids)

    return [
        _row_to_response(
            r,
            linked_by_op.get(r.operation_id, []),
            linked_reports=linked_reports_by_op.get(r.operation_id, []),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /api/operations/linkable-reports — validator-only report search
# ---------------------------------------------------------------------------


@router.get("/linkable-reports", response_model=list[LinkableReportSearchResponse])
def list_linkable_reports(
    current_user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    operation_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    status: Optional[List[str]] = Query(None),
    category: Optional[str] = Query(None),
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    latitude: Optional[float] = Query(None, ge=-90, le=90),
    longitude: Optional[float] = Query(None, ge=-180, le=180),
) -> list[LinkableReportSearchResponse]:
    allowed_statuses = {"PENDING", "UNDER_REVIEW", "LINKED", "ACTIONED"}
    requested_statuses = [s for s in (status or []) if s in allowed_statuses]

    params: dict[str, object] = {}
    where = ["cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED', 'ACTIONED')"]
    where.append("cr.status NOT LIKE 'REJECTED_%'")

    if requested_statuses:
        placeholders = ", ".join(f":status{i}" for i in range(len(requested_statuses)))
        where.append(f"cr.status IN ({placeholders})")
        params.update({f"status{i}": s for i, s in enumerate(requested_statuses)})
    if q:
        where.append("(cr.category ILIKE :q OR cr.sub_category ILIKE :q)")
        params["q"] = f"%{q}%"
    if category:
        where.append("cr.category = :category")
        params["category"] = category
    if start:
        where.append("COALESCE(cr.reported_at, cr.created_at) >= :start")
        params["start"] = start
    if end:
        where.append("COALESCE(cr.reported_at, cr.created_at) <= :end")
        params["end"] = end

    origin_select = "NULL::double precision AS origin_latitude, NULL::double precision AS origin_longitude"
    distance_expr = "NULL::double precision AS distance_meters"
    if operation_id is not None:
        params["operation_id"] = operation_id
        origin_select = "op_origin.latitude AS origin_latitude, op_origin.longitude AS origin_longitude"
        distance_expr = """
            CASE
                WHEN op_origin.latitude IS NOT NULL AND op_origin.longitude IS NOT NULL THEN
                    ST_DistanceSphere(
                        cr.location::geometry,
                        ST_SetSRID(ST_MakePoint(op_origin.longitude, op_origin.latitude), 4326)
                    )
                ELSE NULL
            END AS distance_meters
        """
    elif latitude is not None and longitude is not None:
        params["latitude"] = latitude
        params["longitude"] = longitude
        distance_expr = """
            ST_DistanceSphere(
                cr.location::geometry,
                ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)
            ) AS distance_meters
        """

    origin_join = "LEFT JOIN wims.operations op_origin ON op_origin.operation_id = :operation_id" if operation_id is not None else ""
    rows = db.execute(
        text(
            f"""
            SELECT
                cr.report_id,
                cr.status,
                cr.category,
                cr.sub_category,
                cr.reported_at,
                cr.created_at,
                ST_Y(cr.location::geometry) AS latitude,
                ST_X(cr.location::geometry) AS longitude,
                cr.trust_score,
                cr.safety_status,
                cr.reporting_context,
                ocr.operation_id AS linked_operation_id,
                CASE
                    WHEN ocr.operation_id IS NOT NULL THEN 'Operation #' || ocr.operation_id::text
                    ELSE NULL
                END AS linked_operation_label,
                {origin_select},
                {distance_expr}
            FROM wims.citizen_reports cr
            LEFT JOIN wims.operation_citizen_reports ocr ON ocr.report_id = cr.report_id
            {origin_join}
            WHERE {' AND '.join(where)}
            ORDER BY distance_meters ASC NULLS LAST, COALESCE(cr.reported_at, cr.created_at) DESC
            LIMIT 100
            """,
        ),
        params,
    ).fetchall()

    response: list[LinkableReportSearchResponse] = []
    for row in rows:
        base = _linked_report_row_to_schema(row)
        disabled = row.linked_operation_id is not None and row.linked_operation_id != operation_id
        response.append(
            LinkableReportSearchResponse(
                **base.model_dump(),
                link_disabled=disabled,
                disabled_reason=(
                    f"Already linked to Operation #{row.linked_operation_id}" if disabled else None
                ),
            )
        )
    return response


# ---------------------------------------------------------------------------
# POST /api/operations — validator only
# ---------------------------------------------------------------------------


@router.post("", response_model=OperationResponse, status_code=201)
def create_operation(
    payload: OperationCreate,
    db: Annotated[Session, Depends(get_db_with_rls)],
    current_user: Annotated[dict, Depends(get_national_validator)],
) -> OperationResponse:
    row = db.execute(
        text("""
            INSERT INTO wims.operations
                (fire_status, start_time, location, size_hectares, notes, created_by,
                 latitude, longitude, radius_meters)
            VALUES (:fs, :st, :loc, :sh, :notes, :cb,
                    :lat, :lng, :rad)
            RETURNING *
        """),
        {
            "fs": payload.fire_status.value,
            "st": payload.start_time,
            "loc": payload.location,
            "sh": payload.size_hectares,
            "notes": payload.notes,
            "cb": str(current_user["user_id"]),
            "lat": payload.latitude,
            "lng": payload.longitude,
            "rad": payload.radius_meters,
        },
    ).fetchone()
    for report_id in payload.linked_report_ids:
        _link_report_to_operation(db, row.operation_id, report_id, current_user)
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="OPERATION_CREATE",
        table_affected="operations",
        record_id=row.operation_id,
    )
    db.commit()
    return _row_to_response(row, db=db)


# ---------------------------------------------------------------------------
# PATCH /api/operations/{operation_id} — validator only
# ---------------------------------------------------------------------------


@router.patch("/{operation_id}", response_model=OperationResponse)
def update_operation(
    operation_id: int,
    payload: OperationUpdate,
    db: Annotated[Session, Depends(get_db_with_rls)],
    current_user: Annotated[dict, Depends(get_national_validator)],
) -> OperationResponse:
    existing = db.execute(
        text("SELECT * FROM wims.operations WHERE operation_id = :oid"),
        {"oid": operation_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Operation not found")

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return _row_to_response(existing, db)

    # Convert enum to string value before building SQL
    if "fire_status" in updates and isinstance(updates["fire_status"], FireStatus):
        updates["fire_status"] = updates["fire_status"].value

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["_oid"] = operation_id
    updates["_now"] = datetime.now(tz=timezone.utc)

    row = db.execute(
        text(
            f"UPDATE wims.operations"
            f" SET {set_clause}, updated_at = :_now"
            f" WHERE operation_id = :_oid"
            f" RETURNING *"
        ),
        updates,
    ).fetchone()
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="OPERATION_UPDATE",
        table_affected="operations",
        record_id=operation_id,
    )
    db.commit()
    return _row_to_response(row, db=db)


# ---------------------------------------------------------------------------
# DELETE /api/operations/{operation_id} — validator only
# ---------------------------------------------------------------------------


@router.delete("/{operation_id}", status_code=204)
def delete_operation(
    operation_id: int,
    db: Annotated[Session, Depends(get_db_with_rls)],
    current_user: Annotated[dict, Depends(get_national_validator)],
) -> None:
    existing = db.execute(
        text("SELECT operation_id FROM wims.operations WHERE operation_id = :oid"),
        {"oid": operation_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Operation not found")
    db.execute(
        text("DELETE FROM wims.operations WHERE operation_id = :oid"),
        {"oid": operation_id},
    )
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="OPERATION_DELETE",
        table_affected="operations",
        record_id=operation_id,
    )
    db.commit()


# ---------------------------------------------------------------------------
# POST /api/operations/{operation_id}/link — validator only
# ---------------------------------------------------------------------------


@router.post("/{operation_id}/link", response_model=OperationResponse, status_code=201)
def link_report(
    operation_id: int,
    payload: LinkReportRequest,
    db: Annotated[Session, Depends(get_db_with_rls)],
    current_user: Annotated[dict, Depends(get_national_validator)],
) -> OperationResponse:
    op = db.execute(
        text("SELECT * FROM wims.operations WHERE operation_id = :oid"),
        {"oid": operation_id},
    ).fetchone()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    _link_report_to_operation(db, operation_id, payload.report_id, current_user)
    db.commit()
    return _row_to_response(op, db=db)


# ---------------------------------------------------------------------------
# DELETE /api/operations/{operation_id}/link/{report_id} — validator only
# ---------------------------------------------------------------------------


@router.delete("/{operation_id}/link/{report_id}", response_model=OperationResponse)
def unlink_report(
    operation_id: int,
    report_id: int,
    db: Annotated[Session, Depends(get_db_with_rls)],
    current_user: Annotated[dict, Depends(get_national_validator)],
) -> OperationResponse:
    op = db.execute(
        text("SELECT * FROM wims.operations WHERE operation_id = :oid"),
        {"oid": operation_id},
    ).fetchone()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    report = _get_report_for_link(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Citizen report not found")
    old_status = str(report.status)
    new_status = _apply_unlink_status_transition(db, report_id, old_status)
    db.execute(
        text(
            "DELETE FROM wims.operation_citizen_reports"
            " WHERE operation_id = :oid AND report_id = :rid"
        ),
        {"oid": operation_id, "rid": report_id},
    )
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="UNLINK_REPORT",
        table_affected="operation_citizen_reports",
        record_id=report_id,
        old_values={"status": old_status, "operation_id": operation_id},
        new_values={"status": new_status},
    )
    db.commit()
    return _row_to_response(op, db=db)
