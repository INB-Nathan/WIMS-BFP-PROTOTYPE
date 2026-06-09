"""Field update helpers for incident CRUD — not route handlers.

These functions are called by route handlers in encoder.py and encoder_crud.py.
They are NOT registered behind an APIRouter.
"""

from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from services.afor_import import ALARM_LEVEL_MAP
from services.regional_incidents.helpers import (
    normalize_general_category as _normalize_general_category,
    get_security_provider as _get_security_provider_from_helpers,
)
from utils.crypto import SecurityProviderError
from schemas.regional import IncidentUpdateRequest

logger = logging.getLogger("wims.regional")


def _get_security_provider():
    """Return the SecurityProvider singleton (wraps helpers import)."""
    return _get_security_provider_from_helpers()


def _apply_incident_field_updates(
    db: Session, incident_id: int, body: IncidentUpdateRequest
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
                "SELECT pii_blob_enc, encryption_iv, key_version FROM wims.incident_sensitive_details WHERE incident_id = :iid"
            ),
            {"iid": incident_id},
        ).fetchone()
        existing_pii: dict[str, Any] = {}
        if existing and existing[0] and existing[1]:
            try:
                sp = _get_security_provider()
                existing_pii = sp.decrypt_json(
                    existing[1], existing[0], f"incident_id:{incident_id}".encode(),
                    key_version=existing[2] or 1,
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
            sd_updates.extend(["pii_blob_enc = :pii_blob", "encryption_iv = :enc_iv", "key_version = :key_ver"])
            sd_params["pii_blob"] = ct_b64
            sd_params["enc_iv"] = nonce_b64
            sd_params["key_ver"] = sp.current_version
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


def _fetch_incident_edit_fields(db: Session, incident_id: int) -> dict[str, Any]:
    """Return a flat dict of all editable IncidentUpdateRequest fields for an incident.

    Used to populate the server_version payload in 409 conflict responses so the
    frontend merge panel can diff the client draft against the current server state.
    """
    ns = db.execute(
        text("SELECT * FROM wims.incident_nonsensitive_details WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()
    ns_dict: dict[str, Any] = dict(ns._mapping) if ns and hasattr(ns, "_mapping") else {}

    sd = db.execute(
        text("SELECT * FROM wims.incident_sensitive_details WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()
    sd_dict: dict[str, Any] = dict(sd._mapping) if sd and hasattr(sd, "_mapping") else {}

    if sd_dict.get("pii_blob_enc") and sd_dict.get("encryption_iv"):
        try:
            sp = _get_security_provider()
            pii = sp.decrypt_json(
                sd_dict["encryption_iv"],
                sd_dict["pii_blob_enc"],
                f"incident_id:{incident_id}".encode(),
                key_version=sd_dict.get("key_version") or 1,
            )
            sd_dict.update(pii)
        except SecurityProviderError:
            pass

    fi = db.execute(
        text("""
            SELECT fi.incident_type_code, fi.updated_at,
                   ST_Y(fi.location::geometry) AS latitude,
                   ST_X(fi.location::geometry) AS longitude
            FROM wims.fire_incidents fi
            WHERE fi.incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()
    fi_dict: dict[str, Any] = dict(fi._mapping) if fi and hasattr(fi, "_mapping") else {}

    result: dict[str, Any] = {**ns_dict, **sd_dict, **fi_dict}

    # Strip encrypted blob columns from the conflict payload — the frontend
    # merge panel never needs raw ciphertext.
    result.pop("pii_blob_enc", None)
    result.pop("encryption_iv", None)

    def _serialize_value(v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, Decimal):
            return float(v) if v % 1 else int(v)
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return v

    return {k: _serialize_value(v) for k, v in result.items()}
