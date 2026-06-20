"""Regional incident lifecycle commands.

This module centralizes official fire_incidents state transitions and their
required side effects. FastAPI routes should remain HTTP Adapters: auth/RLS,
request parsing, and response plumbing live there; transition rules live here.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.analytics_read_model import sync_incident_to_analytics
from services.duplicate_detection import check_for_duplicate
from services.regional_incidents.helpers import DuplicateClientIdError
from services.regional_incidents.policies import (
    ENCODER_DELETABLE_STATUSES,
    ENCODER_SUBMITTABLE_STATUSES,
    VALIDATOR_ACTION_MAP,
    VALIDATOR_ARCHIVABLE_STATUSES,
)
from utils.audit import log_system_audit

logger = logging.getLogger("wims.regional_incidents.lifecycle")

# Module-level cache for is_resubmitted column existence (same defensive pattern as regional.py).
_lc_resubmitted_col_exists: bool | None = None


def _lc_has_resubmitted_column(db: Session) -> bool:
    global _lc_resubmitted_col_exists  # noqa: PLW0603
    if _lc_resubmitted_col_exists is None:
        result = db.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema = 'wims' AND table_name = 'fire_incidents' AND column_name = 'is_resubmitted'"
            )
        ).scalar()
        _lc_resubmitted_col_exists = bool(result)
    return _lc_resubmitted_col_exists


@dataclass(frozen=True)
class RegionalIncidentLifecycleDependencies:
    insert_incident_verification_history: Callable[..., None]
    apply_incident_field_updates: Callable[[Session, int, Any], None] | None = None
    generate_reference_number: Callable[[Session, int, str, str | None], str] | None = None


def _date_str(value: Any) -> str | None:
    if not value:
        return None
    return str(value.date()) if hasattr(value, "date") else str(value)[:10]


def force_replace_pending_incident(
    db: Session,
    *,
    incident_id: int,
    body: Any,
    encoder_id: Any,
    deps: RegionalIncidentLifecycleDependencies,
) -> dict[str, Any]:
    if deps.apply_incident_field_updates is None:
        raise RuntimeError("apply_incident_field_updates dependency is required")

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

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found or not owned by you")
    if incident[1] != "PENDING":
        raise HTTPException(
            status_code=403,
            detail=f"Force-replace only applies to PENDING incidents. Current status: {incident[1]}",
        )

    deps.apply_incident_field_updates(db, incident_id, body)

    try:
        deps.insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(encoder_id),
            previous_status="PENDING",
            new_status="PENDING",
            notes="Encoder force-replaced PENDING incident data (duplicate resolution)",
            action_label="EDITED",
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to force-replace incident_id=%s", incident_id)
        raise HTTPException(status_code=500, detail="Failed to replace incident data")

    return {"status": "replaced", "incident_id": incident_id}


def unpend_incident_command(
    db: Session,
    *,
    incident_id: int,
    encoder_id: Any,
    deps: RegionalIncidentLifecycleDependencies,
) -> dict[str, Any]:
    row = db.execute(
        text("""
            SELECT incident_id, verification_status
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND encoder_id = CAST(:eid AS uuid)
              AND is_archived = FALSE
        """),
        {"iid": incident_id, "eid": str(encoder_id)},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found or not owned by you")
    if row[1] != "PENDING":
        raise HTTPException(status_code=400, detail=f"Incident is {row[1]}, not PENDING")

    try:
        db.execute(
            text(
                "UPDATE wims.fire_incidents SET verification_status = 'DRAFT', updated_at = now() WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        )
        deps.insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(encoder_id),
            previous_status="PENDING",
            new_status="DRAFT",
            notes="Encoder withdrew incident for editing",
            action_label="WITHDRAWN",
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to unpend incident_id=%s", incident_id)
        raise HTTPException(status_code=500, detail="Failed to withdraw incident")

    return {"status": "unpended", "incident_id": incident_id, "new_status": "DRAFT"}


def delete_encoder_incident(
    db: Session,
    *,
    incident_id: int,
    encoder_id: Any,
    deps: RegionalIncidentLifecycleDependencies,
    draft_only: bool = False,
) -> dict[str, Any]:
    not_found = (
        "Draft not found or not owned by you"
        if draft_only
        else "Incident not found or not owned by you"
    )
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

    if not incident:
        raise HTTPException(status_code=404, detail=not_found)

    current_status = incident[1]
    if draft_only and current_status != "DRAFT":
        raise HTTPException(
            status_code=403,
            detail=f"Endpoint accepts DRAFT only. Current status: {current_status}",
        )
    if not draft_only and current_status not in ENCODER_DELETABLE_STATUSES:
        raise HTTPException(
            status_code=403,
            detail=f"Cannot delete incident with status '{current_status}'. Only DRAFT or REJECTED incidents can be deleted.",
        )

    db.execute(
        text(
            "UPDATE wims.fire_incidents SET is_archived = TRUE, updated_at = now() WHERE incident_id = :iid"
        ),
        {"iid": incident_id},
    )
    deps.insert_incident_verification_history(
        db,
        incident_id=incident_id,
        actor_user_id=str(encoder_id),
        previous_status=current_status,
        new_status=current_status,
        notes="Encoder deleted draft" if draft_only else "Encoder deleted incident",
        action_label="DELETED_DRAFT",
    )
    db.commit()
    return {"status": "deleted", "incident_id": incident_id}


def submit_incident_for_review_command(
    db: Session,
    *,
    incident_id: int,
    encoder_id: Any,
    ack_duplicate: bool,
    force: bool,
    deps: RegionalIncidentLifecycleDependencies,
) -> dict[str, Any]:
    incident = db.execute(
        text("""
            SELECT incident_id, verification_status, encoder_id
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND encoder_id = CAST(:eid AS uuid)
              AND is_archived = FALSE
        """),
        {"iid": incident_id, "eid": str(encoder_id)},
    ).fetchone()

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found or not owned by you")

    current_status = incident[1]
    inc_encoder_id = str(incident[2]) if incident[2] else None

    if inc_encoder_id != str(encoder_id):
        raise HTTPException(status_code=403, detail="You can only submit your own incidents")
    if current_status not in ENCODER_SUBMITTABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot submit incident with status '{current_status}'. Only DRAFT or REJECTED incidents can be submitted.",
        )

    required_check = db.execute(
        text("""
            SELECT notification_dt, general_category, province_district, city_municipality
            FROM wims.incident_nonsensitive_details
            WHERE incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    missing_fields = []
    if required_check:
        if not required_check[0]:
            missing_fields.append("notification_dt (Date of Notification)")
        if not required_check[1]:
            missing_fields.append("general_category (Classification)")
        if not required_check[2]:
            missing_fields.append("province_district (Province / District)")
        if not required_check[3]:
            missing_fields.append("city_municipality (City / Municipality)")

    if missing_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot submit: required fields are missing — {', '.join(missing_fields)}",
        )

    matched_duplicate_id: int | None = None
    is_resubmission = current_status == "REJECTED"
    already_flagged = db.execute(
        text("SELECT is_duplicate FROM wims.fire_incidents WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).scalar()
    # On resubmit of a REJECTED incident the previous is_duplicate flag is stale —
    # the encoder changed the data. Force a fresh check regardless of the old value.
    if is_resubmission:
        already_flagged = False

    if not force and not already_flagged and not ack_duplicate:
        geo_meta = db.execute(
            text("""
                SELECT nd.notification_dt, nd.general_category, fi.incident_type_code,
                       fi.region_id, nd.alarm_level,
                       ST_Y(fi.location::geometry) AS lat,
                       ST_X(fi.location::geometry) AS lon,
                       nd.city_municipality, nd.province_district,
                       nd.barangay_id, nd.barangay,
                       sd.street_address, sd.landmark, sd.establishment_name,
                       nd.fire_station_name
                FROM wims.fire_incidents fi
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
                WHERE fi.incident_id = :iid
            """),
            {"iid": incident_id},
        ).fetchone()

        if geo_meta:
            dup_result = check_for_duplicate(
                db,
                incident_id=incident_id,
                region_id=geo_meta[3],
                incident_date=_date_str(geo_meta[0]),
                notification_dt=geo_meta[0],
                lat=geo_meta[5],
                lon=geo_meta[6],
                general_category=geo_meta[1],
                incident_type_code=geo_meta[2],
                city_municipality=geo_meta[7],
                province_district=geo_meta[8],
                barangay_id=geo_meta[9],
                barangay=geo_meta[10],
                street_address=geo_meta[11],
                landmark=geo_meta[12],
                establishment_name=geo_meta[13],
                fire_station_name=geo_meta[14],
                exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
            )
            if dup_result:
                verified_dup, dup_confidence = dup_result
                matched_status = (
                    db.execute(
                        text(
                            "SELECT verification_status FROM wims.fire_incidents WHERE incident_id = :iid"
                        ),
                        {"iid": verified_dup},
                    ).scalar()
                    or "UNKNOWN"
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "DUPLICATE_DETECTED",
                        "incident_id": incident_id,
                        "matched_incident_id": verified_dup,
                        "matched_status": matched_status,
                        "confidence": dup_confidence,
                    },
                )

    try:
        # Always run the duplicate check when the caller acknowledges or force-submits a duplicate,
        # so the is_duplicate flag is persisted and the validator queue shows the badge immediately
        # without needing to click Accept first.
        if (ack_duplicate or force) and not already_flagged:
            geo_meta = db.execute(
                text("""
                    SELECT nd.notification_dt, nd.general_category, fi.incident_type_code,
                           fi.region_id, nd.alarm_level,
                           ST_Y(fi.location::geometry) AS lat,
                           ST_X(fi.location::geometry) AS lon,
                           nd.city_municipality, nd.province_district,
                           nd.barangay_id, nd.barangay,
                           sd.street_address, sd.landmark, sd.establishment_name,
                           nd.fire_station_name
                    FROM wims.fire_incidents fi
                    LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                    LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
                    WHERE fi.incident_id = :iid
                """),
                {"iid": incident_id},
            ).fetchone()
            if geo_meta:
                dup_result = check_for_duplicate(
                    db,
                    incident_id=incident_id,
                    region_id=geo_meta[3],
                    incident_date=_date_str(geo_meta[0]),
                    notification_dt=geo_meta[0],
                    lat=geo_meta[5],
                    lon=geo_meta[6],
                    general_category=geo_meta[1],
                    incident_type_code=geo_meta[2],
                    city_municipality=geo_meta[7],
                    province_district=geo_meta[8],
                    barangay_id=geo_meta[9],
                    barangay=geo_meta[10],
                    street_address=geo_meta[11],
                    landmark=geo_meta[12],
                    establishment_name=geo_meta[13],
                    fire_station_name=geo_meta[14],
                    exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
                )
                matched_duplicate_id = dup_result[0] if dup_result else None
                if matched_duplicate_id:
                    db.execute(
                        text("""
                            UPDATE wims.fire_incidents
                            SET is_duplicate = TRUE, duplicate_of = :did
                            WHERE incident_id = :iid
                        """),
                        {"did": matched_duplicate_id, "iid": incident_id},
                    )

        resubmitted_flag = (
            "is_resubmitted = TRUE, " if is_resubmission and _lc_has_resubmitted_column(db) else ""
        )
        # Clear stale duplicate flags on resubmit unless a new duplicate was just matched
        dup_clear_sql = (
            "is_duplicate = FALSE, duplicate_of = NULL, "
            if is_resubmission and matched_duplicate_id is None
            else ""
        )
        update_result = db.execute(
            text(
                f"UPDATE wims.fire_incidents SET {resubmitted_flag}{dup_clear_sql}verification_status = 'PENDING', updated_at = now() WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        )
        if update_result.rowcount != 1:
            raise HTTPException(status_code=409, detail="Incident status update failed")

        db.execute(
            text(
                """
                UPDATE wims.fire_incidents fi
                SET submitted_snapshot = (
                    SELECT to_jsonb(nd) - 'detail_id'
                    FROM wims.incident_nonsensitive_details nd
                    WHERE nd.incident_id = fi.incident_id
                )
                WHERE fi.incident_id = :iid
                """
            ),
            {"iid": incident_id},
        )
        deps.insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(encoder_id),
            previous_status=current_status,
            new_status="PENDING",
            notes="Submitted for review",
            action_label="SUBMITTED",
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception("Failed to submit incident_id=%s for review", incident_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to submit incident — transaction rolled back",
        )

    return {
        "status": "submitted",
        "incident_id": incident_id,
        "verification_status": "PENDING",
        "is_duplicate": ack_duplicate and matched_duplicate_id is not None,
        "duplicate_of": matched_duplicate_id,
    }


def verify_incident_command(
    db: Session,
    *,
    incident_id: int,
    action_body: Any,
    validator_user_id: Any,
    request: Request,
    force: bool,
    deps: RegionalIncidentLifecycleDependencies,
    client_id: str | None = None,
) -> dict[str, Any]:
    if deps.generate_reference_number is None:
        raise RuntimeError("generate_reference_number dependency is required")

    action = (action_body.action or "").strip().lower()
    if action not in VALIDATOR_ACTION_MAP:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown action '{action_body.action}'. "
                f"Allowed values: {sorted(VALIDATOR_ACTION_MAP.keys())}"
            ),
        )
    target_status = VALIDATOR_ACTION_MAP[action]

    incident_row = db.execute(
        text("""
            SELECT
                fi.incident_id,
                fi.verification_status,
                fi.region_id,
                fi.encoder_id,
                u.keycloak_id,
                fi.created_at
            FROM wims.fire_incidents fi
            JOIN wims.users u ON u.user_id = fi.encoder_id
            WHERE fi.incident_id = :iid AND fi.is_archived = FALSE
        """),
        {"iid": incident_id},
    ).fetchone()

    if incident_row is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc_region_id = incident_row[2]
    inc_encoder_id = incident_row[3]
    inc_keycloak_id = incident_row[4]
    inc_created_at = incident_row[5]
    current_status = incident_row[1]

    if inc_encoder_id is None:
        raise HTTPException(
            status_code=403,
            detail="This incident was submitted via public DMZ (no encoder) and cannot be processed through the validator workflow",
        )
    if current_status == target_status:
        raise HTTPException(
            status_code=409,
            detail=f"Incident is already in status '{current_status}'",
        )
    if current_status == "VERIFIED" and action == "reject":
        raise HTTPException(
            status_code=403,
            detail="Cannot reject an incident that is already verified",
        )
    if current_status == "REJECTED" and action == "accept":
        raise HTTPException(
            status_code=403,
            detail="Cannot accept an incident that has been rejected. It must be resubmitted by the encoder.",
        )
    if current_status in ("VERIFIED", "REJECTED") and action in ("accept", "reject"):
        if current_status == "VERIFIED" and action == "accept":
            pass
        elif current_status == "REJECTED" and action == "reject":
            pass
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition incident from '{current_status}' via action '{action}'. Only Archive is available for finalized incidents.",
            )

    if action == "accept" and not force:
        geo_row = db.execute(
            text("""
                SELECT ST_Y(fi.location::geometry), ST_X(fi.location::geometry),
                       nd.notification_dt, nd.general_category, fi.incident_type_code,
                       fi.region_id, nd.alarm_level, fi.parent_incident_id,
                       nd.city_municipality, nd.province_district,
                       nd.barangay_id, nd.barangay,
                       sd.street_address, sd.landmark, sd.establishment_name,
                       nd.fire_station_name
                FROM wims.fire_incidents fi
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
                WHERE fi.incident_id = :iid
            """),
            {"iid": incident_id},
        ).fetchone()
        if geo_row and geo_row[7] is None:
            dup_result = check_for_duplicate(
                db,
                incident_id=incident_id,
                region_id=geo_row[5],
                incident_date=_date_str(geo_row[2]),
                notification_dt=geo_row[2],
                lat=geo_row[0],
                lon=geo_row[1],
                general_category=geo_row[3],
                incident_type_code=geo_row[4],
                city_municipality=geo_row[8],
                province_district=geo_row[9],
                barangay_id=geo_row[10],
                barangay=geo_row[11],
                street_address=geo_row[12],
                landmark=geo_row[13],
                establishment_name=geo_row[14],
                fire_station_name=geo_row[15],
                exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
            )
            if dup_result:
                dup_id, dup_confidence = dup_result
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "DUPLICATE_DETECTED",
                        "matched_incident_id": dup_id,
                        "confidence": dup_confidence,
                    },
                )

    data_hash = None
    ref_num: str | None = None
    parent_to_archive: int | None = None
    effective_original_id: int | None = None
    if target_status == "VERIFIED":
        canonical = {
            "encoder_id": str(inc_encoder_id),
            "keycloak_id": str(inc_keycloak_id),
            "incident_id": str(incident_id),
            "region_id": str(inc_region_id),
            "verification_status": "VERIFIED",
            "created_at": inc_created_at.isoformat(),
        }
        data_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()

        meta_row = db.execute(
            text("""
                SELECT fi.incident_type_code, fi.parent_incident_id, fi.duplicate_of
                FROM wims.fire_incidents fi
                WHERE fi.incident_id = :iid
            """),
            {"iid": incident_id},
        ).fetchone()
        type_code = meta_row[0] if meta_row else None
        parent_incident_id_val = meta_row[1] if meta_row else None
        duplicate_of_val = meta_row[2] if meta_row else None

        effective_original_id = action_body.original_incident_id or duplicate_of_val
        if action == "accept_replace" and effective_original_id:
            orig_ref_row = db.execute(
                text("SELECT reference_number FROM wims.fire_incidents WHERE incident_id = :pid"),
                {"pid": effective_original_id},
            ).fetchone()
            ref_num = orig_ref_row[0] if orig_ref_row else None
            parent_to_archive = effective_original_id
        elif parent_incident_id_val:
            orig_ref_row = db.execute(
                text("SELECT reference_number FROM wims.fire_incidents WHERE incident_id = :pid"),
                {"pid": parent_incident_id_val},
            ).fetchone()
            ref_num = orig_ref_row[0] if orig_ref_row else None
            parent_to_archive = parent_incident_id_val
        elif type_code:
            ns_meta = db.execute(
                text("""
                    SELECT notification_dt
                    FROM wims.incident_nonsensitive_details
                    WHERE incident_id = :iid
                """),
                {"iid": incident_id},
            ).fetchone()
            notification_dt = str(ns_meta[0]) if ns_meta and ns_meta[0] else None
            ref_num = deps.generate_reference_number(db, inc_region_id, type_code, notification_dt)

    clear_dup = action == "accept_replace" and bool(effective_original_id)
    try:
        if parent_to_archive:
            db.execute(
                text("""
                    UPDATE wims.fire_incidents
                    SET is_archived = TRUE,
                        verification_status = 'REPLACED',
                        reference_number = NULL,
                        archived_at = now(),
                        updated_at = now()
                    WHERE incident_id = :pid
                """),
                {"pid": parent_to_archive},
            )
            deps.insert_incident_verification_history(
                db,
                incident_id=parent_to_archive,
                actor_user_id=str(validator_user_id),
                previous_status="VERIFIED",
                new_status="REPLACED",
                notes=f"Archived — superseded by replacement incident #{incident_id}",
                action_label="REPLACED_EXISTING",
                data_hash=None,
                sync_status="SYNCED",
                client_id=client_id,
            )

        db.execute(
            text("""
                UPDATE wims.fire_incidents
                SET verification_status = :new_status,
                    data_hash = COALESCE(:data_hash, data_hash),
                    updated_at = now(),
                    reference_number = COALESCE(:ref_num, reference_number),
                    is_duplicate = CASE WHEN :clear_dup THEN FALSE ELSE is_duplicate END,
                    duplicate_of = CASE WHEN :clear_dup THEN NULL ELSE duplicate_of END
                WHERE incident_id = :iid
            """),
            {
                "new_status": target_status,
                "iid": incident_id,
                "data_hash": data_hash,
                "ref_num": ref_num,
                "clear_dup": clear_dup,
            },
        )

        action_label_map = {
            "accept": "APPROVED",
            "accept_replace": "ACCEPTED_AS_NEW",
            "reject": "REJECTED",
            "pending": "RETURNED_TO_PENDING",
        }
        deps.insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(validator_user_id),
            previous_status=current_status,
            new_status=target_status,
            notes=action_body.notes or "Validator action",
            action_label=action_label_map.get(action_body.action, action_body.action.upper()),
            data_hash=data_hash if target_status == "VERIFIED" else None,
            sync_status="SYNCED",
            client_id=client_id,
        )
        db.commit()
    except DuplicateClientIdError:
        db.rollback()
        return {"status": "already_applied", "incident_id": incident_id}
    except Exception:
        db.rollback()
        logger.exception("Failed to apply verification action for incident_id=%s", incident_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to apply verification action — transaction rolled back",
        )

    sync_incident_to_analytics(db, incident_id)
    if parent_to_archive:
        sync_incident_to_analytics(db, parent_to_archive)
    db.commit()

    log_system_audit(
        db=db,
        user_id=validator_user_id,
        action_type=f"VERIFY_{action.upper()}",
        table_affected="fire_incidents",
        record_id=incident_id,
        request=request,
    )
    try:
        db.commit()
    except Exception:
        db.rollback()

    return {
        "incident_id": incident_id,
        "previous_status": current_status,
        "new_status": target_status,
        "action": action,
        "encoder_id": str(inc_encoder_id),
        "region_id": inc_region_id,
        "reference_number": ref_num,
        "parent_archived": parent_to_archive,
    }


