"""Regional Office API — encoder write/CRUD routes."""

from __future__ import annotations

import logging
import uuid as _uuid_mod
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_regional_encoder
from auth import get_db_with_rls
from services.afor_import import ALARM_LEVEL_MAP
from services.event_bus import publish_incident_event_sync
from services.regional_incidents import (
    delete_encoder_incident,
    force_replace_pending_incident,
    submit_incident_for_review_command,
    unarchive_finalized_incident,
    unpend_incident_command,
)
from services.kms import get_crypto_provider
from services.regional_incidents.helpers import (
    insert_incident_verification_history as _insert_incident_verification_history,
    normalize_general_category as _normalize_general_category,
)
from utils.audit import log_system_audit, trusted_client_ip
from utils.crypto import SecurityProviderError
from schemas.regional import IncidentCreateRequest, IncidentUpdateRequest

from .field_updates import _apply_incident_field_updates, _fetch_incident_edit_fields

logger = logging.getLogger("wims.regional")
router = APIRouter()


# Import shared helpers from the package init (available since __init__ defines them before submodule imports)
from . import _regional_lifecycle_dependencies  # noqa: E402


@router.post("/incidents", status_code=201)
def create_incident(
    request: Request,
    body: IncidentCreateRequest,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Create a new fire incident (DRAFT) with nonsensitive + optional sensitive details."""
    region_id = body.region_id or user.get("assigned_region_id")
    if region_id is None:
        raise HTTPException(
            status_code=400,
            detail="region_id is required when no assigned region is set",
        )
    assigned_region_id = user.get("assigned_region_id")
    if assigned_region_id and region_id != assigned_region_id:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "REGION_MISMATCH",
                "message": "You can only create incidents in your assigned region.",
            },
        )
    encoder_id = user["user_id"]

    # Idempotency: if client_id is present, return the existing incident rather than
    # creating a duplicate. This handles the case where the offline sync engine retries
    # a create request after a network timeout (unknown whether the server processed it).
    client_id = (body.client_id or "").strip() or None
    if client_id:
        try:
            _uuid_mod.UUID(client_id)
        except (ValueError, AttributeError):
            raise HTTPException(status_code=422, detail="client_id must be a valid UUID v4")

        _has_client_id_col = (
            db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns WHERE table_schema='wims' AND table_name='fire_incidents' AND column_name='client_id'"
                )
            ).fetchone()
            is not None
        )
        if _has_client_id_col:
            db.execute(
                text(
                    "SELECT pg_advisory_xact_lock("
                    "hashtext('fire_incidents_client_id'), hashtext(:cid))"
                ),
                {"cid": client_id},
            )
            existing = db.execute(
                text(
                    "SELECT incident_id, verification_status, incident_type_code FROM wims.fire_incidents WHERE client_id = CAST(:cid AS uuid) LIMIT 1"
                ),
                {"cid": client_id},
            ).fetchone()
            if existing:
                return {
                    "status": "created",  # keeps same shape as the normal 201 response
                    "incident_id": existing[0],
                    "verification_status": existing[1],
                    "incident_type_code": existing[2],
                    "parent_incident_id": body.parent_incident_id,
                }
    else:
        _has_client_id_col = False

    # Reference number is assigned only at validator approval - not at create time
    type_code = (body.incident_type_code or "").strip().upper() or None

    # Insert fire_incidents core row. PostgreSQL rejects INSERT ... ON CONFLICT
    # on tables with immutable-record rules, so client_id retries are serialized
    # above with an advisory transaction lock before a normal insert.
    if _has_client_id_col:
        incident_row = db.execute(
            text("""
                INSERT INTO wims.fire_incidents
                    (encoder_id, region_id, location, verification_status, incident_type_code, parent_incident_id, client_id)
                VALUES (:eid, :rid, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 'DRAFT', :type_code, :parent_id, CAST(:cid AS uuid))
                RETURNING incident_id
            """),
            {
                "eid": encoder_id,
                "rid": region_id,
                "lon": body.longitude,
                "lat": body.latitude,
                "type_code": type_code,
                "parent_id": body.parent_incident_id,
                "cid": client_id,
            },
        ).fetchone()
    else:
        incident_row = db.execute(
            text(
                """
                INSERT INTO wims.fire_incidents
                    (encoder_id, region_id, location, verification_status, incident_type_code, parent_incident_id)
                VALUES (:eid, :rid, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 'DRAFT', :type_code, :parent_id)
                RETURNING incident_id
                """
            ),
            {
                "eid": encoder_id,
                "rid": region_id,
                "lon": body.longitude,
                "lat": body.latitude,
                "type_code": type_code,
                "parent_id": body.parent_incident_id,
            },
        ).fetchone()
    incident_id = incident_row[0]

    # Insert nonsensitive details
    ns_fields = {
        "notification_dt",
        "alarm_level",
        "general_category",
        "sub_category",
        "specific_type",
        "occupancy_type",
        "city_id",
        "barangay_id",
        "province_district",
        "city_municipality",
        "barangay",
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
    }
    # Reference number is assigned only at validator approval — not at create time
    ns_params = {"iid": incident_id}
    ns_cols = ["incident_id"]
    ns_vals = [":iid"]
    for field in ns_fields:
        val = getattr(body, field, None)
        if val is not None:
            if field == "alarm_level" and isinstance(val, str):
                val = ALARM_LEVEL_MAP.get(val.upper().strip(), val)
            elif field == "general_category" and isinstance(val, str):
                val = _normalize_general_category(val)
            ns_cols.append(field)
            ns_vals.append(f":{field}")
            ns_params[field] = val

    if len(ns_cols) > 1:
        db.execute(
            text(
                f"INSERT INTO wims.incident_nonsensitive_details ({', '.join(ns_cols)}) VALUES ({', '.join(ns_vals)})"
            ),
            ns_params,
        )

    # Insert sensitive details (with encryption if any encryptable field provided)
    pii_fields = [
        "caller_name",
        "caller_number",
        "owner_name",
        "occupant_name",
        "narrative_report",
        "casualty_details",
        "estimated_damage_php",
    ]
    has_encryptable = any(getattr(body, f, None) for f in pii_fields)

    sd_fields = {
        "street_address",
        "landmark",
        "establishment_name",
        "receiver_name",
        "prepared_by_officer",
        "noted_by_officer",
        "remarks",
    }
    sd_params = {"iid": incident_id}
    sd_cols = ["incident_id"]
    sd_vals = [":iid"]

    if has_encryptable:
        pii_dict: dict[str, Any] = {}
        for f in pii_fields:
            val = getattr(body, f, None)
            if val is not None and val != "" and val != {} and val != []:
                pii_dict[f] = val
        try:
            provider = get_crypto_provider()
            pii_key_version: int = provider.current_version
            nonce_b64, ct_b64 = provider.encrypt_json(
                pii_dict, f"incident_id:{incident_id}".encode()
            )
            crypto_provider_val = provider.crypto_provider
            kms_key_name_val = provider.kms_key_name
            enc_iv = nonce_b64 if crypto_provider_val == "env_aesgcm" else None
            sd_cols.extend(
                ["pii_blob_enc", "encryption_iv", "crypto_provider", "kms_key_name", "key_version"]
            )
            sd_vals.extend(
                [":pii_blob", ":enc_iv", ":crypto_provider", ":kms_key_name", ":key_ver"]
            )
            sd_params["pii_blob"] = ct_b64
            sd_params["enc_iv"] = enc_iv
            sd_params["crypto_provider"] = crypto_provider_val
            sd_params["kms_key_name"] = kms_key_name_val
            sd_params["key_ver"] = pii_key_version
        except (SecurityProviderError, Exception):
            logger.warning(
                "PII encryption failed — storing without blob (incident_id=%s)",
                incident_id,
            )

    for field in sd_fields:
        val = getattr(body, field, None)
        if val is not None:
            sd_cols.append(field)
            sd_vals.append(f":{field}")
            sd_params[field] = val

    if len(sd_cols) > 1:
        db.execute(
            text(
                f"INSERT INTO wims.incident_sensitive_details ({', '.join(sd_cols)}) VALUES ({', '.join(sd_vals)})"
            ),
            sd_params,
        )

    # When encryption is active, NULL the plaintext estimated_damage_php
    # in incident_nonsensitive_details — the encrypted blob is authoritative.
    if has_encryptable:
        db.execute(
            text(
                "UPDATE wims.incident_nonsensitive_details"
                " SET estimated_damage_php = NULL"
                " WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        )

    _insert_incident_verification_history(
        db,
        incident_id=incident_id,
        actor_user_id=str(encoder_id),
        previous_status="DRAFT",
        new_status="DRAFT",
        notes="Encoder created new draft",
        action_label="CREATED_DRAFT",
        request_ip=trusted_client_ip(request),
    )

    # RP-09: write a system_audit_trails row for encoder incident creation,
    # mirroring the national create path (incidents.py CREATE_INCIDENT).
    log_system_audit(
        db,
        encoder_id,
        "CREATE_INCIDENT",
        "wims.fire_incidents",
        incident_id,
        request,
    )

    db.commit()
    logger.info(
        "Created incident %s in region %s by encoder %s",
        incident_id,
        region_id,
        encoder_id,
    )
    return {
        "status": "created",
        "incident_id": incident_id,
        "verification_status": "DRAFT",
        "incident_type_code": type_code,
        "parent_incident_id": body.parent_incident_id,
    }


@router.put("/incidents/{incident_id}")
def update_incident(
    request: Request,
    incident_id: int,
    body: IncidentUpdateRequest,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Update a DRAFT or REJECTED incident owned by the current encoder.

    Encoders can only edit their own incidents, not those created by other
    encoders. The OCC check protects against same-encoder two-tab conflicts.

    PENDING incidents cannot be edited directly — the encoder must withdraw
    them first (PATCH /incidents/{id}/unpend) which transitions PENDING → DRAFT.
    """
    encoder_id = user["user_id"]

    # Verify the incident is owned by this encoder + editable status.
    # SELECT ... FOR UPDATE locks the row until commit, making OCC atomic.
    incident = db.execute(
        text("""
            SELECT fi.incident_id, fi.verification_status, fi.updated_at
            FROM wims.fire_incidents fi
            WHERE fi.incident_id = :iid
              AND fi.encoder_id = CAST(:eid AS uuid)
              AND fi.is_archived = FALSE
            FOR UPDATE OF fi
        """),
        {"iid": incident_id, "eid": str(encoder_id)},
    ).fetchone()

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found or not owned by you")

    if incident[1] == "PENDING":
        raise HTTPException(
            status_code=403,
            detail="This incident is PENDING review. Withdraw it first to edit.",
        )
    if incident[1] not in ("DRAFT", "REJECTED"):
        raise HTTPException(
            status_code=403,
            detail=f"Cannot edit incident with status '{incident[1]}'. Only DRAFT or REJECTED incidents can be edited.",
        )

    # Optimistic concurrency check: reject stale writes unless force_update is set.
    if body.client_updated_at and not body.force_update:
        server_ts = incident[2]  # updated_at column
        if server_ts:

            def _as_utc(dt: datetime) -> datetime:
                return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

            if _as_utc(server_ts) > _as_utc(body.client_updated_at):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Incident was modified since you last loaded it. Review the differences and re-submit.",
                        "server_version": _fetch_incident_edit_fields(db, incident_id),
                    },
                )

    # Apply field updates (extracted helper — shared with /incidents/draft/{id})
    _apply_incident_field_updates(db, incident_id, body)

    # M4-B Issue #4: log every encoder edit to the audit trail
    try:
        _insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(encoder_id),
            previous_status=incident[1],
            new_status=incident[1],
            notes="Encoder edit — fields updated",
            action_label="EDITED",
            request_ip=trusted_client_ip(request),
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to update incident_id=%s", incident_id)
        raise HTTPException(status_code=500, detail="Failed to save incident draft update")
    logger.info("Updated incident %s by encoder %s", incident_id, encoder_id)

    # Publish real-time SSE event
    publish_incident_event_sync(
        "incident.updated",
        incident_id=incident_id,
        status=incident[1],
        actor_id=str(encoder_id),
        actor_role="REGIONAL_ENCODER",
    )

    return {"status": "updated", "incident_id": incident_id}


