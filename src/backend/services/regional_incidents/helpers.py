"""Shared helper functions for the Regional Incidents API routes.

These utilities are used across multiple sub-routers and have been extracted
from api/routes/regional.py to keep route files focused on HTTP concerns.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError as SAIntegrityError
from sqlalchemy.orm import Session

from services.afor_import import ALARM_LEVEL_MAP
from services.kms import get_crypto_provider
from utils.crypto import SecurityProvider, SecurityProviderError

logger = logging.getLogger("wims.regional")


class DuplicateClientIdError(Exception):
    """Raised when a duplicate client_id unique violation occurs during IVH insert.

    Callers in lifecycle.py should catch this, roll back the transaction,
    and return {"status": "already_applied"} instead of an HTTP 500.
    """

    pass


# ── Lazy SecurityProvider singleton ──────────────────────────────────────────
_sp_instance: SecurityProvider | None = None


def get_security_provider() -> SecurityProvider:
    global _sp_instance  # noqa: PLW0603
    if _sp_instance is None:
        _sp_instance = SecurityProvider()
    return _sp_instance


# ── Category canonicalization ─────────────────────────────────────────────────

_CATEGORY_CANONICAL: dict[str, str] = {
    "STRUCTURAL": "STRUCTURAL",
    "NON_STRUCTURAL": "NON_STRUCTURAL",
    "NON-STRUCTURAL": "NON_STRUCTURAL",
    "VEHICULAR": "TRANSPORTATION",
    "TRANSPORTATION": "TRANSPORTATION",
    "WILDLAND": "WILDLAND",
}

_CATEGORY_DB_VARIANTS: dict[str, list[str]] = {
    "STRUCTURAL": ["STRUCTURAL", "Structural"],
    "NON_STRUCTURAL": ["NON_STRUCTURAL", "Non-Structural", "NON-STRUCTURAL"],
    "TRANSPORTATION": ["TRANSPORTATION", "VEHICULAR", "Transportation", "Vehicular"],
}


def normalize_general_category(val: str) -> str:
    key = val.strip().upper().replace("-", "_").replace(" ", "_")
    return _CATEGORY_CANONICAL.get(key, val)


# ── Safe type coercions ───────────────────────────────────────────────────────


def safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "" or val == "N/A":
        return default
    try:
        if isinstance(val, (int, float)):
            return int(val)
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default


def safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "" or val == "N/A":
        return default
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return default


# ── Region name alias matching ────────────────────────────────────────────────

_REGION_ALIASES: dict[str, list[str]] = {
    "NATIONAL CAPITAL REGION": ["NCR", "METRO MANILA"],
    "CORDILLERA ADMINISTRATIVE REGION": ["CAR"],
    "REGION I - ILOCOS REGION": ["REGION 1"],
    "REGION II - CAGAYAN VALLEY": ["REGION 2"],
    "REGION III - CENTRAL LUZON": ["REGION 3"],
    "REGION IV-A - CALABARZON": ["REGION 4-A", "REGION 4A", "REGION IVA"],
    "REGION IV-B - MIMAROPA": ["REGION 4-B", "REGION 4B", "REGION IVB"],
    "REGION V - BICOL REGION": ["REGION 5"],
    "REGION VI - WESTERN VISAYAS": ["REGION 6"],
    "REGION VII - CENTRAL VISAYAS": ["REGION 7"],
    "REGION VIII - EASTERN VISAYAS": ["REGION 8"],
    "REGION IX - ZAMBOANGA PENINSULA": ["REGION 9"],
    "REGION X - NORTHERN MINDANAO": ["REGION 10"],
    "REGION XI - DAVAO REGION": ["REGION 11"],
    "REGION XII - SOCCSKSARGEN": ["REGION 12"],
    "REGION XIII - CARAGA": ["REGION 13"],
    "BARMM": ["BANGSAMORO", "ARMM", "BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO"],
    "NIR - NEGROS ISLAND REGION": ["NIR", "NEGROS ISLAND REGION"],
}


def region_text_matches(encoder_region_name: str, xlsx_region_text: str) -> bool:
    """Return True if xlsx_region_text refers to the same PH region as encoder_region_name."""
    enc = encoder_region_name.strip().upper()
    xlsx = xlsx_region_text.strip().upper()
    if enc in xlsx or xlsx in enc:
        return True
    for alias in _REGION_ALIASES.get(enc, []):
        a = alias.upper()
        if a == xlsx or a in xlsx or xlsx in a:
            return True
    return False


# ── Reference number generation ───────────────────────────────────────────────

_AFOR_MONTH_CODES = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
]

_REGION_CODE_TO_AFOR: dict[str, str] = {
    "NCR": "RGN-NCR",
    "CAR": "RGN-CAR",
    "NIR": "RGN-NIR",
    "BARMM": "RGN-BARMM",
    "I": "RGN-1",
    "II": "RGN-2",
    "III": "RGN-3",
    "IV-A": "RGN-4A",
    "IV-B": "RGN-4B",
    "V": "RGN-5",
    "VI": "RGN-6",
    "VII": "RGN-7",
    "VIII": "RGN-8",
    "IX": "RGN-9",
    "X": "RGN-10",
    "XI": "RGN-11",
    "XII": "RGN-12",
    "XIII": "RGN-13",
}


def generate_reference_number(
    db: Session,
    region_id: int,
    incident_type_code: str,
    notification_dt: str | None,
) -> str:
    """Generate AFOR-{RGN-CODE}-{type}-{MMM}-{YYYY}-{NNNN}.

    Sequence number is globally unique — not per-region or per-type.
    """
    region_row = db.execute(
        text("SELECT region_code FROM wims.ref_regions WHERE region_id = :rid"),
        {"rid": region_id},
    ).fetchone()
    raw_code = region_row[0] if region_row else "UNK"
    rgn_code = _REGION_CODE_TO_AFOR.get(raw_code, f"RGN-{raw_code}")

    try:
        dt = (
            datetime.fromisoformat(str(notification_dt).replace("Z", "+00:00"))
            if notification_dt
            else datetime.now()
        )
    except (ValueError, TypeError):
        dt = datetime.now()

    month = _AFOR_MONTH_CODES[dt.month - 1]
    year = dt.year

    seq_row = db.execute(
        text("""
            UPDATE wims.reference_sequence
            SET current_value = current_value + 1
            WHERE id = 0
            RETURNING current_value
        """),
    ).fetchone()
    if not seq_row:
        raise RuntimeError(
            "reference_sequence row id=0 is missing — cannot generate reference number"
        )
    return f"AFOR-{rgn_code}-{incident_type_code}-{month}-{year}-{int(seq_row[0]):04d}"


# ── IVH (incident verification history) helpers ───────────────────────────────


_ivh_column_cache: dict[str, bool] = {}
# Populated lazily by _ivh_has_column.  Never invalidated — schema
# changes require a process restart (migration deploy).


def _ivh_has_column(db: Session, column_name: str) -> bool:
    """Check if a column exists in wims.incident_verification_history.

    Results are cached after the first query per column — the table schema
    only changes during deployment migrations, never at runtime.
    """
    if column_name in _ivh_column_cache:
        return _ivh_column_cache[column_name]
    exists = bool(
        db.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'wims'
                      AND table_name = 'incident_verification_history'
                      AND column_name = :column_name
                )
            """),
            {"column_name": column_name},
        ).scalar()
    )
    _ivh_column_cache[column_name] = exists
    return exists