def bulk_approve_pending_incidents(
    db: Session,
    *,
    incident_ids: list[int],
    notes: str | None,
    validator_user_id: Any,
    deps: RegionalIncidentLifecycleDependencies,
) -> dict[str, Any]:
    if not incident_ids:
        raise HTTPException(status_code=400, detail="incident_ids must not be empty")

    rows = db.execute(
        text(
            """
            SELECT fi2.incident_id, fi2.verification_status, fi2.encoder_id, fi2.created_at,
                   nd.notification_dt, nd.general_category, fi2.incident_type_code,
                   fi2.region_id, nd.alarm_level,
                   ST_Y(fi2.location::geometry), ST_X(fi2.location::geometry),
                   nd.city_municipality, nd.province_district,
                   nd.barangay_id, nd.barangay,
                   sd.street_address, sd.landmark, sd.establishment_name,
                   nd.fire_station_name
            FROM wims.fire_incidents fi2
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi2.incident_id
            LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi2.incident_id
            WHERE fi2.incident_id = ANY(:ids) AND fi2.is_archived = FALSE
            """
        ),
        {"ids": incident_ids},
    ).fetchall()

    found_ids = {r[0] for r in rows}
    missing = sorted(set(incident_ids) - found_ids)
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Some incidents were not found or are archived. Transaction aborted.",
                "missing_ids": missing,
            },
        )

    not_pending = [r[0] for r in rows if r[1] != "PENDING"]
    no_encoder = [r[0] for r in rows if r[2] is None]
    if not_pending or no_encoder:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "All incidents must be PENDING and encoder-submitted. Transaction aborted.",
                "failed_ids": sorted(set(not_pending) | set(no_encoder)),
            },
        )

    rows = sorted(rows, key=lambda r: r[3] or datetime.min.replace(tzinfo=None))
    approved: list[int] = []
    held_for_review: list[dict[str, Any]] = []

    try:
        for row in rows:
            (
                iid,
                prev_status,
                _,
                _created_at,
                notif_dt,
                gen_cat,
                type_code,
                region_id,
                alarm,
                lat,
                lon,
                city_muni,
                province_dist,
                ba_id,
                ba_text,
                street_addr,
                lmark,
                estab_name,
                fire_station,
            ) = row

            dup_result = check_for_duplicate(
                db,
                incident_id=iid,
                region_id=region_id,
                incident_date=_date_str(notif_dt),
                notification_dt=notif_dt,
                lat=lat,
                lon=lon,
                general_category=gen_cat,
                incident_type_code=type_code,
                city_municipality=city_muni,
                province_district=province_dist,
                barangay_id=ba_id,
                barangay=ba_text,
                street_address=street_addr,
                landmark=lmark,
                establishment_name=estab_name,
                fire_station_name=fire_station,
                exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
                verified_window_seconds=60,
            )
            if dup_result:
                dup_id = dup_result[0]
                held_for_review.append({"id": iid, "matching_incident_id": dup_id})
                continue

            db.execute(
                text(
                    """
                    UPDATE wims.fire_incidents
                    SET verification_status = 'VERIFIED', updated_at = now()
                    WHERE incident_id = :iid
                    """
                ),
                {"iid": iid},
            )
            deps.insert_incident_verification_history(
                db,
                incident_id=iid,
                actor_user_id=str(validator_user_id),
                previous_status=prev_status,
                new_status="VERIFIED",
                notes=notes or "Bulk approve",
                action_label="BULK_APPROVED",
            )
            approved.append(iid)

        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Bulk approve failed")
        raise HTTPException(status_code=500, detail="Bulk approve failed — transaction rolled back")

    return {
        "approved": len(approved),
        "incident_ids": sorted(approved),
        "held_for_review": held_for_review,
    }


