"""Regional Office API — AFOR Import, Regional Incidents, Stats.

Route handlers are grouped in sub-modules; this file registers them all
under the /api/regional prefix.
"""

from __future__ import annotations

import asyncio
import hashlib
import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user, get_national_validator, get_regional_encoder
from database import get_db_with_rls
from services.event_bus import publish_incident_event, publish_incident_event_sync
from services.afor_import import (
    ALARM_LEVEL_MAP,
    AforCommitRequest,
    AforCommitResponse,
    AforParseResponse,
    parse_csv_content,
    parse_xlsx_content,
)
from services.afor_import.commit import (
    AforCommitDependencies,
    commit_afor_import_command,
)
from services.regional_incidents import (
    RegionalIncidentLifecycleDependencies,
    VALIDATOR_DEFAULT_QUEUE_STATUSES,
    archive_finalized_incident,
    bulk_approve_pending_incidents,
    delete_encoder_incident,
    force_replace_pending_incident,
    submit_incident_for_review_command,
    unarchive_finalized_incident,
    unpend_incident_command,
    verify_incident_command,
)
from services.analytics_read_model import (
    sync_incident_to_analytics,
)
from utils.crypto import SecurityProvider, SecurityProviderError
from utils.audit import log_system_audit

# ── Schemas extracted to schemas/regional.py ─────────────────────────────────
from schemas.regional import (
    RegionalStatsResponse,
    IncidentCreateRequest,
    IncidentUpdateRequest,
    VerificationActionRequest,
    CorrectionRequest,
    BulkApproveRequest,
)

# ── Helpers extracted to services/regional_incidents/helpers.py ──────────────
from services.regional_incidents.helpers import (
    get_security_provider as _get_security_provider_from_helpers,
    decrypt_pii_blob as _decrypt_pii_blob,
    normalize_general_category as _normalize_general_category,
    region_text_matches as _region_text_matches,
    generate_reference_number as _generate_reference_number,
    insert_incident_verification_history as _insert_incident_verification_history,
    build_audit_log_query as _build_audit_log_query,
    _CATEGORY_DB_VARIANTS,
    _ivh_has_column as _incident_verification_history_has_column,
    _ivh_uses_target_columns as _incident_verification_history_uses_target_columns,
)


def _get_security_provider() -> SecurityProvider:
    return _get_security_provider_from_helpers()


logger = logging.getLogger("wims.regional")

# Module-level cache: True once we confirm the column exists, False if missing.
# Resets to None only on process restart; migration apply requires restart anyway.
_fi_resubmitted_col_exists: bool | None = None


def _fi_has_resubmitted_column(db: Session) -> bool:
    global _fi_resubmitted_col_exists  # noqa: PLW0603
    if _fi_resubmitted_col_exists is None:
        result = db.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema = 'wims' AND table_name = 'fire_incidents' AND column_name = 'is_resubmitted'"
            )
        ).scalar()
        _fi_resubmitted_col_exists = bool(result)
    return _fi_resubmitted_col_exists


router = APIRouter(prefix="/api/regional", tags=["regional"])


def _regional_lifecycle_dependencies() -> RegionalIncidentLifecycleDependencies:
    return RegionalIncidentLifecycleDependencies(
        insert_incident_verification_history=_insert_incident_verification_history,
        apply_incident_field_updates=_apply_incident_field_updates,
        generate_reference_number=_generate_reference_number,
    )


def _incident_verification_history_has_hash_columns(db: Session) -> bool:
    """Return True when IVH table has columns needed for correction hash chaining."""
    from services.regional_incidents.helpers import ivh_has_hash_columns

    return ivh_has_hash_columns(db)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/afor/import", response_model=AforParseResponse)