def _ivh_uses_target_columns(db: Session) -> bool:
    return _ivh_has_column(db, "target_type")


def ivh_has_hash_columns(db: Session) -> bool:
    return all(
        _ivh_has_column(db, col)
        for col in (
            "old_data_hash",
            "new_data_hash",
            "corrected_fields",
            "prev_ivh_hash",
            "ivh_row_hash",
        )
    )


def insert_incident_verification_history(
    db: Session,
    *,
    incident_id: int,
    actor_user_id: str,
    previous_status: str,
    new_status: str,
    notes: str,
    action_label: str | None = None,
    data_hash: str | None = None,
    sync_status: str = "SYNCED",
    client_id: str | None = None,
    request_ip: str | None = None,
) -> None:
    """Insert IVH row with compatibility for both legacy and migrated schemas.

    Raises DuplicateClientIdError when a client_id unique violation is
    detected so callers can return an idempotent ``already_applied`` response
    instead of surfacing an HTTP 500 (#272 Q1).
    """
    try:
        _insert_ivh_impl(
            db=db,
            incident_id=incident_id,
            actor_user_id=actor_user_id,
            previous_status=previous_status,
            new_status=new_status,
            notes=notes,
            action_label=action_label,
            data_hash=data_hash,
            sync_status=sync_status,
            client_id=client_id,
            request_ip=request_ip,
        )
    except SAIntegrityError as e:
        if client_id is not None:
            err_msg = str(e).lower()
            if "unique" in err_msg and "uq_incident_verification_history_client_id" in err_msg:
                raise DuplicateClientIdError(
                    f"Duplicate client_id '{client_id}' — idempotent retry detected"
                ) from e
        raise


