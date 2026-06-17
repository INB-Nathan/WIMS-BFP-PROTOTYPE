import hashlib
import json
import logging
import os
import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import auth
from auth import get_current_wims_user, get_analyst_or_admin
from auth import get_db_with_rls
from database import set_rls_context
from schemas.incident import IncidentCreate, IncidentResponse
from services.analytics.filters import append_common_filters, build_analytics_filters
from services.analytics_read_model import sync_incident_to_analytics
from services.kms import get_crypto_provider
from services.regional_incidents.helpers import (
    normalize_general_category as _normalize_general_category,
    insert_incident_verification_history as _insert_incident_verification_history,
    verify_incident_hash_chain as _verify_incident_hash_chain,
)
from tasks.exports import export_analyst_incidents_task
from utils.audit import log_system_audit
from utils.crypto import SecurityProviderError

router = APIRouter(prefix="/api", tags=["incidents"])
logger = logging.getLogger("wims.incidents")

STORAGE_DIR = "/app/storage/attachments"

# Maximum bytes read into memory per upload. AES-256-GCM requires the full
# plaintext in one call — no streaming AEAD. Default 25 MB; override via env.
# For large video evidence files a chunked AEAD approach would be needed (future).
MAX_ATTACHMENT_BYTES = int(os.getenv("WIMS_MAX_ATTACHMENT_BYTES", str(25 * 1024 * 1024)))

# Roles permitted to view/download incident attachments.
_ATTACHMENT_VIEWER_ROLES = frozenset(
    {
        "SYSTEM_ADMIN",
        "NATIONAL_ANALYST",
        "NATIONAL_VALIDATOR",
        "REGIONAL_ENCODER",
    }
)