def archive_finalized_incident(
    db: Session,
    *,
    incident_id: int,
    validator_user_id: Any,
    deps: RegionalIncidentLifecycleDependencies,
    client_id: str | None = None,
) -> dict[str, Any]:
    incident = db.execute(
        text("""
            SELECT incident_id, verification_status
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND is_archived = FALSE
        """),
        {"iid": incident_id},
    ).fetchone()

    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found or already archived")

    current_status = incident[1]
    if current_status not in VALIDATOR_ARCHIVABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only {', '.join(VALIDATOR_ARCHIVABLE_STATUSES)} incidents can be archived. "
                f"Current status: '{current_status}'."
            ),
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
        deps.insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(validator_user_id),
            previous_status=current_status,
            new_status="ARCHIVED",
            notes="Archived by validator",
            action_label="ARCHIVED",
            client_id=client_id,
        )
        db.commit()
    except DuplicateClientIdError:
        db.rollback()
        return {"status": "already_applied", "incident_id": incident_id}
    except Exception:
        db.rollback()
        logger.exception("Failed to archive incident_id=%s", incident_id)
        raise HTTPException(status_code=500, detail="Archive failed — transaction rolled back")

    sync_incident_to_analytics(db, incident_id)
    db.commit()
    return {"status": "archived", "incident_id": incident_id}


