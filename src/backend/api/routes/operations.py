from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_national_validator
from database import get_db
from schemas.operations import (
    FireStatus,
    LinkReportRequest,
    OperationCreate,
    OperationResponse,
    OperationUpdate,
)
from utils.audit import log_system_audit

router = APIRouter(prefix="/api/operations", tags=["operations"])


def _row_to_response(
    row, linked_report_ids: list[int] | None = None, db: Session | None = None
) -> OperationResponse:
    """Convert a DB row to an OperationResponse.

    When called from list_operations, linked_report_ids are pre-fetched in a batch.
    When called from create/update/link/unlink, a single-row query is done via db.
    """
    if linked_report_ids is None and db is not None:
        result = db.execute(
            text("SELECT report_id FROM wims.operation_citizen_reports WHERE operation_id = :oid"),
            {"oid": row.operation_id},
        ).fetchall()
        linked_report_ids = [r.report_id for r in result]
    elif linked_report_ids is None:
        linked_report_ids = []
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
    )


# ---------------------------------------------------------------------------
# GET /api/operations — public read (no auth required)
# ---------------------------------------------------------------------------


@router.get("", response_model=List[OperationResponse])
def list_operations(
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

    return [_row_to_response(r, linked_by_op.get(r.operation_id, [])) for r in rows]


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
    try:
        db.execute(
            text(
                "INSERT INTO wims.operation_citizen_reports (operation_id, report_id)"
                " VALUES (:oid, :rid)"
                " ON CONFLICT DO NOTHING"
            ),
            {"oid": operation_id, "rid": payload.report_id},
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="LINK_REPORT",
        table_affected="operation_citizen_reports",
        record_id=payload.report_id,
    )
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
    )
    db.commit()
    return _row_to_response(op, db=db)