def _insert_ivh_impl(
    db: Session,
    *,
    incident_id: int,
    actor_user_id: str,
    previous_status: str,
    new_status: str,
    notes: str,
    action_label: str | None = None,
    data_hash: str | None = None,
    sync_status: str = "SYNCED",
    client_id: str | None = None,
    request_ip: str | None = None,
) -> None:
    """Implementation detail — same body as original insert_incident_verification_history."""
    has_action_label = _ivh_has_column(db, "action_label")
    has_data_hash = _ivh_has_column(db, "data_hash")
    has_sync_status = _ivh_has_column(db, "sync_status")
    has_client_id = _ivh_has_column(db, "client_id")
    has_ip_address = _ivh_has_column(db, "ip_address")

    if _ivh_uses_target_columns(db):
        if has_action_label and has_data_hash and has_sync_status:
            _ivh_columns = (
                "target_type, target_id, action_by_user_id,"
                "previous_status, new_status, notes, action_label,"
                "data_hash, sync_status"
            )
            _ivh_values = (
                "'OFFICIAL', :iid, CAST(:uid AS uuid),"
                ":prev_status, :new_status, :notes, :action_label,"
                ":data_hash, :sync_status"
            )
            _ivh_params = {
                "iid": incident_id,
                "uid": actor_user_id,
                "prev_status": previous_status,
                "new_status": new_status,
                "notes": notes,
                "action_label": action_label,
                "data_hash": data_hash,
                "sync_status": sync_status,
            }
            if has_client_id:
                _ivh_columns += ", client_id"
                _ivh_values += ", CAST(:client_id AS uuid)"
                _ivh_params["client_id"] = client_id
            if has_ip_address and request_ip:
                _ivh_columns += ", ip_address"
                _ivh_values += ", :ip_address"
                _ivh_params["ip_address"] = request_ip
            db.execute(
                text(
                    f"INSERT INTO wims.incident_verification_history ({_ivh_columns})"
                    f" VALUES ({_ivh_values})"
                ),
                _ivh_params,
            )
        elif has_action_label:
            _ivh_columns = (
                "target_type, target_id, action_by_user_id,"
                "previous_status, new_status, notes, action_label"
            )
            _ivh_values = (
                "'OFFICIAL', :iid, CAST(:uid AS uuid),"
                ":prev_status, :new_status, :notes, :action_label"
            )
            _ivh_params = {
                "iid": incident_id,
                "uid": actor_user_id,
                "prev_status": previous_status,
                "new_status": new_status,
                "notes": notes,
                "action_label": action_label,
            }
            if has_client_id:
                _ivh_columns += ", client_id"
                _ivh_values += ", CAST(:client_id AS uuid)"
                _ivh_params["client_id"] = client_id
            if has_ip_address and request_ip:
                _ivh_columns += ", ip_address"
                _ivh_values += ", :ip_address"
                _ivh_params["ip_address"] = request_ip
            db.execute(
                text(
                    f"INSERT INTO wims.incident_verification_history ({_ivh_columns})"
                    f" VALUES ({_ivh_values})"
                ),
                _ivh_params,
            )
        elif has_data_hash and has_sync_status:
            _ivh_columns = (
                "target_type, target_id, action_by_user_id,"
                "previous_status, new_status, notes,"
                "data_hash, sync_status"
            )
            _ivh_values = (
                "'OFFICIAL', :iid, CAST(:uid AS uuid),"
                ":prev_status, :new_status, :notes,"
                ":data_hash, :sync_status"
            )
            _ivh_params = {
                "iid": incident_id,
                "uid": actor_user_id,
                "prev_status": previous_status,
                "new_status": new_status,
                "notes": notes,
                "data_hash": data_hash,
                "sync_status": sync_status,
            }
            if has_client_id:
                _ivh_columns += ", client_id"
                _ivh_values += ", CAST(:client_id AS uuid)"
                _ivh_params["client_id"] = client_id
            if has_ip_address and request_ip:
                _ivh_columns += ", ip_address"
                _ivh_values += ", :ip_address"
                _ivh_params["ip_address"] = request_ip
            db.execute(
                text(
                    f"INSERT INTO wims.incident_verification_history ({_ivh_columns})"
                    f" VALUES ({_ivh_values})"
                ),
                _ivh_params,
            )
        else:
            _ivh_columns = (
                "target_type, target_id, action_by_user_id,previous_status, new_status, notes"
            )
            _ivh_values = "'OFFICIAL', :iid, CAST(:uid AS uuid),:prev_status, :new_status, :notes"
            _ivh_params = {
                "iid": incident_id,
                "uid": actor_user_id,
                "prev_status": previous_status,
                "new_status": new_status,
                "notes": notes,
            }
            if has_client_id:
                _ivh_columns += ", client_id"
                _ivh_values += ", CAST(:client_id AS uuid)"
                _ivh_params["client_id"] = client_id
            if has_ip_address and request_ip:
                _ivh_columns += ", ip_address"
                _ivh_values += ", :ip_address"
                _ivh_params["ip_address"] = request_ip
            db.execute(
                text(
                    f"INSERT INTO wims.incident_verification_history ({_ivh_columns})"
                    f" VALUES ({_ivh_values})"
                ),
                _ivh_params,
            )
        return

    _ivh_columns = "incident_id, action_by_user_id,previous_status, new_status, comments"
    _ivh_values = ":iid, CAST(:uid AS uuid),:prev_status, :new_status, :comments"
    _ivh_params = {
        "iid": incident_id,
        "uid": actor_user_id,
        "prev_status": previous_status,
        "new_status": new_status,
        "comments": notes,
    }
    if has_client_id:
        _ivh_columns += ", client_id"
        _ivh_values += ", CAST(:client_id AS uuid)"
        _ivh_params["client_id"] = client_id
    db.execute(
        text(
            f"INSERT INTO wims.incident_verification_history ({_ivh_columns})"
            f" VALUES ({_ivh_values})"
        ),
        _ivh_params,
    )