def unarchive_finalized_incident(
    db: Session,
    *,
    incident_id: int,
    actor_user_id: Any,
    deps: RegionalIncidentLifecycleDependencies,
    client_id: str | None = None,
) -> dict[str, Any]:
    incident = db.execute(
        text("""
            SELECT incident_id, verification_status
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND is_archived = TRUE
        """),
        {"iid": incident_id},
    ).fetchone()

    if incident is None:
        raise HTTPException(status_code=404, detail="Archived incident not found")

    current_status = incident[1]
    if current_status not in VALIDATOR_ARCHIVABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only {', '.join(VALIDATOR_ARCHIVABLE_STATUSES)} incidents can be unarchived. "
                f"Current status: '{current_status}'."
            ),
        )

    try:
        db.execute(
            text("""
                UPDATE wims.fire_incidents
                SET is_archived = FALSE,
                    archived_at  = NULL,
                    updated_at   = now()
                WHERE incident_id = :iid
            """),
            {"iid": incident_id},
        )
        deps.insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(actor_user_id),
            previous_status="ARCHIVED",
            new_status=current_status,
            notes="Unarchived incident",
            action_label="UNARCHIVED",
            client_id=client_id,
        )
        db.commit()
    except DuplicateClientIdError:
        db.rollback()
        return {"status": "already_applied", "incident_id": incident_id}
    except Exception:
        db.rollback()
        logger.exception("Failed to unarchive incident_id=%s", incident_id)
        raise HTTPException(status_code=500, detail="Unarchive failed — transaction rolled back")

    sync_incident_to_analytics(db, incident_id)
    db.commit()
    return {"status": "unarchived", "incident_id": incident_id}