async def import_afor_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_regional_encoder),
    db: Session = Depends(get_db_with_rls),
):
    """
    Upload and parse an AFOR file (.xlsx or .csv).
    Returns parsed rows with validation status for preview before commit.
    """
    region_id = user["assigned_region_id"]

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("xlsx",):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        if ext == "csv":
            decoded = content.decode("utf-8-sig")  # Handle BOM
            rows, form_kind = parse_csv_content(decoded, region_id)
        else:
            rows, form_kind = parse_xlsx_content(content, region_id)
    except ValueError as e:
        logger.warning("AFOR type detection failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Failed to parse AFOR file")
        raise HTTPException(status_code=400, detail="Failed to parse file")

    if len(rows) == 0:
        raise HTTPException(status_code=400, detail="No data rows found in file")

    # Region mismatch check: if the XLSX specifies a region, it must match the encoder's assigned region.
    if form_kind == "STRUCTURAL_AFOR":
        first_valid = next((r for r in rows if r.status == "VALID"), None)
        xlsx_region_text = (
            (first_valid.data.get("_region_text") or "") if first_valid else ""
        ).strip()
        if xlsx_region_text:
            encoder_region_row = db.execute(
                text("SELECT region_name FROM wims.ref_regions WHERE region_id = :rid"),
                {"rid": region_id},
            ).fetchone()
            if encoder_region_row:
                if not _region_text_matches(encoder_region_row[0], xlsx_region_text):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Region mismatch: this AFOR is for '{xlsx_region_text}', "
                            f"but you are assigned to '{encoder_region_row[0]}'. "
                            "You can only import AFORs within your assigned region."
                        ),
                    )

    valid_count = sum(1 for r in rows if r.status == "VALID")

    return AforParseResponse(
        total_rows=len(rows),
        valid_rows=valid_count,
        invalid_rows=len(rows) - valid_count,
        rows=rows,
        form_kind=form_kind,
    )