@router.post("/incidents/{incident_id}/force-replace")
def force_replace_incident(
    request: Request,
    incident_id: int,
    body: IncidentUpdateRequest,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Replace a PENDING incident's data without requiring withdraw first.

    Used when duplicate detection identifies a PENDING incident that the encoder
    wants to overwrite with the current form data.  The PENDING incident remains
    in PENDING status so the validator sees the updated data.  Every call is
    audited in incident_verification_history.
    """
    encoder_id = user["user_id"]
    result = force_replace_pending_incident(
        db,
        incident_id=incident_id,
        body=body,
        encoder_id=encoder_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
    )
    logger.info("Force-replaced PENDING incident %s by encoder %s", incident_id, encoder_id)
    return result


@router.patch("/incidents/draft/{incident_id}")
def update_draft(
    request: Request,
    incident_id: int,
    body: IncidentUpdateRequest,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Update a DRAFT incident owned by the current encoder.

    Mirrors update_incident() OCC semantics but enforces
    verification_status = 'DRAFT' exclusively. SELECT ... FOR UPDATE
    makes the concurrency check atomic.
    """
    encoder_id = user["user_id"]
    incident = db.execute(
        text(
            """
            SELECT incident_id, verification_status, updated_at
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND encoder_id = CAST(:eid AS uuid)
              AND is_archived = FALSE
            FOR UPDATE OF fire_incidents
            """
        ),
        {"iid": incident_id, "eid": str(encoder_id)},
    ).fetchone()
    if not incident:
        raise HTTPException(status_code=404, detail="Draft not found or not owned by you")
    if incident[1] != "DRAFT":
        raise HTTPException(
            status_code=403,
            detail=f"Endpoint accepts DRAFT only. Current status: {incident[1]}",
        )

    # Optimistic concurrency check: reject stale writes unless force_update is set.
    if body.client_updated_at and not body.force_update:
        server_ts = incident[2]  # updated_at column
        if server_ts:

            def _as_utc(dt: datetime) -> datetime:
                return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

            if _as_utc(server_ts) > _as_utc(body.client_updated_at):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Draft was modified since you last loaded it. Review the differences and re-submit.",
                        "server_version": _fetch_incident_edit_fields(db, incident_id),
                    },
                )

    _apply_incident_field_updates(db, incident_id, body)
    try:
        _insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(encoder_id),
            previous_status="DRAFT",
            new_status="DRAFT",
            notes="Encoder updated draft fields",
            action_label="EDITED",
            request_ip=trusted_client_ip(request),
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to update draft incident_id=%s", incident_id)
        raise HTTPException(status_code=500, detail="Failed to save draft")
    logger.info("Draft updated for incident %s by encoder %s", incident_id, encoder_id)
    return {"status": "draft_updated", "incident_id": incident_id}


