"""Triage Queue and Promotion Workflow — ENCODER/VALIDATOR only."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from database import get_db

router = APIRouter(prefix="/api/triage", tags=["triage"])


def _require_encoder_or_validator(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """Require ENCODER or VALIDATOR role."""
    role = current_user.get("role")
    if role not in ("ENCODER", "VALIDATOR"):
        raise HTTPException(status_code=403, detail="ENCODER or VALIDATOR role required")
    return current_user


@router.get("/pending")
def get_pending_reports(
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db)],
):
    """
    Return citizen_reports where status == 'PENDING'.
    Requires ENCODER or VALIDATOR role.
    """
    rows = db.execute(
        text("""
            SELECT report_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
                   description, created_at, status
            FROM wims.citizen_reports
            WHERE status = 'PENDING'
            ORDER BY created_at ASC
        """),
    ).fetchall()

    return [
        {
            "report_id": r[0],
            "latitude": float(r[1]),
            "longitude": float(r[2]),
            "description": r[3] or "",
            "created_at": r[4].isoformat() if r[4] else None,
            "status": r[5],
        }
        for r in rows
    ]


@router.post("/{report_id}/promote", status_code=201)
def promote_report(
    report_id: int,
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db)],
):
    """
    Promote a PENDING citizen_report to an official fire_incident.
    Transaction: UPDATE citizen_report (VERIFIED, validated_by, verified_incident_id)
    and INSERT fire_incident with matching coordinates.
    db.commit() only after both succeed.
    """
    # Fetch report
    report = db.execute(
        text("""
            SELECT report_id, location, status
            FROM wims.citizen_reports
            WHERE report_id = :rid
        """),
        {"rid": report_id},
    ).fetchone()

    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")

    if report[2] != "PENDING":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot promote report with status '{report[2]}'",
        )

    user_id = user["user_id"]

    # Resolve default region (required by fire_incidents schema)
    region_row = db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    if region_row is None:
        raise HTTPException(status_code=500, detail="No ref_regions seed data")

    region_id = region_row[0]

    try:
        # 1. INSERT fire_incident with same location as citizen_report
        result = db.execute(
            text("""
                INSERT INTO wims.fire_incidents (region_id, encoder_id, location, verification_status)
                SELECT :region_id, :encoder_id, location, 'VERIFIED'
                FROM wims.citizen_reports
                WHERE report_id = :rid
                RETURNING incident_id
            """),
            {"region_id": region_id, "encoder_id": user_id, "rid": report_id},
        )
        row = result.fetchone()
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create incident")
        incident_id = row[0]

        # 2. UPDATE citizen_report
        db.execute(
            text("""
                UPDATE wims.citizen_reports
                SET status = 'VERIFIED', validated_by = :uid, verified_incident_id = :iid
                WHERE report_id = :rid
            """),
            {"uid": user_id, "iid": incident_id, "rid": report_id},
        )

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return {"report_id": report_id, "incident_id": incident_id}