@router.post("/afor/commit")
async def commit_afor_import(
    request: Request,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Commit validated AFOR rows through the AFOR import command module."""
    try:
        raw_body: dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from None

    body = AforCommitRequest.model_validate(raw_body)
    result = commit_afor_import_command(
        db,
        user,
        body,
        raw_body,
        AforCommitDependencies(
            insert_incident_verification_history=_insert_incident_verification_history,
            get_security_provider=_get_security_provider,
        ),
    )
    if result.get("status") == "DUPLICATE_CHECK_REQUIRED":
        return result
    return AforCommitResponse.model_validate(result)


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
    Fetch fire incidents scoped to the current encoder.
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
    for r in rows:
        owner_name = r[16]
        caller_name = r[18]
        caller_number = r[19]
        if r[21] and r[22]:
            pii_plaintext = _decrypt_pii_blob(r[22], r[21], r[0])
            owner_name = pii_plaintext.get("owner_name") or owner_name
            caller_name = pii_plaintext.get("caller_name") or caller_name
            caller_number = pii_plaintext.get("caller_number") or caller_number

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
            }
        )

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# M4-E: Dedicated Draft Management Endpoints
#
# IMPORTANT: These routes must be registered BEFORE /incidents/{incident_id}
# so that "drafts" / "draft/{id}" are not matched as the {incident_id} param.
# ---------------------------------------------------------------------------


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


@router.get("/incidents/check-duplicate")
def check_incident_duplicate(
    region_id: int,
    fire_date: str,
    incident_type_code: Optional[str] = None,
    general_category: Optional[str] = None,
    user: Annotated[dict, Depends(get_regional_encoder)] = None,
    db: Annotated[Session, Depends(get_db_with_rls)] = None,
):
    """Return existing non-archived incidents that could be duplicates.

    Detection criteria (OR logic — any match triggers a warning):
      1. Same region + type_code + same calendar month + year (reference number space collision)
      2. Same region + type_code + exact fire date
      3. Same region + general_category + exact fire date (when no type_code available)
    """
    try:
        fire_dt = datetime.fromisoformat(str(fire_date))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="fire_date must be a valid YYYY-MM-DD date")

    fire_month = fire_dt.month
    fire_year = fire_dt.year

    # Build WHERE conditions with explicit Python-side checks to avoid NULL pitfalls
    where_conditions = [
        "fi.region_id = :rid",
        "fi.is_archived = FALSE",
        "fi.verification_status = 'VERIFIED'",
    ]

    # Build OR sub-conditions
    or_parts: list[str] = []
    params: dict[str, Any] = {
        "rid": region_id,
        "fire_date": fire_date,
        "fire_month": fire_month,
        "fire_year": fire_year,
    }

    if incident_type_code:
        params["type_code"] = incident_type_code
        # Same reference number space (same type + same month + year)
        or_parts.append(
            "(fi.incident_type_code = :type_code"
            " AND EXTRACT(MONTH FROM nd.notification_dt AT TIME ZONE 'Asia/Manila') = :fire_month"
            " AND EXTRACT(YEAR FROM nd.notification_dt AT TIME ZONE 'Asia/Manila') = :fire_year)"
        )
        # Exact date + type (catches same day, different month edge case from above)
        or_parts.append(
            "(fi.incident_type_code = :type_code"
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') = CAST(:fire_date AS DATE))"
        )

    if general_category:
        params["general_category"] = general_category
        # Same category + exact date (fallback when no type code)
        or_parts.append(
            "(nd.general_category = :general_category"
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') = CAST(:fire_date AS DATE))"
        )

    if not or_parts:
        # Nothing to match on — can't run a useful check
        return {"duplicates": []}

    where_conditions.append(f"({' OR '.join(or_parts)})")
    where_sql = " AND ".join(where_conditions)

    rows = db.execute(
        text(f"""
            SELECT
                fi.incident_id,
                fi.reference_number,
                fi.verification_status,
                fi.incident_type_code,
                nd.notification_dt,
                nd.alarm_level,
                nd.general_category,
                nd.sub_category,
                nd.fire_station_name,
                c.city_name,
                p.province_name,
                rr.region_name,
                sd.street_address
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.ref_cities c ON c.city_id = nd.city_id
            LEFT JOIN wims.ref_provinces p ON p.province_id = c.province_id
            LEFT JOIN wims.ref_regions rr ON rr.region_id = fi.region_id
            LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
            WHERE {where_sql}
            ORDER BY
                fi.verification_status DESC,  -- VERIFIED first, then PENDING
                fi.created_at DESC
            LIMIT 10
        """),
        params,
    ).fetchall()

    return {
        "duplicates": [
            {
                "incident_id": r[0],
                "reference_number": r[1],
                "verification_status": r[2],
                "incident_type_code": r[3],
                "notification_dt": str(r[4]) if r[4] else None,
                "alarm_level": r[5],
                "general_category": r[6],
                "type_of_involved": r[7],
                "fire_station_name": r[8],
                "city_municipality": r[9],
                "province_district": r[10],
                "region_name": r[11],
                "street_address": r[12],
            }
            for r in rows
        ]
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

    # ── Decrypt PII blob if present (new writes use encrypted blob; old rows fall back) ──
    pii_plaintext: dict = {}
    if sd_dict.get("pii_blob_enc") and sd_dict.get("encryption_iv"):
        try:
            aad = f"incident_id:{incident_id}".encode("utf-8")
            pii_plaintext = _get_security_provider().decrypt_json(
                sd_dict["encryption_iv"],
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
        except SecurityProviderError:
            # Auth/key failure on a blob that claims to be valid — possible tampering
            # or key rotation without re-encrypt. Log with incident_id; never log
            # nonce, ciphertext, or plaintext. Return legacy plaintext as fallback.
            logger.error(
                "CRITICAL: PII blob decryption failed (possible tamper or key mismatch). "
                "incident_id=%s",
                incident_id,
            )
            pass

    # Do not expose internal blob columns in API response
    sd_dict.pop("pii_blob_enc", None)
    sd_dict.pop("encryption_iv", None)

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
        "nonsensitive": nonsensitive,
        "sensitive": sd_dict,
        "rejection_reason": rejection_reason,
        "rejection_at": rejection_at,
    }


@router.get("/validator/stats")
def get_validator_stats(
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
):
    """Counts of verified incidents for validator dashboard cards — all regions, filterable by fire date."""
    # ── Date filter on fire date (notification_dt, Asia/Manila TZ) ────────────
    date_params: dict = {}
    date_clause = ""
    if date_from:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') >= CAST(:date_from AS date)"
        )
        date_params["date_from"] = date_from
    if date_to:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') <= CAST(:date_to AS date)"
        )
        date_params["date_to"] = date_to

    by_cat_rows = db.execute(
        text(
            f"""
            SELECT nd.general_category, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
              {date_clause}
            GROUP BY nd.general_category
            ORDER BY cnt DESC
            """
        ),
        date_params,
    ).fetchall()

    # Pending count is always current (not date-filtered)
    pending_count = (
        db.execute(
            text("""
            SELECT COUNT(*) FROM wims.fire_incidents
            WHERE verification_status IN ('PENDING', 'PENDING_VALIDATION') AND is_archived = FALSE
            """),
        ).scalar()
        or 0
    )

    wildland_total = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM wims.incident_wildland_afor iwa
                JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
                  {date_clause}
                """
            ),
            date_params,
        ).scalar()
        or 0
    )

    affected_row = db.execute(
        text(
            f"""
            SELECT
                COALESCE(SUM(nd.structures_affected), 0),
                COALESCE(SUM(nd.households_affected), 0),
                COALESCE(SUM(nd.families_affected), 0),
                COALESCE(SUM(nd.individuals_affected), 0),
                COALESCE(SUM(nd.vehicles_affected), 0)
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
              {date_clause}
            """
        ),
        date_params,
    ).fetchone()

    total_verified = sum(r[1] for r in by_cat_rows)
    return {
        "total_verified": total_verified,
        "pending_validation": pending_count,
        "wildland_total": wildland_total,
        "by_category": [{"category": r[0], "count": r[1]} for r in by_cat_rows],
        "structures_affected": int(affected_row[0]) if affected_row else 0,
        "households_affected": int(affected_row[1]) if affected_row else 0,
        "families_affected": int(affected_row[2]) if affected_row else 0,
        "individuals_affected": int(affected_row[3]) if affected_row else 0,
        "vehicles_affected": int(affected_row[4]) if affected_row else 0,
    }