# ── Hash-chain verification ───────────────────────────────────────────────────


def _isoformat_match_aware(dt: datetime) -> str:
    """ISO-format a datetime exactly as the correction write-path does.

    The write-path stores ``action_timestamp.isoformat()`` inside the hash
    payload.  Python's ``isoformat()`` omits microseconds when they are zero,
    so we must replicate that behaviour for deterministic recomputation.
    """
    s = dt.isoformat()
    # Normalize timezone suffix: psycopg2 may return fixed-offset tzinfo
    # that uses "+00:00" style; standardise to "+00:00" for UTC.
    if s.endswith("+00:00"):
        return s
    if s.endswith("Z"):
        return s[:-1] + "+00:00"
    # Defensive: if naive datetime (no tz suffix), append UTC offset.
    # Psycopg2 can return naive datetimes under certain connection/column configs,
    # which would otherwise cause a hash mismatch vs. the write-path that always
    # produces "+00:00".
    if "+" not in s[-6:] and not s.endswith("Z"):
        return s + "+00:00"
    return s


def _parse_pg_array(value: str | None) -> list[str]:
    """Parse a PostgreSQL ARRAY literal like {a,b,c} back into a Python list."""
    if not value:
        return []
    s = value.strip()
    if s.startswith("{") and s.endswith("}"):
        inner = s[1:-1]
        if not inner:
            return []
        return [elem.strip() for elem in inner.split(",")]
    # Fallback: try JSON
    try:
        parsed = json.loads(s)
        if isinstance(parsed, list):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def verify_incident_hash_chain(
    db: Session,
    incident_id: int,
    *,
    log_violations: bool = True,
) -> dict[str, Any]:
    """Read-path verification of the IVH hash chain for an incident.

    Returns a dict with:

    * ``integrity_status`` — ``"valid"``, ``"tampered"``, or ``"unverified"``
    * ``rows_verified``  — number of IVH rows that carry a hash-chain payload
    * ``violations``     — list of human-readable violation descriptions (empty if valid)

    When ``log_violations=True``, any detected tampering is written to
    ``wims.system_audit_trails`` with ``action_type='INTEGRITY_VIOLATION'``.
    """
    # Fetch all IVH rows that have a hash-chain payload, ordered by time.
    rows = db.execute(
        text("""
            SELECT
                history_id,
                ivh_row_hash,
                prev_ivh_hash,
                new_data_hash,
                corrected_fields,
                action_timestamp
            FROM wims.incident_verification_history
            WHERE target_type = 'OFFICIAL'
              AND target_id = :iid
              AND ivh_row_hash IS NOT NULL
            ORDER BY action_timestamp ASC, history_id ASC
        """),
        {"iid": incident_id},
    ).fetchall()

    if not rows:
        return {
            "integrity_status": "unverified",
            "rows_verified": 0,
            "violations": [],
        }

    # Fetch fire_incidents.data_hash for the anchor check
    fi_data_hash = db.execute(
        text("SELECT data_hash FROM wims.fire_incidents WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).scalar()

    violations: list[str] = []
    prev_expected_hash: str | None = None

    for idx, row in enumerate(rows):
        (
            history_id,
            stored_ivh_row_hash,
            stored_prev_ivh_hash,
            stored_new_data_hash,
            stored_corrected_fields,
            stored_action_timestamp,
        ) = row

        if stored_action_timestamp is None:
            violations.append(
                f"IVH row history_id={history_id}: action_timestamp is NULL — cannot verify"
            )
            continue

        # Recompute ivh_row_hash with the exact same serialisation as the
        # correction write-path in validator.py:correct_verified_incident().
        # Parse corrected_fields from its stored PostgreSQL ARRAY literal form.
        parsed_fields = _parse_pg_array(stored_corrected_fields)
        chain_payload = {
            "prev_ivh_hash": stored_prev_ivh_hash or "",
            "new_data_hash": stored_new_data_hash or "",
            "corrected_fields": parsed_fields,
            "action_timestamp": _isoformat_match_aware(stored_action_timestamp),
        }
        recomputed_row_hash = hashlib.sha256(
            json.dumps(chain_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        # 1. Verify row hash matches recomputed payload hash
        if recomputed_row_hash != (stored_ivh_row_hash or ""):
            violations.append(
                f"IVH row history_id={history_id}: ivh_row_hash mismatch — "
                f"stored={stored_ivh_row_hash} recomputed={recomputed_row_hash}"
            )

        # 2. Verify prev_ivh_hash chains to the previous row
        if prev_expected_hash is not None:
            if (stored_prev_ivh_hash or "") != prev_expected_hash:
                violations.append(
                    f"IVH row history_id={history_id}: prev_ivh_hash chain broken — "
                    f"expected={prev_expected_hash} got={stored_prev_ivh_hash}"
                )

        prev_expected_hash = stored_ivh_row_hash or ""

    # 3. Verify anchor: latest row's new_data_hash should match fire_incidents.data_hash
    if rows:
        last_new_data_hash = rows[-1][3]  # new_data_hash column
        if fi_data_hash and last_new_data_hash:
            if last_new_data_hash != fi_data_hash:
                violations.append(
                    f"Anchor mismatch: last IVH new_data_hash={last_new_data_hash} "
                    f"!= fire_incidents.data_hash={fi_data_hash}"
                )
        elif fi_data_hash and not last_new_data_hash:
            violations.append(
                "Anchor mismatch: fire_incidents has data_hash but last IVH row has no new_data_hash"
            )
        elif not fi_data_hash:
            violations.append(
                "Anchor verification skipped: fire_incidents.data_hash is NULL for incident with hash-chain rows"
            )

    integrity_status = "tampered" if violations else "valid"

    if violations and log_violations:
        logger.warning(
            "INTEGRITY_VIOLATION: hash-chain tamper detected for incident_id=%s: %s",
            incident_id,
            "; ".join(violations),
        )
        # Persist audit row in a self-committing session so the record survives
        # even when the calling route handler never commits (read-only endpoints).
        # This short-lived session is isolated from any pending route mutations.
        try:
            from database import _AdminSessionLocal
            from utils.audit import log_system_audit

            audit_db = _AdminSessionLocal()
            try:
                log_system_audit(
                    db=audit_db,
                    user_id=None,
                    action_type="INTEGRITY_VIOLATION",
                    table_affected="incident_verification_history",
                    record_id=incident_id,
                    request=None,
                )
                audit_db.commit()
            except Exception:
                audit_db.rollback()
                raise
            finally:
                audit_db.close()
        except Exception:
            logger.exception(
                "Failed to write INTEGRITY_VIOLATION audit row for incident_id=%s",
                incident_id,
            )

    return {
        "integrity_status": integrity_status,
        "rows_verified": len(rows),
        "violations": violations,
    }


# ── Field update helper ───────────────────────────────────────────────────────


def apply_incident_field_updates(db: Session, incident_id: int, body: Any) -> None:
    """Apply nonsensitive/sensitive/JSONB/coords field updates from an IncidentUpdateRequest."""
    db.execute(
        text("""
            INSERT INTO wims.incident_nonsensitive_details (incident_id)
            SELECT :iid
            WHERE NOT EXISTS (
                SELECT 1 FROM wims.incident_nonsensitive_details WHERE incident_id = :iid
            )
        """),
        {"iid": incident_id},
    )
    db.execute(
        text("""
            INSERT INTO wims.incident_sensitive_details (incident_id)
            SELECT :iid
            WHERE NOT EXISTS (
                SELECT 1 FROM wims.incident_sensitive_details WHERE incident_id = :iid
            )
        """),
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
        "extent_total_floor_area_sqm",
        "extent_total_land_area_hectares",
        "stage_of_fire",
        "general_description_of_involved",
        "fire_station_name",
        "total_response_time_minutes",
        "vehicles_affected",
        "recommendations",
    }
    ns_updates: list[str] = []
    ns_params: dict[str, Any] = {"iid": incident_id}
    for field in ns_fields:
        val = getattr(body, field, None)
        if val is not None:
            if field == "alarm_level" and isinstance(val, str):
                val = ALARM_LEVEL_MAP.get(val.upper().strip(), val)
            elif field == "general_category" and isinstance(val, str):
                val = normalize_general_category(val)
            ns_updates.append(f"{field} = :{field}")
            ns_params[field] = val
    if ns_updates:
        db.execute(
            text(
                f"UPDATE wims.incident_nonsensitive_details SET {', '.join(ns_updates)} WHERE incident_id = :iid"
            ),
            ns_params,
        )

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
    pii_fields = ["caller_name", "caller_number", "owner_name", "occupant_name"]
    sd_updates: list[str] = []
    sd_params: dict[str, Any] = {"iid": incident_id}
    has_pii_update = False
    for field in sd_fields | set(pii_fields):
        val = getattr(body, field, None)
        if val is not None:
            if field in pii_fields:
                has_pii_update = True
                if field == "owner_name":
                    sd_updates.append(f"{field} = :{field}")
                    sd_params[field] = val
            else:
                sd_updates.append(f"{field} = :{field}")
                sd_params[field] = val
    if has_pii_update:
        existing = db.execute(
            text(
                "SELECT pii_blob_enc, encryption_iv, crypto_provider, key_version"
                " FROM wims.incident_sensitive_details WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        ).fetchone()
        existing_pii: dict[str, Any] = {}
        if existing and existing[0]:
            # Dual-read dispatch: decrypt with the row's original provider
            try:
                sd_provider = get_crypto_provider(
                    {"crypto_provider": existing[2]} if existing[2] is not None else None
                )
                existing_pii = sd_provider.decrypt_json(
                    existing[1], existing[0], f"incident_id:{incident_id}".encode()
                )
            except (SecurityProviderError, Exception):
                logger.warning(
                    "Failed to decrypt existing PII for incident %s — overwriting", incident_id
                )
        for field in pii_fields:
            val = getattr(body, field, None)
            if val is not None:
                existing_pii[field] = val
        try:
            # Re-encrypt with env-default provider (new writes always use env)
            provider = get_crypto_provider()
            pii_key_version: int = provider.current_version
            nonce_b64, ct_b64 = provider.encrypt_json(
                existing_pii, f"incident_id:{incident_id}".encode()
            )
            crypto_provider_val = provider.crypto_provider
            kms_key_name_val = provider.kms_key_name
            enc_iv = nonce_b64 if crypto_provider_val == "env_aesgcm" else None
            sd_updates.extend(
                [
                    "pii_blob_enc = :pii_blob",
                    "encryption_iv = :enc_iv",
                    "crypto_provider = :crypto_provider",
                    "kms_key_name = :kms_key_name",
                    "key_version = :key_ver",
                ]
            )
            sd_params["pii_blob"] = ct_b64
            sd_params["enc_iv"] = enc_iv
            sd_params["crypto_provider"] = crypto_provider_val
            sd_params["kms_key_name"] = kms_key_name_val
            sd_params["key_ver"] = pii_key_version
        except (SecurityProviderError, Exception):
            logger.warning("PII re-encryption failed for incident %s", incident_id)
    if sd_updates:
        db.execute(
            text(
                f"UPDATE wims.incident_sensitive_details SET {', '.join(sd_updates)} WHERE incident_id = :iid"
            ),
            sd_params,
        )

    jsonb_ns = {
        "alarm_timeline": body.alarm_timeline,
        "resources_deployed": body.resources_deployed,
        "problems_encountered": body.problems_encountered,
    }
    jsonb_ns_updates = []
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
    jsonb_sd_updates = []
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
            text("""
                UPDATE wims.fire_incidents
                SET updated_at = now(),
                    location = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
                WHERE incident_id = :iid
            """),
            {"lon": body.longitude, "lat": body.latitude, "iid": incident_id},
        )
    else:
        db.execute(
            text("UPDATE wims.fire_incidents SET updated_at = now() WHERE incident_id = :iid"),
            {"iid": incident_id},
        )


# ── Audit log query builder ───────────────────────────────────────────────────


def build_audit_log_query(
    *,
    date_from: str | None,
    date_to: str | None,
    region_id: int | None,
    actor_username: str | None,
    role: str | None,
    action: str | None,
) -> tuple[str, dict[str, Any]]:
    """Compose a parameterized WHERE clause for audit log queries."""
    where_clauses = ["ivh.target_type = 'OFFICIAL'"]
    params: dict[str, Any] = {}
    if date_from:
        where_clauses.append("ivh.action_timestamp >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("ivh.action_timestamp <= CAST(:date_to AS timestamptz)")
        params["date_to"] = date_to
    if region_id is not None:
        where_clauses.append("fi.region_id = :region_id")
        params["region_id"] = region_id
    if actor_username:
        where_clauses.append("u.username ILIKE :actor_username")
        params["actor_username"] = f"%{actor_username}%"
    if role:
        where_clauses.append("u.role = :role")
        params["role"] = role
    if action:
        where_clauses.append("ivh.action_label = :action")
        params["action"] = action
    return " AND ".join(where_clauses), params
