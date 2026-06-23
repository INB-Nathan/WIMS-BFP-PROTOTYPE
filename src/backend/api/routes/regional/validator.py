"""Regional Office API — validator routes."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user, get_national_validator
from auth import get_db_with_rls
from database import set_rls_context
from services.analytics_read_model import sync_incident_to_analytics
from services.event_bus import publish_incident_event, publish_incident_event_sync
from services.regional_incidents import (
    VALIDATOR_DEFAULT_QUEUE_STATUSES,
    archive_finalized_incident,
    bulk_approve_pending_incidents,
    unarchive_finalized_incident,
    verify_incident_command,
)
from services.regional_incidents.helpers import (
    build_audit_log_query as _build_audit_log_query,
    compute_incident_data_hash,
    verify_incident_hash_chain as _verify_incident_hash_chain,
)
from utils.audit import trusted_client_ip, log_system_audit
from schemas.regional import (
    VerificationActionRequest,
    ClientIdRequest,
    CorrectionRequest,
    BulkApproveRequest,
)

logger = logging.getLogger("wims.regional")
router = APIRouter()

# Import shared helpers from the package init
from . import (  # noqa: E402
    _fi_has_resubmitted_column,
    _incident_verification_history_has_hash_columns,
    _ivh_has_client_id_column,
    _regional_lifecycle_dependencies,
)


# Field keys included in the diff. PII fields from incident_sensitive_details
# are intentionally excluded — only nonsensitive operational details are diffed.
_DIFF_FIELDS = (
    "notification_dt",
    "alarm_level",
    "general_category",
    "sub_category",
    "specific_type",
    "occupancy_type",
    "city_id",
    "barangay_id",
    "distance_from_station_km",
    "estimated_damage_php",
    "civilian_injured",
    "civilian_deaths",
    "firefighter_injured",
    "firefighter_deaths",
    "families_affected",
    "structures_affected",
    "households_affected",
    "individuals_affected",
    "responder_type",
    "fire_origin",
    "extent_of_damage",
    "stage_of_fire",
    "fire_station_name",
    "total_response_time_minutes",
    "recommendations",
    "vehicles_affected",
    "extent_total_floor_area_sqm",
    "extent_total_land_area_hectares",
    "alarm_timeline",
    "resources_deployed",
    "problems_encountered",
)


@router.get("/validator/incidents")
def get_validator_incident_queue(
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    status: Optional[str] = None,
    show_all: bool = Query(default=False),
    encoder_id: Optional[str] = None,
    region_id: Optional[int] = None,
    archived: bool = Query(default=False),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_basis: Optional[str] = "submitted",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Validator incident queue — NATIONAL_VALIDATOR only.

    Returns encoder-submitted fire incidents across all regions.
    encoder_id IS NOT NULL is always enforced so public/DMZ submissions
    (encoder_id = NULL) are never surfaced here.

    Query params
    ------------
    status      — filter to a single verification_status value.
                  Defaults to PENDING and PENDING_VALIDATION when omitted.
    show_all    — when true and status is omitted, include all statuses
                  (DRAFT/PENDING/PENDING_VALIDATION/VERIFIED/REJECTED/REPLACED)
                  for encoder-submitted incidents across all regions.
    encoder_id  — filter to incidents submitted by one specific encoder UUID.
    archived    — when true, return only archived incidents. Default: active only.
    limit/offset — pagination.

    """
    # M4-F: NATIONAL_VALIDATOR has cross-region authority; no region gate here.
    # The role check is enforced by get_national_validator dependency.

    archive_clause = "fi.is_archived = TRUE" if archived else "fi.is_archived = FALSE"
    where_clauses = [
        archive_clause,
        "fi.encoder_id IS NOT NULL",  # encoder-submitted only — never public DMZ rows
        "fi.verification_status != 'DRAFT'",  # validators never see drafts
    ]
    params: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
    }

    if status:
        where_clauses.append("fi.verification_status = :status")
        params["status"] = status
    elif not show_all and not archived:
        # Default: show the two awaiting-review statuses
        where_clauses.append("fi.verification_status = ANY(:default_statuses)")
        params["default_statuses"] = list(VALIDATOR_DEFAULT_QUEUE_STATUSES)

    if encoder_id:
        where_clauses.append("fi.encoder_id = CAST(:encoder_id AS uuid)")
        params["encoder_id"] = encoder_id

    if region_id is not None:
        where_clauses.append("fi.region_id = :region_id")
        params["region_id"] = region_id

    basis = (date_basis or "submitted").strip().lower()
    if basis == "modified":
        basis = "submitted"
    if basis not in {"submitted", "fire"}:
        raise HTTPException(status_code=422, detail="date_basis must be 'submitted' or 'fire'")
    date_expr = (
        "COALESCE(nd.notification_dt, fi.created_at)" if basis == "fire" else "fi.created_at"
    )
    if date_from:
        where_clauses.append(
            f"DATE({date_expr} AT TIME ZONE 'Asia/Manila') >= CAST(:date_from AS DATE)"
        )
        params["date_from"] = date_from
    if date_to:
        where_clauses.append(
            f"DATE({date_expr} AT TIME ZONE 'Asia/Manila') <= CAST(:date_to AS DATE)"
        )
        params["date_to"] = date_to

    where_sql = " AND ".join(where_clauses)

    has_resubmitted_col = _fi_has_resubmitted_column(db)
    resubmitted_expr = "fi.is_resubmitted" if has_resubmitted_col else "FALSE"

    rows = db.execute(
        text(f"""
            SELECT
                fi.incident_id,
                fi.verification_status,
                fi.encoder_id,
                fi.region_id,
                fi.created_at,
                nd.notification_dt,
                nd.general_category,
                nd.alarm_level,
                nd.fire_station_name,
                nd.structures_affected,
                nd.households_affected,
                nd.responder_type,
                nd.fire_origin,
                nd.extent_of_damage,
                fi.parent_incident_id,
                fi.is_duplicate,
                fi.duplicate_of,
                fi.updated_at,
                fi.reference_number,
                {resubmitted_expr}
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                   ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
            ORDER BY fi.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    total = (
        db.execute(
            text(f"""
                SELECT COUNT(*)
                FROM wims.fire_incidents fi
                LEFT JOIN wims.incident_nonsensitive_details nd
                       ON nd.incident_id = fi.incident_id
                WHERE {where_sql}
            """),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        ).scalar()
        or 0
    )

    return {
        "items": [
            {
                "incident_id": r[0],
                "verification_status": r[1],
                "encoder_id": str(r[2]) if r[2] else None,
                "region_id": r[3],
                "created_at": r[4].isoformat() if r[4] else None,
                "submitted_at": r[4].isoformat() if r[4] else None,
                "notification_dt": r[5].isoformat() if r[5] else None,
                "general_category": r[6],
                "alarm_level": r[7],
                "fire_station_name": r[8],
                "structures_affected": r[9],
                "households_affected": r[10],
                "responder_type": r[11],
                "fire_origin": r[12],
                "extent_of_damage": r[13],
                "parent_incident_id": r[14],
                "is_duplicate": bool(r[15]) if r[15] is not None else False,
                "duplicate_of": r[16],
                "updated_at": r[17].isoformat() if r[17] else None,
                "reference_number": r[18],
                "is_resubmitted": bool(r[19]) if r[19] is not None else False,
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.patch("/incidents/{incident_id}/verification")
def verify_incident(
    incident_id: int,
    body: VerificationActionRequest,
    request: Request,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    force: bool = Query(default=False),
):
    """Apply a validator decision to one encoder-submitted incident.

    NATIONAL_VALIDATOR only. Enforces encoder linkage before writing.

    Allowed actions
    ---------------
    accept  → VERIFIED
    pending → PENDING
    reject  → REJECTED

    Audit trail
    -----------
    Every call inserts one row into wims.incident_verification_history in the
    same transaction as the status update — if either write fails, both roll back.

    Error responses
    ---------------
    400 — unknown action value
    403 — incident has no encoder_id (public DMZ row)
    404 — incident not found or is archived
    409 — incident already has the requested target status (idempotency guard)
    """
    validator_user_id = user["user_id"]

    # Idempotency check: if client_id is provided and already exists in IVH,
    # short-circuit and return already_applied without re-processing (#267).
    if body.client_id and _ivh_has_client_id_column(db):
        existing = db.execute(
            text("""
                SELECT 1
                FROM wims.incident_verification_history
                WHERE client_id = CAST(:cid AS uuid)
                LIMIT 1
            """),
            {"cid": body.client_id},
        ).fetchone()
        if existing:
            return {"status": "already_applied", "incident_id": incident_id}

    result = verify_incident_command(
        db,
        incident_id=incident_id,
        action_body=body,
        validator_user_id=validator_user_id,
        request=request,
        force=force,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
        client_id=body.client_id,
    )

    # Idempotent retry: if the lifecycle command detected a duplicate
    # client_id (race after pre-check), return early without logging/SSE.
    if result.get("status") == "already_applied":
        return result

    logger.info(
        "Validator user_id=%s applied action='%s' to incident_id=%s",
        validator_user_id,
        result["action"],
        incident_id,
    )

    # Publish real-time SSE event
    publish_incident_event_sync(
        f"incident.{result.get('action', 'verified')}",
        incident_id=incident_id,
        status=result.get("new_status"),
        previous_status=result.get("previous_status"),
        actor_id=validator_user_id,
        actor_role="NATIONAL_VALIDATOR",
    )

    return result


@router.patch("/incidents/{incident_id}/correct")
async def correct_verified_incident(
    incident_id: int,
    body: CorrectionRequest,
    request: Request,
    current_user: dict = Depends(get_current_wims_user),
    db: Session = Depends(get_db_with_rls),
):
    """Apply a correction to a VERIFIED incident.

    NATIONAL_VALIDATOR and NATIONAL_ANALYST may correct any VERIFIED incident.
    The correction updates incident_nonsensitive_details fields, recomputes
    data_hash, writes an IVH correction row with hash chain, and syncs analytics.

    Corrections are only allowed on VERIFIED rows. Non-VERIFIED rows return 409.
    """
    if current_user.get("role") not in ("NATIONAL_VALIDATOR", "NATIONAL_ANALYST"):
        raise HTTPException(status_code=403, detail="Insufficient role")

    corrector_user_id = uuid.UUID(current_user["user_id"])

    incident_row = db.execute(
        text("""
            SELECT
                fi.incident_id,
                fi.verification_status,
                fi.region_id,
                fi.encoder_id,
                fi.data_hash,
                fi.created_at,
                u.keycloak_id
            FROM wims.fire_incidents fi
            JOIN wims.users u ON u.user_id = fi.encoder_id
            WHERE fi.incident_id = :iid AND fi.is_archived = FALSE
            FOR UPDATE OF fi
        """),
        {"iid": incident_id},
    ).fetchone()

    if not incident_row:
        raise HTTPException(status_code=404, detail="Incident not found")

    (
        inc_id,
        inc_status,
        inc_region_id,
        inc_encoder_id,
        old_data_hash,
        inc_created_at,
        inc_keycloak_id,
    ) = incident_row

    if inc_status != "VERIFIED":
        raise HTTPException(
            status_code=409,
            detail=f"Corrections only allowed on VERIFIED incidents. Current status: {inc_status}",
        )
    if not _incident_verification_history_has_hash_columns(db):
        raise HTTPException(
            status_code=500,
            detail="incident_verification_history hash-chain columns missing; apply SQL migrations",
        )

    ALLOWED_NSD_FIELDS = {
        "alarm_level",
        "general_category",
        "sub_category",
        "specific_type",
        "occupancy_type",
        "estimated_damage_php",
        "civilian_injured",
        "civilian_deaths",
        "firefighter_injured",
        "firefighter_deaths",
        "families_affected",
        "water_tankers_used",
        "foam_liters_used",
        "breathing_apparatus_used",
        "responder_type",
        "fire_origin",
        "extent_of_damage",
        "structures_affected",
        "households_affected",
        "individuals_affected",
        "fire_station_name",
        "total_response_time_minutes",
        "total_gas_consumed_liters",
        "stage_of_fire",
        "recommendations",
    }
    corrected_fields = sorted(f for f in body.corrections if f in ALLOWED_NSD_FIELDS)
    if not corrected_fields:
        raise HTTPException(status_code=422, detail="No valid correction fields provided")

    try:
        db.execute(
            text("""
                INSERT INTO wims.incident_nonsensitive_details (incident_id)
                SELECT :iid
                WHERE NOT EXISTS (
                    SELECT 1 FROM wims.incident_nonsensitive_details WHERE incident_id = :iid
                )
            """),
            {"iid": inc_id},
        )

        set_clause = ", ".join(f"{f} = :{f}" for f in corrected_fields)
        params = {f: body.corrections[f] for f in corrected_fields}
        params["iid"] = inc_id
        db.execute(
            text(
                f"UPDATE wims.incident_nonsensitive_details SET {set_clause} WHERE incident_id = :iid"
            ),
            params,
        )

        # RP-06: recompute over provenance + the now-updated detail fields so
        # the new hash reflects the corrected values (computed AFTER the
        # incident_nonsensitive_details UPDATE above).
        new_data_hash = compute_incident_data_hash(
            db,
            inc_id,
            encoder_id=inc_encoder_id,
            keycloak_id=inc_keycloak_id,
            region_id=inc_region_id,
            created_at=inc_created_at,
        )

        db.execute(
            text("UPDATE wims.fire_incidents SET data_hash = :h WHERE incident_id = :iid"),
            {"h": new_data_hash, "iid": inc_id},
        )

        prev_ivh_hash = db.execute(
            text("""
                SELECT ivh_row_hash
                FROM wims.incident_verification_history
                WHERE target_type = 'OFFICIAL'
                  AND target_id = :tid
                  AND ivh_row_hash IS NOT NULL
                ORDER BY action_timestamp DESC, history_id DESC
                LIMIT 1
            """),
            {"tid": inc_id},
        ).scalar()
        action_timestamp = datetime.now(timezone.utc)
        chain_payload = {
            "prev_ivh_hash": prev_ivh_hash or "",
            "new_data_hash": new_data_hash,
            "corrected_fields": corrected_fields,
            "action_timestamp": action_timestamp.isoformat(),
        }
        ivh_row_hash = hashlib.sha256(
            json.dumps(chain_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        db.execute(
            text("""
                INSERT INTO wims.incident_verification_history
                  (target_type, target_id, action_by_user_id,
                   previous_status, new_status, notes,
                   old_data_hash, new_data_hash, corrected_fields,
                   prev_ivh_hash, ivh_row_hash, action_timestamp)
                VALUES
                  ('OFFICIAL', :tid, :uid,
                   'VERIFIED', 'VERIFIED', :notes,
                   :old_hash, :new_hash, :fields,
                   :prev_hash, :row_hash, :action_timestamp)
            """),
            {
                "tid": inc_id,
                "uid": corrector_user_id,
                "notes": body.notes,
                "old_hash": old_data_hash,
                "new_hash": new_data_hash,
                "fields": corrected_fields,
                "prev_hash": prev_ivh_hash,
                "row_hash": ivh_row_hash,
                "action_timestamp": action_timestamp,
            },
        )

        log_system_audit(
            db=db,
            user_id=corrector_user_id,
            action_type="CORRECTION",
            table_affected="fire_incidents",
            record_id=inc_id,
            request=request,
        )

        db.commit()

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    try:
        # SET LOCAL resets on commit; re-apply RLS context before the analytics sync.
        set_rls_context(db, corrector_user_id)
        sync_incident_to_analytics(db, inc_id)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Analytics sync failed for corrected incident %s: %s", inc_id, e)

    # Publish real-time SSE event (fire-and-forget)
    task = asyncio.create_task(
        publish_incident_event(
            "incident.corrected",
            incident_id=int(inc_id),
            status="VERIFIED",
            actor_id=str(corrector_user_id),
            actor_role=current_user.get("role", "NATIONAL_VALIDATOR"),
            extra={"corrected_fields": corrected_fields},
        )
    )
    task.add_done_callback(lambda t: t.exception() if t.exception() else None)

    return {
        "incident_id": inc_id,
        "old_data_hash": old_data_hash,
        "new_data_hash": new_data_hash,
        "corrected_fields": corrected_fields,
    }


@router.post("/validator/incidents/bulk-approve")
def bulk_approve_incidents(
    request: Request,
    body: BulkApproveRequest,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Atomically approve multiple PENDING incidents.

    All-or-nothing: if any incident is missing, archived, or not in PENDING status,
    the entire batch is rejected (422) and no incidents are modified.
    """
    validator_user_id = user["user_id"]
    result = bulk_approve_pending_incidents(
        db,
        incident_ids=body.incident_ids,
        notes=body.notes,
        validator_user_id=validator_user_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
    )
    logger.info(
        "Validator user_id=%s bulk-approved %d incidents: %s; held: %d",
        validator_user_id,
        result["approved"],
        result["incident_ids"],
        len(result["held_for_review"]),
    )
    return result


@router.patch("/validator/incidents/{incident_id}/archive")
def archive_incident(
    request: Request,
    incident_id: int,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    body: ClientIdRequest | None = Body(default=None),
    client_id: str | None = Query(default=None),
):
    """Archive a finalized (VERIFIED, REJECTED, or REPLACED) incident.

    Sets is_archived=TRUE, archived_at=NOW(), verification_status unchanged.
    Returns 400 if the incident is not in an archivable finalized status.
    Accepts optional client_id body field for idempotent retry detection (#267).
    """
    validator_user_id = user["user_id"]
    resolved_client_id = body.client_id if body and body.client_id else client_id

    # Validate resolved_client_id as UUID before any DB CAST (#272 Q2)
    if resolved_client_id is not None:
        try:
            uuid.UUID(resolved_client_id)
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=422,
                detail=f"client_id must be a valid UUID, got: {resolved_client_id!r}",
            )

    # Idempotency check (#267)
    if resolved_client_id and _ivh_has_client_id_column(db):
        existing = db.execute(
            text("""
                SELECT 1
                FROM wims.incident_verification_history
                WHERE client_id = CAST(:cid AS uuid)
                LIMIT 1
            """),
            {"cid": resolved_client_id},
        ).fetchone()
        if existing:
            return {"status": "already_applied", "incident_id": incident_id}

    return archive_finalized_incident(
        db,
        incident_id=incident_id,
        validator_user_id=validator_user_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
        client_id=resolved_client_id,
    )


@router.patch("/validator/incidents/{incident_id}/unarchive")
def unarchive_incident(
    request: Request,
    incident_id: int,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    body: ClientIdRequest | None = Body(default=None),
    client_id: str | None = Query(default=None),
):
    """Restore an archived finalized incident to the active validator queue.

    Accepts optional client_id body field for idempotent retry detection (#267).
    """
    validator_user_id = user["user_id"]
    resolved_client_id = body.client_id if body and body.client_id else client_id

    # Validate resolved_client_id as UUID before any DB CAST (#272 Q2)
    if resolved_client_id is not None:
        try:
            uuid.UUID(resolved_client_id)
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=422,
                detail=f"client_id must be a valid UUID, got: {resolved_client_id!r}",
            )

    # Idempotency check (#267)
    if resolved_client_id and _ivh_has_client_id_column(db):
        existing = db.execute(
            text("""
                SELECT 1
                FROM wims.incident_verification_history
                WHERE client_id = CAST(:cid AS uuid)
                LIMIT 1
            """),
            {"cid": resolved_client_id},
        ).fetchone()
        if existing:
            return {"status": "already_applied", "incident_id": incident_id}

    return unarchive_finalized_incident(
        db,
        incident_id=incident_id,
        actor_user_id=validator_user_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
        client_id=resolved_client_id,
    )