@router.get("/stats", response_model=RegionalStatsResponse)
def get_regional_stats(
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
):
    """Summary stats for the encoder's region — verified incidents only, filterable by fire date."""
    encoder_id = user["user_id"]
    region_id = user.get("assigned_region_id")

    # ── Date filter on fire date (notification_dt, Asia/Manila TZ) ────────────
    date_params: dict = {}
    date_clause = ""
    if date_from:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') >= CAST(:date_from AS date)"
        )
        date_params["date_from"] = date_from
    if date_to:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') <= CAST(:date_to AS date)"
        )
        date_params["date_to"] = date_to

    # ── Region-wide VERIFIED card stats ──────────────────────────────────────
    verified_params: dict = {"rid": region_id, **date_params}

    total = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM wims.fire_incidents fi
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                WHERE fi.region_id = :rid
                  AND fi.verification_status = 'VERIFIED'
                  AND fi.is_archived = FALSE
                  {date_clause}
                """
            ),
            verified_params,
        ).scalar()
        or 0
    )

    by_cat_rows = db.execute(
        text(
            f"""
            SELECT nd.general_category, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid
              AND fi.verification_status = 'VERIFIED'
              AND fi.is_archived = FALSE
              {date_clause}
            GROUP BY nd.general_category
            ORDER BY cnt DESC
            """
        ),
        verified_params,
    ).fetchall()

    wildland_total = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM wims.incident_wildland_afor iwa
                JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                WHERE fi.region_id = :rid
                  AND fi.verification_status = 'VERIFIED'
                  AND fi.is_archived = FALSE
                  {date_clause}
                """
            ),
            verified_params,
        ).scalar()
        or 0
    )

    wildland_type_rows = db.execute(
        text(
            f"""
            SELECT lower(trim(iwa.wildland_fire_type)) AS wildland_fire_type, COUNT(*) AS cnt
            FROM wims.incident_wildland_afor iwa
            JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid
              AND fi.verification_status = 'VERIFIED'
              AND fi.is_archived = FALSE
              {date_clause}
            GROUP BY lower(trim(iwa.wildland_fire_type))
            ORDER BY cnt DESC
            """
        ),
        verified_params,
    ).fetchall()

    affected_row = db.execute(
        text(
            f"""
            SELECT
                COALESCE(SUM(nd.structures_affected), 0),
                COALESCE(SUM(nd.households_affected), 0),
                COALESCE(SUM(nd.families_affected), 0),
                COALESCE(SUM(nd.individuals_affected), 0),
                COALESCE(SUM(nd.vehicles_affected), 0)
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid
              AND fi.verification_status = 'VERIFIED'
              AND fi.is_archived = FALSE
              {date_clause}
            """
        ),
        verified_params,
    ).fetchone()

    # ── Encoder-personal status counts (for rejection banner only) ────────────
    hide_seeded_sql = """
      AND NOT (
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
    """

    by_status_rows = db.execute(
        text(
            """
            SELECT verification_status, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            WHERE fi.encoder_id = CAST(:eid AS uuid)
              AND fi.is_archived = FALSE
              """
            + hide_seeded_sql
            + """
              AND NOT EXISTS (
                  SELECT 1
                  FROM wims.incident_verification_history ivh
                  WHERE ivh.target_id = fi.incident_id
                    AND ivh.action_label = 'DELETED_DRAFT'
              )
            GROUP BY verification_status
            ORDER BY cnt DESC
            """
        ),
        {"eid": str(encoder_id)},
    ).fetchall()

    by_alarm_rows = db.execute(
        text(
            """
            SELECT nd.alarm_level, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.encoder_id = CAST(:eid AS uuid) AND fi.is_archived = FALSE
            """
            + hide_seeded_sql
            + """
            GROUP BY nd.alarm_level
            ORDER BY cnt DESC
            """
        ),
        {"eid": str(encoder_id)},
    ).fetchall()

    return RegionalStatsResponse(
        total_incidents=total,
        total_incidents_this_week=total,
        by_category=[{"category": r[0], "count": r[1]} for r in by_cat_rows],
        by_alarm_level=[{"alarm_level": r[0], "count": r[1]} for r in by_alarm_rows],
        by_status=[{"status": r[0], "count": r[1]} for r in by_status_rows],
        wildland_total=wildland_total,
        by_wildland_type=[{"fire_type": r[0], "count": r[1]} for r in wildland_type_rows],
        structures_affected=int(affected_row[0]) if affected_row else 0,
        households_affected=int(affected_row[1]) if affected_row else 0,
        families_affected=int(affected_row[2]) if affected_row else 0,
        individuals_affected=int(affected_row[3]) if affected_row else 0,
        vehicles_affected=int(affected_row[4]) if affected_row else 0,
    )


