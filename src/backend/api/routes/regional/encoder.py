"""Regional Office API — encoder read/lookup routes."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user, get_regional_encoder
from auth import get_db_with_rls
from services.kms import get_crypto_provider
from services.regional_incidents.helpers import (
    _CATEGORY_DB_VARIANTS,
    _ivh_has_column as _incident_verification_history_has_column,
    _ivh_uses_target_columns as _incident_verification_history_uses_target_columns,
    verify_incident_hash_chain as _verify_incident_hash_chain,
)
from utils.crypto import SecurityProviderError

logger = logging.getLogger("wims.regional")
router = APIRouter()


@router.get("/incidents")
def get_regional_incidents(
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    category: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_basis: Optional[str] = "modified",
    archived: bool = Query(default=False),
):
    """
    Fetch fire incidents owned by the current encoder.
    Encoders can only list their own incidents — same-encoder OCC conflict
    detection handles two-tab editing scenarios.
    Joins nonsensitive details for summary view.
    Pass archived=true to list archived incidents instead of active ones.
    """
    encoder_id = user["user_id"]

    where_clauses = [
        "fi.encoder_id = CAST(:encoder_id AS uuid)",
        "fi.is_archived = TRUE" if archived else "fi.is_archived = FALSE",
        """
        NOT (
            COALESCE(fi.reference_number, '') LIKE 'AFOR-SEED-%'
            OR EXISTS (
                SELECT 1
                FROM wims.data_import_batches dib
                WHERE dib.batch_id = fi.import_batch_id
                  AND (
                    dib.sync_status = 'SEEDED'
                    OR COALESCE(dib.batch_checksum_hash, '') LIKE 'seed-incidents-%'
                  )
            )
        )
        """,
    ]
    params: dict[str, Any] = {
        "encoder_id": str(encoder_id),
        "limit": limit,
        "offset": offset,
    }

    if category:
        cat_key = category.strip().upper().replace("-", "_").replace(" ", "_")
        if cat_key == "VEHICULAR":
            cat_key = "TRANSPORTATION"
        variants = _CATEGORY_DB_VARIANTS.get(cat_key, [category])
        where_clauses.append("nd.general_category = ANY(:categories)")
        params["categories"] = variants
    if status:
        where_clauses.append("fi.verification_status = :status")
        params["status"] = status
    basis = (date_basis or "modified").strip().lower()
    if basis not in {"modified", "fire"}:
        raise HTTPException(status_code=422, detail="date_basis must be 'modified' or 'fire'")
    date_expr = (
        "COALESCE(nd.notification_dt, fi.created_at)"
        if basis == "fire"
        else "COALESCE(fi.updated_at, fi.created_at)"
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

    rows = db.execute(
        text(f"""
            SELECT fi.incident_id, fi.verification_status, fi.created_at,
                   nd.notification_dt, nd.general_category, nd.alarm_level,
                   nd.fire_station_name, nd.structures_affected,
                   nd.households_affected, nd.families_affected,
                   nd.individuals_affected, nd.vehicles_affected,
                   nd.responder_type, nd.fire_origin, nd.extent_of_damage,
                   nd.sub_category,
                   sd.owner_name, sd.establishment_name, sd.caller_name,
                   sd.caller_number, sd.street_address, sd.pii_blob_enc, sd.encryption_iv,
                   CASE WHEN iwa.incident_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_wildland,
                   fi.updated_at,
                   nd.city_municipality, nd.province_district, rr.region_name
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
            LEFT JOIN wims.incident_wildland_afor iwa ON iwa.incident_id = fi.incident_id
            LEFT JOIN wims.ref_regions rr ON rr.region_id = fi.region_id
            WHERE {where_sql}
            ORDER BY fi.updated_at DESC NULLS LAST, fi.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    total = (
        db.execute(
            text(f"""
            SELECT COUNT(*) FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
        """),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        ).scalar()
        or 0
    )

    def _location_display(city: str | None, province: str | None, region: str | None) -> str | None:
        # Show "Province • City" — region is implied by dashboard context
        parts = [p for p in (province, city) if p]
        return " • ".join(parts) if parts else None

    items = []
    sp = None  # lazy-load once per request only if needed
    for r in rows:
        owner_name = r[16]
        caller_name = r[18]
        caller_number = r[19]
        has_sensitive_data = bool(r[21])

        if has_sensitive_data:
            try:
                if sp is None:
                    sp = (
                        get_crypto_provider()
                    )  # env dispatch — list endpoint lacks per-row crypto_provider
                aad = f"incident_id:{r[0]}".encode("utf-8")
                pii = sp.decrypt_json(r[22], r[21], aad)
                owner_name = pii.get("owner_name") or owner_name
                caller_name = pii.get("caller_name") or caller_name
                caller_number = pii.get("caller_number") or caller_number
            except (SecurityProviderError, Exception):
                logger.error(
                    "CRITICAL: PII blob decryption failed in incident list. incident_id=%s", r[0]
                )

        items.append(
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
                "families_affected": r[9],
                "individuals_affected": r[10],
                "vehicles_affected": r[11],
                "responder_type": r[12],
                "fire_origin": r[13],
                "extent_of_damage": r[14],
                "sub_category": r[15],
                "owner_name": owner_name,
                "establishment_name": r[17],
                "caller_name": caller_name,
                "caller_number": caller_number,
                "street_address": r[20],
                "is_wildland": bool(r[23]),
                "updated_at": r[24].isoformat() if r[24] else None,
                "city_municipality": r[25],
                "province_district": r[26],
                "location_display": _location_display(r[25], r[26], r[27]),
                "has_sensitive_data": has_sensitive_data,
            }
        )

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/incidents/drafts")
def list_encoder_drafts(
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """List the current encoder's DRAFT incidents (most-recently-updated first)."""
    encoder_id = user["user_id"]
    rows = db.execute(
        text(
            """
            SELECT
                fi.incident_id, fi.region_id, fi.created_at, fi.updated_at,
                nd.notification_dt, nd.general_category, nd.alarm_level,
                nd.fire_station_name
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                   ON nd.incident_id = fi.incident_id
            WHERE fi.encoder_id = CAST(:eid AS uuid)
              AND fi.verification_status = 'DRAFT'
              AND fi.is_archived = FALSE
            ORDER BY fi.updated_at DESC NULLS LAST, fi.created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"eid": str(encoder_id), "limit": limit, "offset": offset},
    ).fetchall()
    total = (
        db.execute(
            text(
                """
            SELECT COUNT(*) FROM wims.fire_incidents
            WHERE encoder_id = CAST(:eid AS uuid)
              AND verification_status = 'DRAFT'
              AND is_archived = FALSE
            """
            ),
            {"eid": str(encoder_id)},
        ).scalar()
        or 0
    )
    return {
        "items": [
            {
                "incident_id": r[0],
                "region_id": r[1],
                "created_at": r[2].isoformat() if r[2] else None,
                "updated_at": r[3].isoformat() if r[3] else None,
                "notification_dt": r[4].isoformat() if r[4] else None,
                "general_category": r[5],
                "alarm_level": r[6],
                "fire_station_name": r[7],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/incidents/{incident_id}")
def get_regional_incident_detail(
    incident_id: int,
    user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Fetch a single incident detail. Encoders see only their own; validators see any."""
    role = user.get("role", "")
    is_validator = role in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN", "NATIONAL_ANALYST")

    if is_validator:
        row = db.execute(
            text("""
                SELECT fi.incident_id, fi.verification_status, fi.created_at,
                       fi.region_id, fi.encoder_id,
                       ST_Y(fi.location::geometry) AS latitude,
                       ST_X(fi.location::geometry) AS longitude,
                       fi.reference_number, fi.incident_type_code,
                       fi.parent_incident_id,
                       fi.is_duplicate, fi.duplicate_of, fi.updated_at,
                       fi.is_archived
                FROM wims.fire_incidents fi
                WHERE fi.incident_id = :iid
            """),
            {"iid": incident_id},
        ).fetchone()
    else:
        encoder_id = user["user_id"]
        row = db.execute(
            text("""
                SELECT fi.incident_id, fi.verification_status, fi.created_at,
                       fi.region_id, fi.encoder_id,
                       ST_Y(fi.location::geometry) AS latitude,
                       ST_X(fi.location::geometry) AS longitude,
                       fi.reference_number, fi.incident_type_code,
                       fi.parent_incident_id,
                       fi.is_duplicate, fi.duplicate_of, fi.updated_at,
                       fi.is_archived
                FROM wims.fire_incidents fi
                WHERE fi.incident_id = :iid
                  AND fi.encoder_id = CAST(:encoder_id AS uuid)
            """),
            {"iid": incident_id, "encoder_id": str(encoder_id)},
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found or access denied")

    # Fetch nonsensitive
    ns = db.execute(
        text("SELECT * FROM wims.incident_nonsensitive_details WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()

    loc_row = db.execute(
        text("""
            SELECT c.city_name, p.province_name
            FROM wims.incident_nonsensitive_details nd
            LEFT JOIN wims.ref_cities c ON c.city_id = nd.city_id
            LEFT JOIN wims.ref_provinces p ON p.province_id = c.province_id
            WHERE nd.incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    # Fetch sensitive
    sd_row = db.execute(
        text("SELECT * FROM wims.incident_sensitive_details WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()

    def row_to_dict(r, keys=None):
        if r is None:
            return {}
        if keys:
            return {k: r[i] for i, k in enumerate(keys)}
        return dict(r._mapping) if hasattr(r, "_mapping") else {}

    sd_dict = row_to_dict(sd_row)

    # ── Decrypt PII blob if present (dual-read: env_aesgcm or openbao_transit) ──
    pii_plaintext: dict = {}
    if sd_dict.get("pii_blob_enc"):
        try:
            aad = f"incident_id:{incident_id}".encode("utf-8")
            provider = get_crypto_provider(sd_dict)
            enc_iv = sd_dict.get("encryption_iv")
            pii_plaintext = provider.decrypt_json(
                enc_iv if enc_iv else None,
                sd_dict["pii_blob_enc"],
                aad,
            )
            # Inject decrypted PII/narrative/casualty/damage fields so frontend contract is unchanged
            sd_dict["caller_name"] = pii_plaintext.get("caller_name")
            sd_dict["caller_number"] = pii_plaintext.get("caller_number")
            sd_dict["owner_name"] = pii_plaintext.get("owner_name")
            sd_dict["occupant_name"] = pii_plaintext.get("occupant_name")
            sd_dict["narrative_report"] = pii_plaintext.get("narrative_report")
            sd_dict["casualty_details"] = pii_plaintext.get("casualty_details")
        except (SecurityProviderError, Exception):
            # Auth/key failure on a blob that claims to be valid — possible tampering
            # or key rotation without re-encrypt. Log with incident_id; never log
            # nonce, ciphertext, or plaintext. Return legacy plaintext as fallback.
            logger.error(
                "CRITICAL: PII blob decryption failed (possible tamper or key mismatch). "
                "incident_id=%s",
                incident_id,
            )

    # Do not expose internal blob columns in API response
    sd_dict.pop("pii_blob_enc", None)
    sd_dict.pop("encryption_iv", None)
    sd_dict.pop("crypto_provider", None)
    sd_dict.pop("kms_key_name", None)

    nonsensitive = row_to_dict(ns)
    # Inject estimated_damage_php from encrypted blob if available
    # (AFOR commits store it in the blob; manual edits may still use the plaintext column)
    if (
        "estimated_damage_php" in pii_plaintext
        and pii_plaintext.get("estimated_damage_php") is not None
    ):
        nonsensitive["estimated_damage_php"] = pii_plaintext["estimated_damage_php"]
    # Prefer the stored text columns; fall back to the ref-table JOIN for old rows
    if loc_row:
        if not nonsensitive.get("city_municipality") and loc_row[0]:
            nonsensitive["city_municipality"] = loc_row[0]
        if not nonsensitive.get("province_district") and loc_row[1]:
            nonsensitive["province_district"] = loc_row[1]
    nonsensitive["_city_text"] = nonsensitive.get("city_municipality") or ""
    nonsensitive["_province_text"] = nonsensitive.get("province_district") or ""

    # Fetch the most recent rejection reason with compatibility across IVH schemas.
    ivh_has_notes = _incident_verification_history_has_column(db, "notes")
    ivh_has_comments = _incident_verification_history_has_column(db, "comments")
    ivh_has_action_timestamp = _incident_verification_history_has_column(db, "action_timestamp")
    ivh_has_created_at = _incident_verification_history_has_column(db, "created_at")
    ivh_uses_target_columns = _incident_verification_history_uses_target_columns(db)

    rejection_reason = None
    rejection_at = None

    if (ivh_has_notes or ivh_has_comments) and (ivh_has_action_timestamp or ivh_has_created_at):
        notes_column = "notes" if ivh_has_notes else "comments"
        timestamp_column = "action_timestamp" if ivh_has_action_timestamp else "created_at"
        incident_filter = (
            "target_type = 'OFFICIAL' AND target_id = :iid"
            if ivh_uses_target_columns
            else "incident_id = :iid"
        )
        rejection_row = db.execute(
            text(f"""
                SELECT {notes_column}, {timestamp_column}
                FROM wims.incident_verification_history
                WHERE {incident_filter}
                  AND new_status = 'REJECTED'
                ORDER BY {timestamp_column} DESC
                LIMIT 1
            """),
            {"iid": incident_id},
        ).fetchone()
        rejection_reason = rejection_row[0] if rejection_row else None
        rejection_at = rejection_row[1].isoformat() if rejection_row and rejection_row[1] else None
    else:
        logger.warning(
            "IVH schema missing notes/comments or timestamp columns; skipping rejection history lookup."
        )

    # Check if incident has a wildland AFOR record (separate form from structural AFOR)
    wildland_row = db.execute(
        text("""
            SELECT wildland_fire_type, total_area_burned_hectares, total_area_burned_display
            FROM wims.incident_wildland_afor
            WHERE incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()
    is_wildland = wildland_row is not None
    wildland_fire_type = wildland_row[0] if wildland_row else None
    wildland_area_hectares = (
        float(wildland_row[1]) if wildland_row and wildland_row[1] is not None else None
    )
    wildland_area_display = wildland_row[2] if wildland_row else None

    # Verify hash-chain integrity on read (#241)
    integrity_result = _verify_incident_hash_chain(db, incident_id, log_violations=True)

    return {
        "incident_id": row[0],
        "verification_status": row[1],
        "created_at": row[2].isoformat() if row[2] else None,
        "region_id": row[3],
        "latitude": float(row[5]) if row[5] is not None else None,
        "longitude": float(row[6]) if row[6] is not None else None,
        "reference_number": row[7],
        "incident_type_code": row[8],
        "parent_incident_id": row[9],
        "is_duplicate": bool(row[10]) if row[10] is not None else False,
        "duplicate_of": row[11],
        "updated_at": row[12].isoformat() if row[12] else None,
        "is_archived": bool(row[13]) if row[13] is not None else False,
        "is_wildland": is_wildland,
        "wildland_fire_type": wildland_fire_type,
        "wildland_area_hectares": wildland_area_hectares,
        "wildland_area_display": wildland_area_display,
        "integrity_status": integrity_result["integrity_status"],
        "nonsensitive": nonsensitive,
        "sensitive": sd_dict,
        "rejection_reason": rejection_reason,
        "rejection_at": rejection_at,
    }


@router.get("/audit-log")
def get_encoder_audit_log(
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    action: Optional[str] = None,
    city_municipality: Optional[str] = None,
    limit: int = Query(default=15, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Return the current encoder's own action history from incident_verification_history."""
    encoder_id = str(user["user_id"])
    where_clauses = [
        "ivh.target_type = 'OFFICIAL'",
        "ivh.action_by_user_id = CAST(:encoder_id AS uuid)",
    ]
    params: dict[str, Any] = {"encoder_id": encoder_id}
    if date_from:
        where_clauses.append("ivh.action_timestamp >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("ivh.action_timestamp <= CAST(:date_to AS timestamptz)")
        params["date_to"] = date_to
    if action:
        where_clauses.append("ivh.action_label = :action")
        params["action"] = action
    if city_municipality:
        where_clauses.append("nd.city_municipality ILIKE :city_municipality")
        params["city_municipality"] = f"%{city_municipality}%"
    where_sql = " AND ".join(where_clauses)

    need_nd_join = bool(city_municipality)
    nd_join = (
        "LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = ivh.target_id"
        if need_nd_join
        else ""
    )

    rows = db.execute(
        text(
            f"""
            SELECT
                ivh.history_id, ivh.target_id,
                ivh.action_label, ivh.previous_status, ivh.new_status,
                ivh.notes, ivh.action_timestamp
            FROM wims.incident_verification_history ivh
            {nd_join}
            WHERE {where_sql}
            ORDER BY ivh.action_timestamp DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {**params, "limit": limit, "offset": offset},
    ).fetchall()

    total = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM wims.incident_verification_history ivh
                {nd_join}
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
                "action_label": r[2],
                "previous_status": r[3],
                "new_status": r[4],
                "notes": r[5],
                "action_timestamp": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