@router.delete("/validator/incidents/{incident_id}", status_code=200)
def delete_archived_incident(
    incident_id: int,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Permanently delete an archived incident and all its child records.

    Only incidents with is_archived=TRUE can be deleted. Use this to clean up
    REPLACED incidents from the archive after review.
    Returns 400 if the incident is not archived.
    """
    validator_user_id = user["user_id"]

    incident = db.execute(
        text("""
            SELECT incident_id, verification_status, is_archived
            FROM wims.fire_incidents
            WHERE incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    if not incident[2]:
        raise HTTPException(
            status_code=400,
            detail="Only archived incidents can be deleted. Archive the incident first.",
        )

    try:
        for child_table in (
            "wims.incident_nonsensitive_details",
            "wims.incident_sensitive_details",
            "wims.incident_wildland_afor",
        ):
            db.execute(
                text(f"DELETE FROM {child_table} WHERE incident_id = :iid"),  # noqa: S608
                {"iid": incident_id},
            )
        db.execute(
            text(
                "DELETE FROM wims.incident_verification_history "
                "WHERE target_id = :iid AND target_type = 'OFFICIAL'"
            ),
            {"iid": incident_id},
        )
        db.execute(
            text("DELETE FROM wims.fire_incidents WHERE incident_id = :iid"),
            {"iid": incident_id},
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "Failed to hard-delete archived incident_id=%s by validator %s",
            incident_id,
            validator_user_id,
        )
        raise HTTPException(status_code=500, detail="Delete failed — transaction rolled back")

    logger.info(
        "Validator user_id=%s permanently deleted archived incident_id=%s",
        validator_user_id,
        incident_id,
    )
    return {"status": "deleted", "incident_id": incident_id}


@router.get("/validator/incidents/{incident_id}/diff")
def get_incident_diff(
    incident_id: int,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Return the original-vs-current diff for an incident's nonsensitive fields.

    Original = wims.fire_incidents.submitted_snapshot (JSONB written on first
    DRAFT/REJECTED → PENDING transition).
    Current  = wims.incident_nonsensitive_details (live row).
    """
    incident_row = db.execute(
        text(
            """
            SELECT incident_id, submitted_snapshot
            FROM wims.fire_incidents
            WHERE incident_id = :iid AND is_archived = FALSE
            """
        ),
        {"iid": incident_id},
    ).fetchone()
    if incident_row is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    snapshot: dict[str, Any] | None = incident_row[1]

    current_row = db.execute(
        text(
            """
            SELECT to_jsonb(nd) - 'detail_id' AS doc
            FROM wims.incident_nonsensitive_details nd
            WHERE nd.incident_id = :iid
            """
        ),
        {"iid": incident_id},
    ).fetchone()
    current: dict[str, Any] = current_row[0] if current_row and current_row[0] else {}

    if snapshot is None:
        return {
            "original": None,
            "current": {k: current.get(k) for k in _DIFF_FIELDS if k in current},
            "changed_fields": [],
            "note": "No snapshot available — incident submitted before diff tracking was enabled.",
        }

    original_subset: dict[str, Any] = {k: snapshot.get(k) for k in _DIFF_FIELDS if k in snapshot}
    current_subset: dict[str, Any] = {k: current.get(k) for k in _DIFF_FIELDS if k in current}

    # Normalise scalar fields before comparison to prevent false positives caused by
    # type drift between submitted_snapshot (JSONB) and the live VARCHAR columns
    # (e.g. snapshot may store alarm_level as an integer code, DB stores a label string).
    _SCALAR_DIFF_FIELDS = {
        "alarm_level",
        "general_category",
        "sub_category",
        "specific_type",
        "occupancy_type",
        "responder_type",
        "fire_origin",
        "extent_of_damage",
        "stage_of_fire",
        "fire_station_name",
        "recommendations",
        "notification_dt",
    }

    def _norm_diff(v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return v
        return str(v).strip()

    for k in _SCALAR_DIFF_FIELDS:
        if k in original_subset:
            original_subset[k] = _norm_diff(original_subset[k])
        if k in current_subset:
            current_subset[k] = _norm_diff(current_subset[k])

    all_keys = set(original_subset.keys()) | set(current_subset.keys())
    changed_fields = sorted(k for k in all_keys if original_subset.get(k) != current_subset.get(k))

    return {
        "original": original_subset,
        "current": current_subset,
        "changed_fields": changed_fields,
    }


@router.get("/validator/incidents/{incident_id}/history")
def get_incident_revision_history(
    incident_id: int,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Return IVH status-change entries for one incident, newest first."""
    rows = db.execute(
        text("""
            SELECT
                ivh.history_id,
                ivh.previous_status,
                ivh.new_status,
                ivh.notes,
                ivh.action_label,
                ivh.action_timestamp,
                u.username
            FROM wims.incident_verification_history ivh
            LEFT JOIN wims.users u ON u.user_id = ivh.action_by_user_id
            WHERE ivh.target_type = 'OFFICIAL'
              AND ivh.target_id = :iid
              AND (ivh.action_label IS NULL OR ivh.action_label != 'CREATED_DRAFT')
            ORDER BY ivh.action_timestamp DESC, ivh.history_id DESC
        """),
        {"iid": incident_id},
    ).fetchall()

    # Verify hash-chain integrity on read (#241)
    integrity_result = _verify_incident_hash_chain(db, incident_id, log_violations=True)

    return {
        "incident_id": incident_id,
        "integrity_status": integrity_result["integrity_status"],
        "history": [
            {
                "history_id": r[0],
                "previous_status": r[1],
                "new_status": r[2],
                "notes": r[3],
                "action_label": r[4],
                "action_timestamp": r[5].isoformat() if r[5] else None,
                "actor_username": r[6],
            }
            for r in rows
        ],
    }


@router.get("/validator/audit-logs")
def get_validator_audit_logs(
    user: Annotated[dict, Depends(get_national_validator)],
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
    """Paginated audit-log query over wims.incident_verification_history."""
    where_sql, params = _build_audit_log_query(
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


@router.get("/validator/audit-logs/export")
def export_validator_audit_logs(
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    region_id: Optional[int] = None,
    actor_username: Optional[str] = None,
    role: Optional[str] = None,
    action: Optional[str] = None,
):
    """Return an audit-log CSV. Honors the same filters as the list endpoint."""
    where_sql, params = _build_audit_log_query(
        date_from=date_from,
        date_to=date_to,
        region_id=region_id,
        actor_username=actor_username,
        role=role,
        action=action,
    )

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
            """
        ),
        params,
    ).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "history_id",
            "incident_id",
            "region_id",
            "region_display",
            "action_by_user_id",
            "actor_username",
            "previous_status",
            "new_status",
            "action_label",
            "notes",
            "action_timestamp",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r[0],
                r[1],
                r[2],
                r[9] or "",
                str(r[3]) if r[3] else "",
                r[8] or "",
                r[4],
                r[5],
                r[10] or "",
                (r[6] or "").replace("\n", " "),
                r[7].isoformat() if r[7] else "",
            ]
        )

    export_date = datetime.utcnow().strftime("%Y%m%d")
    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=audit-log-{export_date}.csv",
        },
    )