# ---------------------------------------------------------------------------
# CRUD — Direct Incident Create / Update / Delete
# ---------------------------------------------------------------------------


@router.post("/incidents", status_code=201)
def create_incident(
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

    # Reference number is assigned only at validator approval — not at create time
    type_code = (body.incident_type_code or "").strip().upper() or None

    # Insert fire_incidents core row
    incident_row = db.execute(
        text("""
            INSERT INTO wims.fire_incidents
                (encoder_id, region_id, location, verification_status, incident_type_code, parent_incident_id)
            VALUES (:eid, :rid, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 'DRAFT', :type_code, :parent_id)
            RETURNING incident_id
        """),
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
            sp = _get_security_provider()
            nonce_b64, ct_b64 = sp.encrypt_json(pii_dict, f"incident_id:{incident_id}".encode())
            sd_cols.extend(["pii_blob_enc", "encryption_iv"])
            sd_vals.extend([":pii_blob", ":enc_iv"])
            sd_params["pii_blob"] = ct_b64
            sd_params["enc_iv"] = nonce_b64
        except SecurityProviderError:
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


def _apply_incident_field_updates(
    db: Session, incident_id: int, body: "IncidentUpdateRequest"
) -> None:
    """Apply nonsensitive/sensitive/JSONB/coords field updates from an
    IncidentUpdateRequest to the given incident_id. Caller is responsible
    for status checks, audit-trail writes, and committing the transaction.
    """
    # Ensure child rows exist so UPDATE statements never silently affect 0 rows.
    db.execute(
        text(
            """
            INSERT INTO wims.incident_nonsensitive_details (incident_id)
            SELECT :iid
            WHERE NOT EXISTS (
                SELECT 1 FROM wims.incident_nonsensitive_details WHERE incident_id = :iid
            )
            """
        ),
        {"iid": incident_id},
    )
    db.execute(
        text(
            """
            INSERT INTO wims.incident_sensitive_details (incident_id)
            SELECT :iid
            WHERE NOT EXISTS (
                SELECT 1 FROM wims.incident_sensitive_details WHERE incident_id = :iid
            )
            """
        ),
        {"iid": incident_id},
    )

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
        "extent_total_floor_area_sqm",
        "extent_total_land_area_hectares",
        "stage_of_fire",
        "general_description_of_involved",
        "fire_station_name",
        "total_response_time_minutes",
        "vehicles_affected",
        "recommendations",
        "station_code",
    }
    ns_updates: list[str] = []
    ns_params: dict[str, Any] = {"iid": incident_id}
    for field in ns_fields:
        val = getattr(body, field, None)
        if val is not None:
            if field == "alarm_level" and isinstance(val, str):
                val = ALARM_LEVEL_MAP.get(val.upper().strip(), val)
            elif field == "general_category" and isinstance(val, str):
                val = _normalize_general_category(val)
            ns_updates.append(f"{field} = :{field}")
            ns_params[field] = val
    if ns_updates:
        db.execute(
            text(
                f"UPDATE wims.incident_nonsensitive_details SET {', '.join(ns_updates)} WHERE incident_id = :iid"
            ),
            ns_params,
        )

    # Update incident_type_code on the fire_incidents core row if provided
    new_type_code = (getattr(body, "incident_type_code", None) or "").strip().upper() or None
    if new_type_code:
        db.execute(
            text(
                "UPDATE wims.fire_incidents SET incident_type_code = :tc WHERE incident_id = :iid"
            ),
            {"tc": new_type_code, "iid": incident_id},
        )

    sd_fields = {
        "street_address",
        "landmark",
        "narrative_report",
        "establishment_name",
        "receiver_name",
        "prepared_by_officer",
        "noted_by_officer",
        "remarks",
    }
    pii_fields = [
        "caller_name",
        "caller_number",
        "owner_name",
        "occupant_name",
        "narrative_report",
        "casualty_details",
        "estimated_damage_php",
    ]
    sd_updates: list[str] = []
    sd_params: dict[str, Any] = {"iid": incident_id}
    has_encryptable_update = False
    for field in sd_fields | set(pii_fields):
        val = getattr(body, field, None)
        if val is not None:
            if field in pii_fields:
                has_encryptable_update = True
                # owner_name also mirrors to the plaintext column (used by list queries)
                if field == "owner_name":
                    sd_updates.append(f"{field} = :{field}")
                    sd_params[field] = val
            else:
                sd_updates.append(f"{field} = :{field}")
                sd_params[field] = val
    if has_encryptable_update:
        existing = db.execute(
            text(
                "SELECT pii_blob_enc, encryption_iv FROM wims.incident_sensitive_details WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        ).fetchone()
        existing_pii: dict[str, Any] = {}
        if existing and existing[0] and existing[1]:
            try:
                sp = _get_security_provider()
                existing_pii = sp.decrypt_json(
                    existing[1], existing[0], f"incident_id:{incident_id}".encode()
                )
            except SecurityProviderError:
                logger.warning(
                    "Failed to decrypt existing PII for incident %s — overwriting",
                    incident_id,
                )
        for field in pii_fields:
            val = getattr(body, field, None)
            if val is not None:
                existing_pii[field] = val
        try:
            sp = _get_security_provider()
            nonce_b64, ct_b64 = sp.encrypt_json(existing_pii, f"incident_id:{incident_id}".encode())
            sd_updates.extend(["pii_blob_enc = :pii_blob", "encryption_iv = :enc_iv"])
            sd_params["pii_blob"] = ct_b64
            sd_params["enc_iv"] = nonce_b64
        except SecurityProviderError:
            logger.warning("PII re-encryption failed for incident %s", incident_id)
    if sd_updates:
        db.execute(
            text(
                f"UPDATE wims.incident_sensitive_details SET {', '.join(sd_updates)} WHERE incident_id = :iid"
            ),
            sd_params,
        )

    # NULL plaintext columns for fields now routed to encrypted blob.
    # narrative_report and casualty_details live in incident_sensitive_details;
    # estimated_damage_php lives in incident_nonsensitive_details.
    if has_encryptable_update:
        db.execute(
            text(
                "UPDATE wims.incident_sensitive_details"
                " SET narrative_report = NULL, casualty_details = NULL"
                " WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        )
        db.execute(
            text(
                "UPDATE wims.incident_nonsensitive_details"
                " SET estimated_damage_php = NULL"
                " WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        )

    jsonb_ns = {
        "alarm_timeline": body.alarm_timeline,
        "resources_deployed": body.resources_deployed,
        "problems_encountered": body.problems_encountered,
    }
    jsonb_ns_updates: list[str] = []
    jsonb_ns_params: dict[str, Any] = {"iid": incident_id}
    for field, val in jsonb_ns.items():
        if val is not None:
            jsonb_ns_updates.append(f"{field} = CAST(:{field} AS jsonb)")
            jsonb_ns_params[field] = json.dumps(val)
    if jsonb_ns_updates:
        db.execute(
            text(
                f"UPDATE wims.incident_nonsensitive_details SET {', '.join(jsonb_ns_updates)} WHERE incident_id = :iid"
            ),
            jsonb_ns_params,
        )

    jsonb_sd = {
        "personnel_on_duty": body.personnel_on_duty,
        "other_personnel": body.other_personnel,
        "casualty_details": body.casualty_details,
        "disposition": body.disposition,
    }
    jsonb_sd_updates: list[str] = []
    jsonb_sd_params: dict[str, Any] = {"iid": incident_id}
    for field, val in jsonb_sd.items():
        if val is not None:
            if field == "disposition":
                jsonb_sd_updates.append(f"{field} = :{field}")
            else:
                jsonb_sd_updates.append(f"{field} = CAST(:{field} AS jsonb)")
            jsonb_sd_params[field] = json.dumps(val) if field != "disposition" else val
    if jsonb_sd_updates:
        db.execute(
            text(
                f"UPDATE wims.incident_sensitive_details SET {', '.join(jsonb_sd_updates)} WHERE incident_id = :iid"
            ),
            jsonb_sd_params,
        )

    if body.latitude is not None and body.longitude is not None:
        db.execute(
            text(
                """
                UPDATE wims.fire_incidents
                SET updated_at = now(),
                    location = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
                WHERE incident_id = :iid
                """
            ),
            {"lon": body.longitude, "lat": body.latitude, "iid": incident_id},
        )
    else:
        db.execute(
            text("UPDATE wims.fire_incidents SET updated_at = now() WHERE incident_id = :iid"),
            {"iid": incident_id},
        )


@router.put("/incidents/{incident_id}")
def update_incident(
    incident_id: int,
    body: IncidentUpdateRequest,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Update a DRAFT or REJECTED incident owned by the current encoder.

    PENDING incidents cannot be edited directly — the encoder must withdraw
    them first (PATCH /incidents/{id}/unpend) which transitions PENDING → DRAFT.
    """
    encoder_id = user["user_id"]

    # Verify ownership + editable status
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
        deps=_regional_lifecycle_dependencies(),
    )
    logger.info("Force-replaced PENDING incident %s by encoder %s", incident_id, encoder_id)
    return result


# ---------------------------------------------------------------------------
# M4-E: Dedicated draft management endpoints (PATCH/DELETE).
# These have 3-segment paths so they do not conflict with /incidents/{id}.
# The list endpoint (GET /incidents/drafts) is registered separately above.
# ---------------------------------------------------------------------------


@router.patch("/incidents/draft/{incident_id}")
def update_draft(
    incident_id: int,
    body: IncidentUpdateRequest,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Update a DRAFT incident owned by the current encoder.

    Mirrors update_incident() but enforces verification_status = 'DRAFT'.
    Drafts do NOT get an audit trail entry — they are not under review.
    """
    encoder_id = user["user_id"]
    incident = db.execute(
        text(
            """
            SELECT incident_id, verification_status
            FROM wims.fire_incidents
            WHERE incident_id = :iid
              AND encoder_id = CAST(:eid AS uuid)
              AND is_archived = FALSE
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
        deps=_regional_lifecycle_dependencies(),
        draft_only=True,
    )
    logger.info("Draft deleted (archived) incident %s by encoder %s", incident_id, encoder_id)
    return result


@router.patch("/incidents/{incident_id}/unpend")
def unpend_incident(
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
        deps=_regional_lifecycle_dependencies(),
    )
    logger.info("Unpended incident %s by encoder %s", incident_id, encoder_id)
    return result


@router.delete("/incidents/{incident_id}")
def delete_incident(
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
        deps=_regional_lifecycle_dependencies(),
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
        deps=_regional_lifecycle_dependencies(),
    )


@router.patch("/incidents/{incident_id}/submit", status_code=200)
def submit_incident_for_review(
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
        deps=_regional_lifecycle_dependencies(),
    )
    logger.info(
        "Encoder user_id=%s submitted incident_id=%s for review",
        encoder_id,
        incident_id,
    )
    return result


# ---------------------------------------------------------------------------
# Validator Workflow
# ---------------------------------------------------------------------------


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
    result = verify_incident_command(
        db,
        incident_id=incident_id,
        action_body=body,
        validator_user_id=validator_user_id,
        request=request,
        force=force,
        deps=_regional_lifecycle_dependencies(),
    )
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


# ---------------------------------------------------------------------------
# M6-D: Incident Correction Workflow
# ---------------------------------------------------------------------------


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

        canonical = {
            "encoder_id": str(inc_encoder_id),
            "keycloak_id": str(inc_keycloak_id),
            "incident_id": str(inc_id),
            "region_id": str(inc_region_id),
            "verification_status": "VERIFIED",
            "created_at": inc_created_at.isoformat(),
        }
        new_data_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()

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


# ---------------------------------------------------------------------------
# M4-H: Bulk approve
# ---------------------------------------------------------------------------


@router.post("/validator/incidents/bulk-approve")
def bulk_approve_incidents(
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
        deps=_regional_lifecycle_dependencies(),
    )
    logger.info(
        "Validator user_id=%s bulk-approved %d incidents: %s; held: %d",
        validator_user_id,
        result["approved"],
        result["incident_ids"],
        len(result["held_for_review"]),
    )
    return result


# ---------------------------------------------------------------------------
# B4: Archive endpoint for validators
# ---------------------------------------------------------------------------


@router.patch("/validator/incidents/{incident_id}/archive")
def archive_incident(
    incident_id: int,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Archive a finalized (VERIFIED, REJECTED, or REPLACED) incident.

    Sets is_archived=TRUE, archived_at=NOW(), verification_status unchanged.
    Returns 400 if the incident is not in an archivable finalized status.
    """
    validator_user_id = user["user_id"]
    return archive_finalized_incident(
        db,
        incident_id=incident_id,
        validator_user_id=validator_user_id,
        deps=_regional_lifecycle_dependencies(),
    )


@router.patch("/validator/incidents/{incident_id}/unarchive")
def unarchive_incident(
    incident_id: int,
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Restore an archived finalized incident to the active validator queue."""
    validator_user_id = user["user_id"]
    return unarchive_finalized_incident(
        db,
        incident_id=incident_id,
        actor_user_id=validator_user_id,
        deps=_regional_lifecycle_dependencies(),
    )


# ---------------------------------------------------------------------------
# Validator hard-delete for archived incidents
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# M4-G: Side-by-side diff for validators
# ---------------------------------------------------------------------------


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

    return {
        "incident_id": incident_id,
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


# ---------------------------------------------------------------------------
# M4-I: Validator audit trail viewer (incident_verification_history)
# ---------------------------------------------------------------------------


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


@router.get("/validator/audit-logs")
def get_validator_audit_logs(
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    region_id: Optional[int] = None,
    actor_username: Optional[str] = None,
    role: Optional[str] = None,
    action: Optional[str] = None,  # filter by action_label (APPROVED/REJECTED/BULK_APPROVED/etc.)
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