@router.delete("/incidents/draft/{incident_id}", status_code=200)
def delete_draft(
    request: Request,
    incident_id: int,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Soft-archive a DRAFT incident (sets is_archived = TRUE)."""
    encoder_id = user["user_id"]
    result = delete_encoder_incident(
        db,
        incident_id=incident_id,
        encoder_id=encoder_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
        draft_only=True,
    )
    logger.info("Draft deleted (archived) incident %s by encoder %s", incident_id, encoder_id)
    return result


@router.patch("/incidents/{incident_id}/unpend")
def unpend_incident(
    request: Request,
    incident_id: int,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Allow encoder to withdraw a PENDING submission back to DRAFT."""
    encoder_id = user["user_id"]
    result = unpend_incident_command(
        db,
        incident_id=incident_id,
        encoder_id=encoder_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
    )
    logger.info("Unpended incident %s by encoder %s", incident_id, encoder_id)
    return result


@router.delete("/incidents/{incident_id}")
def delete_incident(
    request: Request,
    incident_id: int,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Soft-delete a DRAFT or REJECTED incident. Sets is_archived = TRUE."""
    encoder_id = user["user_id"]
    result = delete_encoder_incident(
        db,
        incident_id=incident_id,
        encoder_id=encoder_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
    )
    logger.info("Soft-deleted incident %s by encoder %s", incident_id, encoder_id)
    return result


@router.patch("/incidents/{incident_id}/archive", status_code=200)
def encoder_archive_incident(
    incident_id: int,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Soft-archive a VERIFIED incident owned by the encoder.

    Sets is_archived=TRUE so the incident moves out of the active list.
    The record is preserved and remains visible via the archive view.
    Only VERIFIED incidents can be archived this way; DRAFT and REJECTED
    can be deleted via DELETE /incidents/{id}.
    """
    encoder_id = user["user_id"]
    incident = db.execute(
        text("""
            SELECT incident_id, verification_status
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND encoder_id = CAST(:eid AS uuid)
              AND is_archived = FALSE
        """),
        {"iid": incident_id, "eid": str(encoder_id)},
    ).fetchone()

    if incident is None:
        raise HTTPException(
            status_code=404, detail="Incident not found, already archived, or not owned by you"
        )
    if incident[1] != "VERIFIED":
        raise HTTPException(
            status_code=400,
            detail=f"Only VERIFIED incidents can be archived from the encoder dashboard. Current status: '{incident[1]}'.",
        )

    try:
        db.execute(
            text("""
                UPDATE wims.fire_incidents
                SET is_archived = TRUE,
                    archived_at  = now(),
                    updated_at   = now()
                WHERE incident_id = :iid
            """),
            {"iid": incident_id},
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "Encoder archive failed for incident_id=%s by encoder %s", incident_id, encoder_id
        )
        raise HTTPException(status_code=500, detail="Archive failed — transaction rolled back")

    logger.info("Encoder user_id=%s archived incident_id=%s", encoder_id, incident_id)
    return {"status": "archived", "incident_id": incident_id}


@router.patch("/incidents/{incident_id}/unarchive", status_code=200)
def encoder_unarchive_incident(
    request: Request,
    incident_id: int,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Restore an archived VERIFIED incident owned by the encoder."""
    encoder_id = user["user_id"]
    incident = db.execute(
        text("""
            SELECT incident_id, verification_status
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND encoder_id = CAST(:encoder_id AS uuid)
              AND is_archived = TRUE
        """),
        {"iid": incident_id, "encoder_id": str(encoder_id)},
    ).fetchone()
    if not incident:
        raise HTTPException(
            status_code=404, detail="Archived incident not found or not owned by you"
        )
    if incident[1] != "VERIFIED":
        raise HTTPException(
            status_code=400,
            detail=f"Only VERIFIED incidents can be unarchived by encoders. Current status: '{incident[1]}'.",
        )
    return unarchive_finalized_incident(
        db,
        incident_id=incident_id,
        actor_user_id=encoder_id,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
    )


@router.patch("/incidents/{incident_id}/submit", status_code=200)
def submit_incident_for_review(
    request: Request,
    incident_id: int,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    ack_duplicate: bool = False,
    force: bool = False,
):
    """Submit a DRAFT or REJECTED incident for validator review (DRAFT/REJECTED → PENDING).

    Duplicate check
    ---------------
    On first call (ack_duplicate=False, force=False), if a PENDING or VERIFIED incident
    with the same region + location + fire date exists, returns HTTP 409 with
    {code: "DUPLICATE_DETECTED", matched_incident_id, matched_status} without submitting.

    The caller may:
    - Re-call with ack_duplicate=True: sets is_duplicate=TRUE + duplicate_of before PENDING.
    - Re-call with force=True: bypasses detection entirely, submits without flagging.
    """
    encoder_id = user["user_id"]
    result = submit_incident_for_review_command(
        db,
        incident_id=incident_id,
        encoder_id=encoder_id,
        ack_duplicate=ack_duplicate,
        force=force,
        deps=_regional_lifecycle_dependencies(request_ip=trusted_client_ip(request)),
    )
    logger.info(
        "Encoder user_id=%s submitted incident_id=%s for review",
        encoder_id,
        incident_id,
    )
    return result