def _resolve_storage_dir() -> str:
    """Pick the first writable attachment directory."""
    candidates = [
        os.getenv("WIMS_ATTACHMENT_STORAGE_DIR", "").strip(),
        STORAGE_DIR,
        "/tmp/wims/attachments",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            os.makedirs(candidate, exist_ok=True)
            test_path = os.path.join(candidate, ".write_test")
            with open(test_path, "wb") as fp:
                fp.write(b"ok")
            os.remove(test_path)
            return candidate
        except Exception:
            continue
    raise HTTPException(status_code=500, detail="No writable attachment storage path available")


@router.post("/incidents/upload-bundle")
def upload_incident_bundle(
    body: Annotated[dict[str, Any], Body(...)],
    user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Compatibility endpoint used by existing frontend bundle submit flow."""
    incidents = body.get("incidents")
    if not isinstance(incidents, list) or len(incidents) == 0:
        raise HTTPException(status_code=400, detail="No incidents provided")

    user_id = user["user_id"]
    user_role = user.get("role", "")

    # Resolve the user's assigned region from the DB (not available in the base JWT payload)
    assigned_row = db.execute(
        text("SELECT assigned_region_id FROM wims.users WHERE user_id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).fetchone()
    assigned_region_id = assigned_row[0] if assigned_row else None

    region_id_raw = body.get("region_id")
    try:
        region_id = int(region_id_raw)
    except (TypeError, ValueError):
        # Fall back to assigned region (encoder) or first available region
        if assigned_region_id:
            region_id = int(assigned_region_id)
        else:
            region_row = db.execute(
                text("SELECT region_id FROM wims.ref_regions LIMIT 1")
            ).fetchone()
            if not region_row:
                raise HTTPException(status_code=500, detail="No region available")
            region_id = int(region_row[0])

    # Enforce REGIONAL_ENCODER can only submit for their assigned region
    if user_role in ("REGIONAL_ENCODER", "ENCODER") and assigned_region_id is not None:
        if region_id != int(assigned_region_id):
            raise HTTPException(
                status_code=403,
                detail="REGION_MISMATCH: You can only submit incidents for your assigned region.",
            )

    batch_row = db.execute(
        text(
            """
            INSERT INTO wims.data_import_batches (region_id, uploaded_by, record_count)
            VALUES (:region_id, CAST(:uid AS uuid), :count)
            RETURNING batch_id
            """
        ),
        {"region_id": region_id, "uid": user_id, "count": len(incidents)},
    ).fetchone()

    if not batch_row:
        raise HTTPException(status_code=500, detail="Failed to create import batch")

    batch_id = int(batch_row[0])
    results: dict[str, list] = {"imported": [], "failed": []}
    i = 0

    # Offline-first idempotency: detect the optional client_id column once. When the
    # offline sync engine retries a create that already succeeded server-side (network
    # timeout masked the 201), the duplicate client_id lets us return the existing row
    # instead of inserting a second incident. See migration 45 + main.py self-heal.
    client_id_col_exists = (
        db.execute(
            text(
                "SELECT 1 FROM information_schema.columns"
                " WHERE table_schema='wims' AND table_name='fire_incidents'"
                " AND column_name='client_id'"
            )
        ).fetchone()
        is not None
    )

    def _safe_int(v: Any, default: int = 0) -> int:
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    def _safe_float(v: Any, default: float = 0.0) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    # _parse_client_ts is defined once outside the loop so it isn't redefined on
    # every iteration (which triggers a SyntaxWarning in some Python versions).
    def _parse_client_ts(raw: Any) -> str | None:
        if not raw or not isinstance(raw, str):
            return None
        try:
            from datetime import datetime, timezone

            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            now_utc = datetime.now(timezone.utc)
            if dt > now_utc:
                return now_utc.isoformat()
            return dt.isoformat()
        except (ValueError, OverflowError):
            return None

    for item in incidents:
        if not isinstance(item, dict):
            continue

        i += 1
        ns = item.get("incident_nonsensitive_details") or {}
        sens = item.get("incident_sensitive_details") or {}
        if not isinstance(ns, dict):
            ns = {}
        if not isinstance(sens, dict):
            sens = {}

        item_client_id = str(item.get("client_id") or "").strip() or None
        if client_id_col_exists and item_client_id:
            try:
                uuid.UUID(item_client_id)
            except (ValueError, AttributeError):
                raise HTTPException(status_code=422, detail="client_id must be a valid UUID")

            # fire_incidents has immutable-record rules, and PostgreSQL rejects
            # INSERT ... ON CONFLICT on tables with INSERT/UPDATE rules. This
            # lock keeps same-client retries idempotent without using ON CONFLICT.
            db.execute(
                text(
                    "SELECT pg_advisory_xact_lock("
                    "hashtext('fire_incidents_client_id'), hashtext(:cid))"
                ),
                {"cid": item_client_id},
            )
            existing_row = db.execute(
                text(
                    "SELECT incident_id FROM wims.fire_incidents"
                    " WHERE client_id = CAST(:cid AS uuid) LIMIT 1"
                ),
                {"cid": item_client_id},
            ).fetchone()
            if existing_row:
                results["imported"].append(int(existing_row[0]))
                continue

        lon = _safe_float(item.get("longitude"), 0.0)
        lat = _safe_float(item.get("latitude"), 0.0)

        incident_type_code_val = (ns.get("incident_type_code") or "").strip().upper() or None

        city_id: int | None = None
        city_id_raw = ns.get("city_id")
        try:
            city_candidate = int(city_id_raw) if city_id_raw is not None else None
        except (TypeError, ValueError):
            city_candidate = None
        if city_candidate and city_candidate > 0:
            city_exists = db.execute(
                text("SELECT 1 FROM wims.ref_cities WHERE city_id = :cid LIMIT 1"),
                {"cid": city_candidate},
            ).fetchone()
            city_id = city_candidate if city_exists else None

        _cid_col = ", client_id" if client_id_col_exists else ""
        _cid_val = ", CAST(:client_id AS uuid)" if client_id_col_exists else ""

        # Accept optional client-supplied timestamps for offline-first sync.
        # These are ISO-8601 strings queued on the client when the device was offline.
        # We validate and clamp to current time to prevent far-future values.
        client_created_at = _parse_client_ts(item.get("created_at"))
        client_updated_at = _parse_client_ts(item.get("updated_at"))
        _ts_cols = ""
        _ts_vals = ""
        if client_created_at:
            _ts_cols += ", created_at"
            _ts_vals += ", CAST(:client_created_at AS timestamptz)"
        if client_updated_at:
            _ts_cols += ", updated_at"
            _ts_vals += ", CAST(:client_updated_at AS timestamptz)"

        inc_params = {
            "batch_id": batch_id,
            "uid": user_id,
            "region_id": region_id,
            "lon": lon,
            "lat": lat,
            "incident_type_code": incident_type_code_val,
        }
        if client_id_col_exists:
            inc_params["client_id"] = item_client_id
        if client_created_at:
            inc_params["client_created_at"] = client_created_at
        if client_updated_at:
            inc_params["client_updated_at"] = client_updated_at

        # Use a savepoint so a failed INSERT for this incident rolls back only
        # that incident, not the entire batch (including the batch header row).
        # PostgreSQL leaves the connection in ABORTED state on any unhandled
        # exception inside a transaction; without a savepoint we'd have to
        # rollback the whole batch.
        inc_row = None
        incident_id = -1
        db.execute(text("SAVEPOINT incident_sp"))
        try:
            inc_row = db.execute(
                text(
                    f"""
                    INSERT INTO wims.fire_incidents
                        (import_batch_id, encoder_id, region_id, location, verification_status,
                         incident_type_code, reference_number{_cid_col}{_ts_cols})
                    VALUES
                        (:batch_id, CAST(:uid AS uuid), :region_id,
                         ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                         'DRAFT', :incident_type_code, NULL{_cid_val}{_ts_vals})
                    RETURNING incident_id
                    """
                ),
                inc_params,
            ).fetchone()

            if not inc_row:
                # Empty RETURNING means the ON CONFLICT path fired — retrieve the existing row.
                if client_id_col_exists and item_client_id:
                    existing_row = db.execute(
                        text(
                            "SELECT incident_id FROM wims.fire_incidents"
                            " WHERE client_id = CAST(:cid AS uuid) LIMIT 1"
                        ),
                        {"cid": item_client_id},
                    ).fetchone()
                    if existing_row:
                        db.execute(text("RELEASE SAVEPOINT incident_sp"))
                        results["imported"].append(int(existing_row[0]))
                        continue
                db.execute(text("ROLLBACK TO SAVEPOINT incident_sp"))
                db.execute(text("RELEASE SAVEPOINT incident_sp"))
                results["failed"].append({"index": i, "reason": "Failed to insert incident row"})
                continue

            incident_id = int(inc_row[0])
            results["imported"].append(incident_id)

            db.execute(
                text(
                    """
                    INSERT INTO wims.incident_nonsensitive_details (
                        incident_id, city_id,
                        notification_dt, alarm_level, general_category, sub_category,
                        responder_type, fire_origin, extent_of_damage,
                        structures_affected, households_affected, families_affected,
                        individuals_affected, vehicles_affected,
                        total_response_time_minutes, total_gas_consumed_liters,
                        resources_deployed, alarm_timeline, problems_encountered,
                        recommendations, fire_station_name, stage_of_fire,
                        extent_total_floor_area_sqm, extent_total_land_area_hectares,
                        distance_from_station_km,
                        city_municipality, province_district, barangay,
                        extent_description, extent_objects_count,
                        general_description_of_involved
                    ) VALUES (
                        :incident_id, :city_id,
                        CAST(:notification_dt AS timestamptz), :alarm_level, :general_category, :sub_category,
                        :responder_type, :fire_origin, :extent_of_damage,
                        :structures_affected, :households_affected, :families_affected,
                        :individuals_affected, :vehicles_affected,
                        :total_response_time_minutes, :total_gas_consumed_liters,
                        CAST(:resources_deployed AS jsonb), CAST(:alarm_timeline AS jsonb), CAST(:problems_encountered AS jsonb),
                        :recommendations, :fire_station_name, :stage_of_fire,
                        :floor_area, :land_area,
                        :distance_from_station_km,
                        :city_municipality, :province_district, :barangay,
                        :extent_description, :extent_objects_count,
                        :general_description_of_involved
                    )
                    """
                ),
                {
                    "incident_id": incident_id,
                    "city_id": city_id,
                    "notification_dt": ns.get("notification_dt"),
                    "alarm_level": ns.get("alarm_level", ""),
                    "general_category": _normalize_general_category(
                        ns.get("general_category", "") or ""
                    ),
                    "sub_category": ns.get("incident_type") or ns.get("sub_category") or "",
                    "responder_type": ns.get("responder_type", ""),
                    "fire_origin": ns.get("fire_origin", ""),
                    "extent_of_damage": ns.get("extent_of_damage", ""),
                    "structures_affected": _safe_int(ns.get("structures_affected")),
                    "households_affected": _safe_int(ns.get("households_affected")),
                    "families_affected": _safe_int(ns.get("families_affected")),
                    "individuals_affected": _safe_int(ns.get("individuals_affected")),
                    "vehicles_affected": _safe_int(ns.get("vehicles_affected")),
                    "total_response_time_minutes": _safe_int(ns.get("total_response_time_minutes")),
                    "total_gas_consumed_liters": _safe_float(ns.get("total_gas_consumed_liters")),
                    "resources_deployed": json.dumps(ns.get("resources_deployed", {})),
                    "alarm_timeline": json.dumps(ns.get("alarm_timeline", {})),
                    "problems_encountered": json.dumps(ns.get("problems_encountered", [])),
                    "recommendations": ns.get("recommendations", ""),
                    "fire_station_name": ns.get("fire_station_name", ""),
                    "stage_of_fire": ns.get("stage_of_fire", ""),
                    "floor_area": _safe_float(ns.get("extent_total_floor_area_sqm")),
                    "land_area": _safe_float(ns.get("extent_total_land_area_hectares")),
                    "distance_from_station_km": _safe_float(
                        ns.get("distance_to_fire_scene_km") or ns.get("distance_from_station_km")
                    ),
                    "city_municipality": ns.get("city_municipality") or "",
                    "province_district": ns.get("province_district") or "",
                    "barangay": ns.get("barangay") or "",
                    "extent_description": ns.get("extent_description") or None,
                    "extent_objects_count": _safe_int(ns.get("extent_objects_count")),
                    "general_description_of_involved": ns.get("general_description_of_involved")
                    or None,
                },
            )

            # ── Encrypt sensitive fields before INSERT ──────────────────────────────
            pii_for_blob = {
                k: v
                for k, v in (
                    ("caller_name", sens.get("caller_name")),
                    ("caller_number", sens.get("caller_number")),
                    ("owner_name", sens.get("owner_name")),
                    ("occupant_name", sens.get("occupant_name")),
                    ("narrative_report", sens.get("narrative_report")),
                    ("casualty_details", sens.get("casualty_details")),
                    ("estimated_damage_php", ns.get("estimated_damage_php")),
                )
                if v  # omit None and empty strings/empty dicts
            }
            aad = f"incident_id:{incident_id}".encode("utf-8")
            nonce_b64: str | None = None
            ct_b64: str | None = None
            provider = get_crypto_provider()
            crypto_provider_val: str = provider.crypto_provider
            kms_key_name_val: str | None = provider.kms_key_name
            pii_key_version: int = provider.current_version
            try:
                nonce_b64, ct_b64 = provider.encrypt_json(pii_for_blob, aad)
            except (SecurityProviderError, Exception) as exc:
                logger.warning(
                    "PII encryption unavailable for incident_id=%s during bundle upload; "
                    "proceeding without encrypted blob (%s)",
                    incident_id,
                    exc,
                )

            enc_iv = nonce_b64 if crypto_provider_val == "env_aesgcm" else None

            db.execute(
                text(
                    """
                    INSERT INTO wims.incident_sensitive_details (
                        incident_id, street_address, landmark,
                        caller_name, caller_number, receiver_name,
                        owner_name, establishment_name,
                        narrative_report, disposition,
                        disposition_prepared_by, disposition_noted_by,
                        personnel_on_duty, other_personnel, casualty_details,
                        is_icp_present, icp_location,
                        pii_blob_enc, encryption_iv,
                        crypto_provider, kms_key_name, key_version
                    ) VALUES (
                        :incident_id, :street_address, :landmark,
                        NULL, NULL, :receiver_name,
                        NULL, :establishment_name,
                        NULL, :disposition,
                        :disposition_prepared_by, :disposition_noted_by,
                        CAST(:personnel_on_duty AS jsonb), CAST(:other_personnel AS jsonb),
                        NULL::jsonb,
                        :is_icp_present, :icp_location,
                        :pii_blob_enc, :pii_nonce,
                        :crypto_provider, :kms_key_name, :key_version
                    )
                    """
                ),
                {
                    "incident_id": incident_id,
                    "street_address": sens.get("street_address")
                    or ns.get("incident_address")
                    or "",
                    "landmark": sens.get("landmark") or ns.get("nearest_landmark") or "",
                    # Plaintext PII columns → NULL; only pii_blob_enc is authoritative
                    "receiver_name": sens.get("receiver_name", ""),
                    "establishment_name": sens.get("establishment_name", ""),
                    # narrative_report → encrypted in blob; plaintext column NULL
                    "disposition": sens.get("disposition", ""),
                    "disposition_prepared_by": sens.get("prepared_by_officer")
                    or sens.get("disposition_prepared_by", ""),
                    "disposition_noted_by": sens.get("noted_by_officer")
                    or sens.get("disposition_noted_by", ""),
                    "personnel_on_duty": json.dumps(sens.get("personnel_on_duty", {})),
                    "other_personnel": json.dumps(ns.get("other_personnel", [])),
                    # casualty_details → encrypted in blob; plaintext column NULL
                    "is_icp_present": bool(sens.get("is_icp_present", False)),
                    "icp_location": sens.get("icp_location", ""),
                    # Encrypted blob
                    "pii_blob_enc": ct_b64,
                    "pii_nonce": enc_iv,
                    "crypto_provider": crypto_provider_val,
                    "kms_key_name": kms_key_name_val,
                    "key_version": pii_key_version,
                },
            )

            _insert_incident_verification_history(
                db,
                incident_id=incident_id,
                actor_user_id=str(user_id),
                previous_status="DRAFT",
                new_status="DRAFT",
                notes="Encoder created new draft",
                action_label="CREATED_DRAFT",
            )

            db.execute(text("RELEASE SAVEPOINT incident_sp"))

        except Exception as exc:
            # Roll back only this incident — the batch header and any previously
            # committed incidents in this loop are preserved.
            db.execute(text("ROLLBACK TO SAVEPOINT incident_sp"))
            db.execute(text("RELEASE SAVEPOINT incident_sp"))
            # Remove the optimistically-appended incident_id so it isn't returned
            # as a successful import.
            if results["imported"] and results["imported"][-1] == incident_id:
                results["imported"].pop()
            logger.warning(
                "upload-bundle: failed to insert incident id=%d (loop index %d): %s",
                incident_id,
                i,
                exc,
            )
            results["failed"].append({"index": i, "reason": "incident_insert_failed"})

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("upload-bundle commit failed")
        raise HTTPException(
            status_code=500, detail=f"upload-bundle commit failed: {type(e).__name__}"
        ) from None

    # SET LOCAL resets on commit/rollback; re-apply RLS context before every
    # analytics sync iteration so a rollback inside sync_incident_to_analytics
    # doesn't leave subsequent iterations without the intended row-level filter.
    for iid in results["imported"]:
        set_rls_context(db, user_id)
        try:
            sync_incident_to_analytics(db, iid)
        except Exception:
            logger.warning("Failed to sync incident %s to analytics read model", iid)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Analytics sync commit failed; incidents already saved in first commit")

    return {
        "status": "ok",
        "batch_id": batch_id,
        "imported": results["imported"],
        "incident_ids": results["imported"],
        "failed": results["failed"],
        "message": f"Committed {len(results['imported'])} incident(s), {len(results['failed'])} failed.",
    }


@router.post("/incidents/{incident_id}/attachments", status_code=201)
async def upload_attachment(
    incident_id: int,
    file: UploadFile = File(...),
    user: Annotated[dict, Depends(get_current_wims_user)] = None,
    db: Annotated[Session, Depends(get_db_with_rls)] = None,
):
    """Upload an attachment for an incident.

    Reads the full file into memory (max MAX_ATTACHMENT_BYTES), hashes on
    plaintext, then encrypts with AES-256-GCM before writing to disk.
    The nonce (encryption_iv) and key_version are stored in the DB row.
    Legacy files uploaded before this migration have is_encrypted=false and are
    served raw — no backfill is performed.
    """
    storage_dir = _resolve_storage_dir()

    # Verify incident exists (RLS ensures the caller can only see their region)
    incident = db.execute(
        text("SELECT incident_id FROM wims.fire_incidents WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Read into memory with hard size cap — AESGCM requires full plaintext at once
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Attachment exceeds maximum allowed size of "
                    f"{MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB"
                ),
            )
        chunks.append(chunk)
    plaintext = b"".join(chunks)

    # SHA-256 on plaintext (before encryption) — hash represents original content
    sha256_digest = hashlib.sha256(plaintext).hexdigest()

    # Generate filename; use UUID as AAD so ciphertext is bound to this file path
    file_ext = os.path.splitext(file.filename or "")[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    storage_path = os.path.join(storage_dir, unique_filename)
    aad = f"attachment:{unique_filename}".encode()

    provider = get_crypto_provider()
    crypto_provider_val = provider.crypto_provider
    kms_key_name_val = provider.kms_key_name
    try:
        nonce_b64, ct_bytes = provider.encrypt_bytes(plaintext, aad)
    except Exception:
        logger.exception("Failed to encrypt attachment for incident_id=%s", incident_id)
        raise HTTPException(status_code=500, detail="Failed to encrypt attachment")

    try:
        with open(storage_path, "wb") as fp:
            fp.write(ct_bytes)
    except Exception:
        logger.exception("Failed to write encrypted attachment to disk")
        raise HTTPException(status_code=500, detail="Failed to save attachment")

    try:
        att_row = db.execute(
            text("""
                INSERT INTO wims.incident_attachments (
                    incident_id, file_name, storage_path, mime_type,
                    file_hash_sha256, uploaded_by,
                    is_encrypted, encryption_iv, key_version,
                    crypto_provider, kms_key_name
                ) VALUES (
                    :iid, :fname, :path, :mime,
                    :hash, :uid,
                    true, :iv, :kv,
                    :crypto_provider, :kms_key_name
                )
                RETURNING attachment_id
            """),
            {
                "iid": incident_id,
                "fname": file.filename,
                "path": storage_path,
                "mime": file.content_type,
                "hash": sha256_digest,
                "uid": user["user_id"],
                "iv": nonce_b64,
                "kv": provider.current_version,
                "crypto_provider": crypto_provider_val,
                "kms_key_name": kms_key_name_val,
            },
        ).fetchone()
        if att_row is None:
            raise HTTPException(status_code=500, detail="Attachment insert returned no row")
        attachment_id = int(att_row[0])
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        if os.path.exists(storage_path):
            os.remove(storage_path)
        logger.exception("Database error during attachment upload")
        raise HTTPException(status_code=500, detail="Internal server error")

    return {
        "status": "ok",
        "attachment_id": attachment_id,
        "message": "Attachment uploaded successfully",
    }


@router.get("/incidents/{incident_id}/attachments/{attachment_id}")
async def serve_attachment(
    incident_id: int,
    attachment_id: int,
    user: Annotated[dict, Depends(get_current_wims_user)] = None,
    db: Annotated[Session, Depends(get_db_with_rls)] = None,
):
    """Download and transparently decrypt an incident attachment.

    Encrypted files (is_encrypted=true) are decrypted with AES-256-GCM before
    streaming.  Legacy plaintext files (is_encrypted=false) are served raw with
    no decrypt step.  RLS on incident_attachments enforces regional isolation;
    role check enforces staff-only access.
    """
    if user.get("role") not in _ATTACHMENT_VIEWER_ROLES:
        raise HTTPException(status_code=403, detail="Incident viewing privileges required")

    row = db.execute(
        text("""
            SELECT storage_path, encryption_iv, is_encrypted, key_version,
                   mime_type, file_name, crypto_provider
            FROM wims.incident_attachments
            WHERE attachment_id = :aid AND incident_id = :iid
        """),
        {"aid": attachment_id, "iid": incident_id},
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # ── Column-to-variable mapping (7 columns, positional) ─────────────
    # SELECT order: storage_path, encryption_iv, is_encrypted, key_version,
    #               mime_type, file_name, crypto_provider
    # CAUTION: any column addition, reordering, or deletion in the SELECT
    # list must be reflected here.  Consider using row._mapping for named
    # attribute access as a future improvement (GH #294).
    (
        storage_path,
        encryption_iv,
        is_encrypted,
        key_version,
        mime_type,
        file_name,
        stored_crypto_provider,
    ) = row

    if not os.path.exists(storage_path):
        logger.error(
            "Attachment file missing on disk: attachment_id=%s path=%s",
            attachment_id,
            storage_path,
        )
        raise HTTPException(status_code=404, detail="Attachment file not found on disk")

    with open(storage_path, "rb") as fp:
        file_bytes = fp.read()

    if is_encrypted:
        unique_filename = os.path.basename(storage_path)
        aad = f"attachment:{unique_filename}".encode()
        provider = get_crypto_provider({"crypto_provider": stored_crypto_provider})
        try:
            plaintext = provider.decrypt_bytes(encryption_iv, file_bytes, aad, key_version or 1)
        except Exception:
            logger.exception(
                "Decryption failed for attachment_id=%s; possible tampering or key mismatch",
                attachment_id,
            )
            raise HTTPException(status_code=500, detail="Attachment decryption failed")
    else:
        # Legacy unencrypted file: read entirely into memory with no size cap.
        # Only pre-migration attachments (is_encrypted=false, uploaded before
        # encryption was enabled) hit this path.  New uploads are bounded by
        # WIMS_MAX_ATTACHMENT_BYTES (25 MB default via env).
        # Streaming AEAD for large legacy files is deferred future work.
        plaintext = file_bytes

    safe_name = os.path.basename(file_name or f"attachment_{attachment_id}")
    # Sanitize: strip control chars, double quotes, and DEL to prevent
    # header injection via crafted filenames (Q1 review finding).
    safe_name = re.sub(r'[\x00-\x1f\x7f"]', "_", safe_name)
    return Response(
        content=plaintext,
        media_type=mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.post("/incidents", response_model=IncidentResponse, status_code=201)
def create_incident(
    body: IncidentCreate,
    request: Request,
    user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> IncidentResponse:
    """
    Create a fire incident from geospatial intake.
    Requires authenticated Keycloak user present in wims.users.
    """
    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"
    user_id = user["user_id"]

    # Resolve a default region (required by schema)
    region_row = db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    if region_row is None:
        raise HTTPException(
            status_code=500, detail="No ref_regions seed data — cannot create incident"
        )

    region_id = region_row[0]

    result = db.execute(
        text("""
            INSERT INTO wims.fire_incidents (region_id, encoder_id, location, verification_status)
            VALUES (:region_id, :encoder_id, ST_GeogFromText(:wkt), :verification_status)
            RETURNING incident_id, location, encoder_id, verification_status, created_at
        """),
        {
            "region_id": region_id,
            "encoder_id": user_id,
            "wkt": wkt,
            "verification_status": body.verification_status,
        },
    )
    row = result.fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create incident")

    log_system_audit(db, user_id, "CREATE_INCIDENT", "wims.fire_incidents", row[0], request)
    db.commit()

    # SET LOCAL resets on commit; re-apply RLS context before the analytics sync.
    set_rls_context(db, user_id)
    incident_id = row[0]
    try:
        sync_incident_to_analytics(db, incident_id)
    except Exception:
        logger.warning("Analytics sync failed for incident %s in create_incident", incident_id)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.warning(
            "Analytics sync commit failed for incident %s; incident already saved", incident_id
        )

    # Extract lat/lon from PostGIS geography for response
    coord_row = db.execute(
        text(
            "SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM wims.fire_incidents WHERE incident_id = :iid"
        ),
        {"iid": incident_id},
    ).fetchone()

    lat = float(coord_row[0])
    lon = float(coord_row[1])

    return IncidentResponse(
        incident_id=incident_id,
        latitude=lat,
        longitude=lon,
        encoder_id=str(row[2]) if row[2] is not None else None,
        status=row[3],
        created_at=row[4],
    )


@router.get("/incidents")
def get_incidents(
    user: Annotated[dict, Depends(auth.get_incident_viewer)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    category: Optional[str] = None,
    status: Optional[str] = None,
):
    """
    Fetch fire incidents. Scoped to region if user has one, otherwise national.
    """
    region_id = user.get("assigned_region_id")

    where_clauses = ["fi.is_archived = FALSE"]
    params: dict[str, Any] = {"limit": limit, "offset": offset}

    if region_id is not None:
        where_clauses.append("fi.region_id = :region_id")
        params["region_id"] = region_id

    if category:
        where_clauses.append("nd.general_category = :category")
        params["category"] = category
    if status:
        where_clauses.append("fi.verification_status = :status")
        params["status"] = status

    where_sql = " AND ".join(where_clauses)

    rows = db.execute(
        text(
            f"""
            SELECT fi.incident_id, fi.verification_status, fi.created_at,
                   nd.notification_dt, nd.general_category, nd.alarm_level,
                   nd.fire_station_name, nd.structures_affected,
                   nd.households_affected, nd.individuals_affected,
                   nd.responder_type, nd.fire_origin, nd.extent_of_damage,
                   sd.owner_name, sd.establishment_name, sd.caller_name,
                   nd.specific_type
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
            WHERE {where_sql}
            ORDER BY fi.created_at DESC
            LIMIT :limit OFFSET :offset
        """
        ),
        params,
    ).fetchall()

    total = (
        db.execute(
            text(
                f"""
            SELECT COUNT(*) FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
        """
            ),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        ).scalar()
        or 0
    )

    return {
        "items": [
            {
                "incident_id": r[0],
                "verification_status": r[1],
                "created_at": r[2].isoformat() if r[2] else None,
                "notification_dt": r[3].isoformat() if r[3] else None,
                "general_category": r[4],
                "alarm_level": r[5],
                "fire_station_name": r[6],
                "structures_affected": r[7],
                "households_affected": r[8],
                "individuals_affected": r[9],
                "responder_type": r[10],
                "fire_origin": r[11],
                "extent_of_damage": r[12],
                "owner_name": r[13],
                "establishment_name": r[14],
                "caller_name": r[15],
                "specific_type": r[16],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# -----------------------------------------------------------------------
# National Analyst — Incident List (p5a)
# -----------------------------------------------------------------------
ANALYST_LIST_SORT_COLUMNS = {
    "notification_dt",
    "region",
    "municipality_name",
    "general_category",
    "sub_category",
    "alarm_level",
    "estimated_damage_php",
    "total_response_time_minutes",
}


class AnalystIncidentExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    columns: list[str] = []
    incident_ids: Optional[list[int]] = None


def _append_analyst_casualty_filter(
    where_clauses: list[str],
    casualty_severity: str,
) -> None:
    casualty_columns = {
        "civilian_injured": "COALESCE(aif.civilian_injured, nd.civilian_injured, 0)",
        "civilian_deaths": "COALESCE(aif.civilian_deaths, nd.civilian_deaths, 0)",
        "firefighter_injured": "COALESCE(aif.firefighter_injured, nd.firefighter_injured, 0)",
        "firefighter_deaths": "COALESCE(aif.firefighter_deaths, nd.firefighter_deaths, 0)",
    }
    deaths = f"({casualty_columns['civilian_deaths']} + {casualty_columns['firefighter_deaths']})"
    injuries = (
        f"({casualty_columns['civilian_injured']} + {casualty_columns['firefighter_injured']})"
    )

    if casualty_severity == "high":
        where_clauses.append(f"{deaths} > 0")
    elif casualty_severity == "medium":
        where_clauses.append(f"{injuries} > 0 AND {deaths} = 0")
    elif casualty_severity == "low":
        where_clauses.append(f"{injuries} = 0 AND {deaths} = 0")


def _analyst_json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _analyst_row_dict(row: Any) -> dict[str, Any]:
    return {key: _analyst_json_value(value) for key, value in row._mapping.items()}


@router.post("/incidents/analyst/export/{export_format}")
def export_analyst_incidents(
    export_format: str,
    body: AnalystIncidentExportRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """Queue analyst incident export for selected IDs or the supplied filters."""
    if export_format not in {"csv", "pdf", "excel"}:
        raise HTTPException(status_code=422, detail="format must be csv, pdf, or excel")

    incident_ids = sorted(set(body.incident_ids or [])) or None
    result = export_analyst_incidents_task.delay(
        user_id=str(current_user["user_id"]),
        filters=body.filters,
        columns=body.columns,
        incident_ids=incident_ids,
        format=export_format,
    )
    return {"task_id": result.id}


@router.get("/incidents/analyst-list")
def get_analyst_incident_list(
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    region_id: Optional[int] = Query(None),
    province: Optional[str] = Query(None),
    municipality: Optional[str] = Query(None),
    incident_type: Optional[str] = Query(None),
    alarm_level: Optional[str] = Query(None),
    casualty_severity: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    damage_min: Optional[float] = Query(None, ge=0),
    damage_max: Optional[float] = Query(None, ge=0),
    incident_ids: Optional[str] = Query(None, description="Comma-separated incident IDs"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None, pattern="^(asc|desc)$"),
):
    """
    National Analyst incident list — verified incidents only.

    Requires: NATIONAL_ANALYST or SYSTEM_ADMIN.
    Always filters: verification_status = 'VERIFIED', is_archived = FALSE.
    """
    sort_by_col = sort_by if sort_by and sort_by in ANALYST_LIST_SORT_COLUMNS else "notification_dt"
    sort_dir_val = sort_dir if sort_dir in ("asc", "desc") else "desc"

    where_clauses = ["fi.verification_status = 'VERIFIED'", "fi.is_archived = FALSE"]
    params: dict[str, Any] = {}

    parsed_incident_ids: list[int] = []
    if incident_ids:
        try:
            parsed_incident_ids = [int(x.strip()) for x in incident_ids.split(",") if x.strip()]
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail="incident_ids must be comma-separated integers"
            ) from exc
    filters = build_analytics_filters(
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
        selected_incident_ids=parsed_incident_ids,
    )
    append_common_filters(
        where_clauses,
        params,
        filters,
        table_alias="fi",
        damage_expression="COALESCE(aif.estimated_damage_php, nd.estimated_damage_php, 0)",
        column_expressions={
            "notification_date": "nd.notification_dt",
            "region_id": "fi.region_id",
            "province_name": "aif.province_name",
            "municipality_name": "aif.municipality_name",
            "general_category": "nd.general_category",
            "alarm_level": "nd.alarm_level",
            "incident_id": "fi.incident_id",
            "civilian_injured": "COALESCE(aif.civilian_injured, nd.civilian_injured, 0)",
            "civilian_deaths": "COALESCE(aif.civilian_deaths, nd.civilian_deaths, 0)",
            "firefighter_injured": "COALESCE(aif.firefighter_injured, nd.firefighter_injured, 0)",
            "firefighter_deaths": "COALESCE(aif.firefighter_deaths, nd.firefighter_deaths, 0)",
        },
    )

    where_sql = " AND ".join(where_clauses)

    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    order_sql = f"ORDER BY {sort_by_col} {'ASC' if sort_dir_val == 'asc' else 'DESC'}"

    list_sql = f"""
        SELECT
            fi.incident_id,
            nd.notification_dt,
            COALESCE(aif.province_name, '')             AS province_name,
            COALESCE(aif.municipality_name, '')         AS municipality_name,
            COALESCE(nd.general_category, '')           AS general_category,
            COALESCE(nd.sub_category, '')              AS sub_category,
            COALESCE(nd.alarm_level, '')               AS alarm_level,
            COALESCE(aif.estimated_damage_php, nd.estimated_damage_php) AS estimated_damage_php,
            COALESCE(aif.total_response_time_minutes, nd.total_response_time_minutes) AS total_response_time_minutes,
            COALESCE(r.region_code, r.region_name, '') AS region,
            fi.verification_status,
            fi.reference_number,
            fi.created_at
        FROM wims.fire_incidents fi
        LEFT JOIN wims.incident_nonsensitive_details nd  ON nd.incident_id = fi.incident_id
        LEFT JOIN wims.analytics_incident_facts aif       ON aif.incident_id = fi.incident_id
        LEFT JOIN wims.ref_regions r                      ON r.region_id = fi.region_id
        WHERE {where_sql}
        {order_sql}
        LIMIT :limit OFFSET :offset
    """
    params["sort_by"] = sort_by_col
    params["sort_dir"] = sort_dir_val

    rows = db.execute(text(list_sql), params).fetchall()

    # Count
    count_sql = f"""
        SELECT COUNT(*)
        FROM wims.fire_incidents fi
        LEFT JOIN wims.incident_nonsensitive_details nd  ON nd.incident_id = fi.incident_id
        LEFT JOIN wims.analytics_incident_facts aif     ON aif.incident_id = fi.incident_id
        WHERE {where_sql}
    """
    total = (
        db.execute(
            text(count_sql),
            {
                k: v
                for k, v in params.items()
                if k not in ("limit", "offset", "sort_by", "sort_dir")
            },
        ).scalar()
        or 0
    )

    return {
        "incidents": [
            {
                "incident_id": r[0],
                "notification_dt": r[1].isoformat() if r[1] else None,
                "province_name": r[2],
                "municipality_name": r[3],
                "general_category": r[4],
                "sub_category": r[5],
                "alarm_level": r[6],
                "estimated_damage_php": float(r[7]) if r[7] is not None else None,
                "total_response_time_minutes": r[8],
                "region": r[9],
                "verification_status": r[10],
                "reference_number": r[11],
                "created_at": r[12].isoformat() if r[12] else None,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# -----------------------------------------------------------------------
# National Analyst — Incident Detail (p5e)
# -----------------------------------------------------------------------
@router.get("/incidents/analyst/{incident_id}")
def get_analyst_incident_detail(
    incident_id: int,
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    National Analyst detail for a single incident.

    Requires: NATIONAL_ANALYST or SYSTEM_ADMIN.
    Returns 404 if the incident is not VERIFIED or is archived.
    Includes provenance fields, full nonsensitive detail, form_kind, and inline wildland data.
    Sensitive fields (narrative, PII, disposition) are NOT included — use the /sensitive endpoint.
    """
    row = db.execute(
        text("""
            SELECT
                fi.incident_id,
                fi.reference_number,
                fi.encoder_id,
                fi.verification_status,
                fi.is_archived,
                fi.created_at,
                fi.data_hash,
                nd.notification_dt,
                COALESCE(r.region_code, r.region_name, '')  AS region,
                COALESCE(aif.province_name, '')              AS province_name,
                COALESCE(aif.municipality_name, '')          AS municipality_name,
                -- barangay_name intentionally omitted: barangay_id is never written by the encoder
                -- workflow; the JOIN would always return empty. Remove the JOIN if the schema
                -- column is ever purged. See system-wiki/log.md for tracking.
                COALESCE(nd.general_category, '')            AS general_category,
                COALESCE(nd.sub_category, '')               AS sub_category,
                COALESCE(nd.alarm_level, '')                 AS alarm_level,
                COALESCE(aif.estimated_damage_php, nd.estimated_damage_php) AS estimated_damage_php,
                COALESCE(aif.total_response_time_minutes, nd.total_response_time_minutes) AS total_response_time_minutes,
                CASE
                    WHEN (COALESCE(aif.civilian_deaths, nd.civilian_deaths, 0) + COALESCE(aif.firefighter_deaths, nd.firefighter_deaths, 0)) > 0 THEN 'high'
                    WHEN (COALESCE(aif.civilian_injured, nd.civilian_injured, 0) + COALESCE(aif.firefighter_injured, nd.firefighter_injured, 0)) > 0 THEN 'medium'
                    ELSE 'low'
                END AS casualty_severity,
                CASE WHEN aif.incident_id IS NULL THEN 'MISSING' ELSE 'SYNCED' END AS sync_status,
                -- form_kind via LEFT JOIN on incident_wildland_afor
                CASE WHEN w.incident_id IS NOT NULL THEN 'WILDLAND_AFOR' ELSE 'STRUCTURAL_AFOR' END AS form_kind,
                -- New structural fields from incident_nonsensitive_details
                nd.fire_origin,
                nd.extent_of_damage,
                nd.structures_affected,
                nd.households_affected,
                nd.individuals_affected,
                nd.vehicles_affected,
                nd.resources_deployed,
                nd.alarm_timeline,
                nd.problems_encountered,
                nd.stage_of_fire,
                nd.extent_total_floor_area_sqm,
                nd.extent_total_land_area_hectares,
                nd.water_tankers_used,
                nd.breathing_apparatus_used,
                nd.total_gas_consumed_liters,
                nd.families_affected,
                nd.responder_type,
                nd.fire_station_name,
                nd.distance_from_station_km
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd  ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.analytics_incident_facts aif       ON aif.incident_id = fi.incident_id
            LEFT JOIN wims.ref_regions r                      ON r.region_id = fi.region_id
            LEFT JOIN wims.incident_wildland_afor w           ON w.incident_id = fi.incident_id
            WHERE fi.incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Fail if not VERIFIED or is archived
    if row[4]:  # is_archived
        raise HTTPException(status_code=404, detail="Incident not found")
    if row[3] != "VERIFIED":  # verification_status
        raise HTTPException(status_code=404, detail="Incident not found")

    has_wildland_afor = row[18] == "WILDLAND_AFOR"  # form_kind column

    # Encoder username (from users table)
    encoder_username = None
    if row[2] is not None:
        encoder_row = db.execute(
            text("SELECT username FROM wims.users WHERE user_id = CAST(:uid AS uuid)"),
            {"uid": str(row[2])},
        ).fetchone()
        encoder_username = encoder_row[0] if encoder_row else None

    # Verify hash-chain integrity on read (#241)
    integrity_result = _verify_incident_hash_chain(db, incident_id, log_violations=True)

    # Assemble response
    result: dict[str, Any] = {
        "incident_id": row[0],
        "reference_number": row[1],
        "encoder_id": str(row[2]) if row[2] is not None else None,
        "encoder_username": encoder_username,
        "verification_status": row[3],
        "created_at": row[5].isoformat() if row[5] else None,
        "data_hash": row[6],
        "integrity_status": integrity_result["integrity_status"],
        "notification_dt": row[7].isoformat() if row[7] else None,
        "region": row[8],
        "province_name": row[9],
        "municipality_name": row[10],
        "general_category": row[11],
        "sub_category": row[12],
        "alarm_level": row[13],
        "estimated_damage_php": _analyst_json_value(row[14]),
        "total_response_time_minutes": row[15],
        "casualty_severity": row[16],
        "sync_status": row[17],
        "form_kind": row[18],
        "has_wildland_afor": has_wildland_afor,
        # New structural fields
        "fire_origin": row[19],
        "extent_of_damage": row[20],
        "structures_affected": row[21],
        "households_affected": row[22],
        "individuals_affected": row[23],
        "vehicles_affected": row[24],
        "resources_deployed": _analyst_json_value(row[25]),
        "alarm_timeline": _analyst_json_value(row[26]),
        "problems_encountered": _analyst_json_value(row[27]),
        "stage_of_fire": row[28],
        "extent_total_floor_area_sqm": _analyst_json_value(row[29]),
        "extent_total_land_area_hectares": _analyst_json_value(row[30]),
        "water_tankers_used": row[31],
        "breathing_apparatus_used": row[32],
        "total_gas_consumed_liters": _analyst_json_value(row[33]),
        "families_affected": row[34],
        "responder_type": row[35],
        "fire_station_name": row[36],
        "distance_from_station_km": _analyst_json_value(row[37]),
    }

    # Inline wildland data if present
    if has_wildland_afor:
        wildland_row = db.execute(
            text("SELECT * FROM wims.incident_wildland_afor WHERE incident_id = :iid"),
            {"iid": incident_id},
        ).fetchone()
        if wildland_row:
            wildland_id = wildland_row._mapping["incident_wildland_afor_id"]
            alarm_rows = db.execute(
                text("""
                    SELECT sort_order, alarm_status, time_declared, ground_commander
                    FROM wims.wildland_afor_alarm_statuses
                    WHERE incident_wildland_afor_id = :wid
                    ORDER BY sort_order, wildland_afor_alarm_status_id
                """),
                {"wid": wildland_id},
            ).fetchall()
            assistance_rows = db.execute(
                text("""
                    SELECT sort_order, organization_or_unit, detail
                    FROM wims.wildland_afor_assistance_rows
                    WHERE incident_wildland_afor_id = :wid
                    ORDER BY sort_order, wildland_afor_assistance_row_id
                """),
                {"wid": wildland_id},
            ).fetchall()
            result["wildland"] = _analyst_row_dict(wildland_row)
            result["alarm_statuses"] = [_analyst_row_dict(r) for r in alarm_rows]
            result["assistance_rows"] = [_analyst_row_dict(r) for r in assistance_rows]

    return result


@router.get("/incidents/analyst/{incident_id}/sensitive")
def get_analyst_incident_sensitive_detail(
    incident_id: int,
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    National Analyst — sensitive / PII fields for a single incident.

    Requires: NATIONAL_ANALYST or SYSTEM_ADMIN.
    Returns 404 if the incident does not exist or is not VERIFIED.
    """
    incident_row = db.execute(
        text("""
            SELECT incident_id, reference_number, verification_status, is_archived
            FROM wims.fire_incidents
            WHERE incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    if not incident_row or incident_row[2] != "VERIFIED" or bool(incident_row[3]):
        raise HTTPException(status_code=404, detail="Incident not found")

    sd_row = db.execute(
        text("""
            SELECT
                sd.incident_id,
                nd.fire_origin,
                nd.extent_of_damage,
                sd.narrative_report,
                sd.disposition_prepared_by AS prepared_by_officer,
                sd.disposition_noted_by    AS noted_by_officer,
                sd.disposition,
                sd.caller_name,
                sd.caller_number,
                sd.owner_name,
                sd.establishment_name,
                sd.occupant_name,
                nd.alarm_timeline
            FROM wims.incident_sensitive_details sd
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = sd.incident_id
            WHERE sd.incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    return {
        "incident_id": incident_row[0],
        "fire_origin": sd_row[1] if sd_row else None,
        "extent_of_damage": sd_row[2] if sd_row else None,
        "narrative_report": sd_row[3] if sd_row else None,
        "prepared_by_officer": sd_row[4] if sd_row else None,
        "noted_by_officer": sd_row[5] if sd_row else None,
        "disposition": sd_row[6] if sd_row else None,
        "caller_name": sd_row[7] if sd_row else None,
        "caller_number": sd_row[8] if sd_row else None,
        "owner_name": sd_row[9] if sd_row else None,
        "establishment_name": sd_row[10] if sd_row else None,
        "occupant_name": sd_row[11] if sd_row else None,
        "alarm_timeline": _analyst_json_value(sd_row[12])
        if sd_row and sd_row[12] is not None
        else [],
    }


@router.get("/incidents/analyst/{incident_id}/wildland")
def get_analyst_incident_wildland_detail(
    incident_id: int,
    _user: Annotated[dict, Depends(get_analyst_or_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    National Analyst wildland AFOR detail for a verified, non-archived incident.

    Requires: NATIONAL_ANALYST or SYSTEM_ADMIN.
    """
    incident_row = db.execute(
        text("""
            SELECT incident_id, reference_number, verification_status, is_archived
            FROM wims.fire_incidents
            WHERE incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    if not incident_row or incident_row[2] != "VERIFIED" or bool(incident_row[3]):
        raise HTTPException(status_code=404, detail="Incident not found")

    wildland_row = db.execute(
        text("""
            SELECT *
            FROM wims.incident_wildland_afor
            WHERE incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    if not wildland_row:
        raise HTTPException(status_code=404, detail="Wildland AFOR not found")

    wildland_id = wildland_row._mapping["incident_wildland_afor_id"]
    alarm_rows = db.execute(
        text("""
            SELECT sort_order, alarm_status, time_declared, ground_commander
            FROM wims.wildland_afor_alarm_statuses
            WHERE incident_wildland_afor_id = :wildland_id
            ORDER BY sort_order, wildland_afor_alarm_status_id
        """),
        {"wildland_id": wildland_id},
    ).fetchall()
    assistance_rows = db.execute(
        text("""
            SELECT sort_order, organization_or_unit, detail
            FROM wims.wildland_afor_assistance_rows
            WHERE incident_wildland_afor_id = :wildland_id
            ORDER BY sort_order, wildland_afor_assistance_row_id
        """),
        {"wildland_id": wildland_id},
    ).fetchall()

    return {
        "incident_id": incident_row[0],
        "reference_number": incident_row[1],
        "wildland": _analyst_row_dict(wildland_row),
        "alarm_statuses": [_analyst_row_dict(row) for row in alarm_rows],
        "assistance_rows": [_analyst_row_dict(row) for row in assistance_rows],
    }
