"""System Admin API — breach notification routes (M10d, RA 10173)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from schemas.breach import BreachResponse, BreachUpdate
from utils.audit import log_system_audit

router = APIRouter()


def _row_to_dict(row) -> dict:
    return {
        "breach_id": row[0],
        "threat_log_id": row[1],
        "detected_at": row[2],
        "npc_deadline_at": row[3],
        "status": row[4],
        "affected_systems": row[5],
        "data_scope": row[6],
        "notes": row[7],
        "reported_by": row[8],
        "npc_submitted_at": row[9],
        "created_at": row[10],
        "updated_at": row[11],
    }


_SELECT_COLS = """
    breach_id, threat_log_id, detected_at, npc_deadline_at, status,
    affected_systems, data_scope, notes, reported_by, npc_submitted_at,
    created_at, updated_at
"""


@router.get("/breach", response_model=list[BreachResponse])
def list_breaches(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """List all breach records ordered by detection time, most recent first."""
    rows = db.execute(
        text(f"SELECT {_SELECT_COLS} FROM wims.breach_notifications ORDER BY detected_at DESC")
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/breach/{breach_id}", response_model=BreachResponse)
def get_breach(
    breach_id: int,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Fetch a single breach record by ID."""
    row = db.execute(
        text(f"SELECT {_SELECT_COLS} FROM wims.breach_notifications WHERE breach_id = :bid"),
        {"bid": breach_id},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Breach record not found")
    return _row_to_dict(row)


@router.patch("/breach/{breach_id}", response_model=BreachResponse)
def update_breach(
    breach_id: int,
    body: BreachUpdate,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Update breach status, affected_systems, data_scope, or notes."""
    # Snapshot old values before UPDATE for forensic audit
    old_row = db.execute(
        text(f"SELECT {_SELECT_COLS} FROM wims.breach_notifications WHERE breach_id = :bid"),
        {"bid": breach_id},
    ).fetchone()
    if old_row is None:
        raise HTTPException(status_code=404, detail="Breach record not found")

    old_dict = _row_to_dict(old_row)
    old_values = {
        "status": str(old_dict["status"]),
        "affected_systems": old_dict["affected_systems"],
        "data_scope": old_dict["data_scope"],
        "notes": old_dict["notes"],
    }

    updates: list[str] = ["updated_at = now()"]
    params: dict = {"bid": breach_id}

    if body.status is not None:
        updates.append("status = :status")
        params["status"] = body.status.value
        # Set submission timestamp when transitioning to NPC_SUBMITTED
        if body.status.value == "NPC_SUBMITTED":
            updates.append("npc_submitted_at = now()")

    if body.affected_systems is not None:
        updates.append("affected_systems = :affected_systems")
        params["affected_systems"] = body.affected_systems

    if body.data_scope is not None:
        updates.append("data_scope = :data_scope")
        params["data_scope"] = body.data_scope

    if body.notes is not None:
        updates.append("notes = :notes")
        params["notes"] = body.notes

    if len(updates) == 1:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = db.execute(
        text(f"UPDATE wims.breach_notifications SET {', '.join(updates)} WHERE breach_id = :bid"),
        params,
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Breach record not found")

    # Build new_values from the request body for audit compare
    new_values = {}
    if body.status is not None:
        new_values["status"] = body.status.value
    if body.affected_systems is not None:
        new_values["affected_systems"] = body.affected_systems
    if body.data_scope is not None:
        new_values["data_scope"] = body.data_scope
    if body.notes is not None:
        new_values["notes"] = body.notes

    log_system_audit(
        db=db,
        user_id=_admin["user_id"],
        action_type="BREACH_STATUS_UPDATE",
        table_affected="breach_notifications",
        record_id=breach_id,
        request=request,
        old_values=old_values,
        new_values=new_values,
    )
    db.commit()

    row = db.execute(
        text(f"SELECT {_SELECT_COLS} FROM wims.breach_notifications WHERE breach_id = :bid"),
        {"bid": breach_id},
    ).fetchone()
    return _row_to_dict(row)
