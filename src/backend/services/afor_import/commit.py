"""AFOR commit command: duplicate check, persistence, audit, analytics sync."""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.afor_import.models import (
    AforCommitRequest,
    AforFormKind,
    RowResolution,
    WildlandRowSource,
)
from services.afor_import.parse import parse_wildland_afor_report_data
from services.analytics_read_model import sync_incidents_batch
from utils.crypto import SecurityProviderError

logger = logging.getLogger("wims.afor_import.commit")

DUPLICATE_RADIUS_METERS = 1000
DUPLICATE_MIN_MATCHING_FIELDS = 3
AFOR_WGS84_INVALID_CODE = "AFOR_WGS84_INVALID"
AFOR_WGS84_INVALID_MESSAGE = (
    "AFOR commit requires valid WGS84 latitude and longitude as JSON numbers "
    "(latitude -90..90, longitude -180..180)."
)


@dataclass(frozen=True)
class AforCommitDependencies:
    insert_incident_verification_history: Callable[..., None]
    get_security_provider: Callable[[], Any]


def _wgs84_pair_from_raw(latitude: Any, longitude: Any) -> tuple[float, float]:
    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": AFOR_WGS84_INVALID_CODE,
                "message": AFOR_WGS84_INVALID_MESSAGE,
                "fields": ["latitude", "longitude"],
            },
        )
    if isinstance(latitude, bool) or isinstance(longitude, bool):
        raise HTTPException(
            status_code=400,
            detail={
                "code": AFOR_WGS84_INVALID_CODE,
                "message": AFOR_WGS84_INVALID_MESSAGE,
                "fields": ["latitude", "longitude"],
            },
        )
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail={
                "code": AFOR_WGS84_INVALID_CODE,
                "message": AFOR_WGS84_INVALID_MESSAGE,
                "fields": ["latitude", "longitude"],
            },
        ) from None
    if not math.isfinite(lat) or not math.isfinite(lon):
        raise HTTPException(
            status_code=400,
            detail={
                "code": AFOR_WGS84_INVALID_CODE,
                "message": AFOR_WGS84_INVALID_MESSAGE,
                "fields": ["latitude", "longitude"],
            },
        )
    if lat < -90 or lat > 90 or lon < -180 or lon > 180:
        raise HTTPException(
            status_code=400,
            detail={
                "code": AFOR_WGS84_INVALID_CODE,
                "message": AFOR_WGS84_INVALID_MESSAGE,
                "fields": ["latitude", "longitude"],
            },
        )
    return lon, lat


def _normalize_general_category(val: str) -> str:
    mapping = {
        "STRUCTURAL": "STRUCTURAL",
        "NON_STRUCTURAL": "NON_STRUCTURAL",
        "NON-STRUCTURAL": "NON_STRUCTURAL",
        "VEHICULAR": "TRANSPORTATION",
        "TRANSPORTATION": "TRANSPORTATION",
        "WILDLAND": "WILDLAND",
    }
    key = val.strip().upper().replace("-", "_").replace(" ", "_")
    return mapping.get(key, val)


def _safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "" or val == "N/A":
        return default
    try:
        if isinstance(val, (int, float)):
            return int(val)
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default


_WILDLAND_ALARM_STATUS_ALLOWED = {
    "1st Alarm",
    "2nd Alarm",
    "3rd Alarm",
    "4th Alarm",
    "Task Force Alpha",
    "Task Force Bravo",
    "General Alarm",
    "Ongoing",
    "Fire Out",
    "Fire Under Control",
    "Fire Out Upon Arrival",
    "Fire Under Investigation",
    "Late Reported",
    "Unresponded",
    "No Firefighting Conducted",
}


def _dt_for_sql(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _commit_wildland_afor_row(
    db: Session,
    row_data: dict[str, Any],
    batch_id: int,
    user_id: Any,
    region_id: int,
    incident_ids: list[int],
    lon: float,
    lat: float,
    *,
    source: WildlandRowSource = "AFOR_IMPORT",
) -> None:
    """Insert fire_incident + incident_wildland_afor + optional alarm/assistance children."""
    wl = dict(row_data.get("wildland") or {})
    alarm_statuses: list[dict[str, Any]] = list(wl.pop("wildland_alarm_statuses", []) or [])
    assistance_rows: list[dict[str, Any]] = list(wl.pop("wildland_assistance_rows", []) or [])

    inc_row = db.execute(
        text("""
            INSERT INTO wims.fire_incidents
                (import_batch_id, encoder_id, region_id, location, verification_status)
            VALUES
                (:batch_id, CAST(:uid AS uuid), :region_id,
                 ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                 'DRAFT')
            RETURNING incident_id
        """),
        {
            "batch_id": batch_id,
            "uid": user_id,
            "region_id": region_id,
            "lon": lon,
            "lat": lat,
        },
    ).fetchone()

    if not inc_row:
        return

    incident_id = inc_row[0]
    incident_ids.append(incident_id)

    params = {
        "incident_id": incident_id,
        "batch_id": batch_id,
        "source": source,
        "call_received_at": _dt_for_sql(wl.get("call_received_at")),
        "fire_started_at": _dt_for_sql(wl.get("fire_started_at")),
        "fire_arrival_at": _dt_for_sql(wl.get("fire_arrival_at")),
        "fire_controlled_at": _dt_for_sql(wl.get("fire_controlled_at")),
        "caller_transmitted_by": wl.get("caller_transmitted_by") or "",
        "caller_office_address": wl.get("caller_office_address") or "",
        "call_received_by_personnel": wl.get("call_received_by_personnel") or "",
        "engine_dispatched": wl.get("engine_dispatched") or "",
        "incident_location_description": wl.get("incident_location_description") or "",
        "distance_to_fire_station_km": wl.get("distance_to_fire_station_km"),
        "primary_action_taken": wl.get("primary_action_taken") or "",
        "assistance_combined_summary": wl.get("assistance_combined_summary") or "",
        "buildings_involved": wl.get("buildings_involved") or 0,
        "buildings_threatened": wl.get("buildings_threatened") or 0,
        "ownership_and_property_notes": wl.get("ownership_and_property_notes") or "",
        "total_area_burned_display": wl.get("total_area_burned_display") or "",
        "total_area_burned_hectares": wl.get("total_area_burned_hectares"),
        "wildland_fire_type": wl.get("wildland_fire_type") or None,
        "area_type_summary": json.dumps(wl.get("area_type_summary") or {}),
        "causes_and_ignition_factors": json.dumps(wl.get("causes_and_ignition_factors") or {}),
        "suppression_factors": json.dumps(wl.get("suppression_factors") or {}),
        "weather": json.dumps(wl.get("weather") or {}),
        "fire_behavior": json.dumps(wl.get("fire_behavior") or {}),
        "peso_losses": json.dumps(wl.get("peso_losses") or {}),
        "casualties": json.dumps(wl.get("casualties") or {}),
        "narration": wl.get("narration") or "",
        "problems_encountered": json.dumps(wl.get("problems_encountered") or []),
        "recommendations": json.dumps(wl.get("recommendations") or []),
        "prepared_by": wl.get("prepared_by") or "",
        "prepared_by_title": wl.get("prepared_by_title") or "",
        "noted_by": wl.get("noted_by") or "",
        "noted_by_title": wl.get("noted_by_title") or "",
    }

    iwa_row = db.execute(
        text("""
            INSERT INTO wims.incident_wildland_afor (
                incident_id, import_batch_id, source,
                call_received_at, fire_started_at, fire_arrival_at, fire_controlled_at,
                caller_transmitted_by, caller_office_address, call_received_by_personnel,
                engine_dispatched, incident_location_description, distance_to_fire_station_km,
                primary_action_taken, assistance_combined_summary,
                buildings_involved, buildings_threatened, ownership_and_property_notes,
                total_area_burned_display, total_area_burned_hectares, wildland_fire_type,
                area_type_summary, causes_and_ignition_factors, suppression_factors,
                weather, fire_behavior, peso_losses, casualties,
                narration, problems_encountered, recommendations,
                prepared_by, prepared_by_title, noted_by, noted_by_title
            ) VALUES (
                :incident_id, :batch_id, :source,
                CAST(:call_received_at AS timestamptz),
                CAST(:fire_started_at AS timestamptz),
                CAST(:fire_arrival_at AS timestamptz),
                CAST(:fire_controlled_at AS timestamptz),
                :caller_transmitted_by, :caller_office_address, :call_received_by_personnel,
                :engine_dispatched, :incident_location_description, :distance_to_fire_station_km,
                :primary_action_taken, :assistance_combined_summary,
                :buildings_involved, :buildings_threatened, :ownership_and_property_notes,
                :total_area_burned_display, :total_area_burned_hectares, :wildland_fire_type,
                CAST(:area_type_summary AS jsonb), CAST(:causes_and_ignition_factors AS jsonb),
                CAST(:suppression_factors AS jsonb),
                CAST(:weather AS jsonb), CAST(:fire_behavior AS jsonb),
                CAST(:peso_losses AS jsonb), CAST(:casualties AS jsonb),
                :narration, CAST(:problems_encountered AS jsonb), CAST(:recommendations AS jsonb),
                :prepared_by, :prepared_by_title, :noted_by, :noted_by_title
            )
            RETURNING incident_wildland_afor_id
        """),
        params,
    ).fetchone()

    if not iwa_row:
        return

    iwa_id = iwa_row[0]

    for order, a in enumerate(alarm_statuses):
        status = (a.get("alarm_status") or "").strip()
        if status not in _WILDLAND_ALARM_STATUS_ALLOWED:
            continue
        db.execute(
            text("""
                INSERT INTO wims.wildland_afor_alarm_statuses (
                    incident_wildland_afor_id, sort_order, alarm_status, time_declared, ground_commander
                ) VALUES (
                    :iwa_id, :sort_order, :alarm_status, :time_declared, :ground_commander
                )
            """),
            {
                "iwa_id": iwa_id,
                "sort_order": order,
                "alarm_status": status,
                "time_declared": a.get("time_declared") or "",
                "ground_commander": a.get("ground_commander") or "",
            },
        )

    for order, row in enumerate(assistance_rows):
        org = (row.get("organization_or_unit") or row.get("organization") or "").strip()
        if not org:
            continue
        db.execute(
            text("""
                INSERT INTO wims.wildland_afor_assistance_rows (
                    incident_wildland_afor_id, sort_order, organization_or_unit, detail
                ) VALUES (
                    :iwa_id, :sort_order, :organization_or_unit, :detail
                )
            """),
            {
                "iwa_id": iwa_id,
                "sort_order": order,
                "organization_or_unit": org,
                "detail": row.get("detail") or "",
            },
        )


def _extract_row_match_fields(row_data: dict[str, Any], form_kind: AforFormKind) -> dict[str, Any]:
    """Extract the fields used for duplicate matching from one parsed row.

    Returns a dict with: alarm_level, general_category, notification_dt (date), fire_station_name.
    Missing values are returned as None — only present fields participate in match counting.
    """
    if form_kind == "WILDLAND_AFOR":
        wl = row_data.get("wildland") or {}
        notification_dt = wl.get("call_received_at") or wl.get("incident_date")
        return {
            "alarm_level": wl.get("alarm_level"),
            "general_category": "WILDLAND",
            "notification_dt": str(notification_dt)[:10] if notification_dt else None,
            "fire_station_name": wl.get("fire_station_name") or wl.get("station_name"),
        }
    ns = row_data.get("incident_nonsensitive_details") or {}
    notification_dt = ns.get("notification_dt")
    return {
        "alarm_level": (ns.get("alarm_level") or "").strip() or None,
        "general_category": _normalize_general_category(ns.get("general_category", "") or "")
        or None,
        "notification_dt": str(notification_dt)[:10] if notification_dt else None,
        "fire_station_name": (ns.get("fire_station_name") or "").strip() or None,
    }


def _find_duplicates(
    db: Session,
    rows: list[dict[str, Any]],
    region_id: int,
    lon: float,
    lat: float,
    form_kind: AforFormKind,
) -> list[dict[str, Any]]:
    """M4-D: For each incoming row, find existing fire_incidents within 1km that
    match on at least DUPLICATE_MIN_MATCHING_FIELDS fields. Returns one entry per
    duplicate row with the matched incident_id, distance, and matched fields.
    """
    duplicates: list[dict[str, Any]] = []

    candidates = db.execute(
        text("""
            SELECT
                fi.incident_id,
                ST_Distance(
                    fi.location::geography,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                ) AS distance_m,
                nd.alarm_level,
                nd.general_category,
                nd.notification_dt,
                nd.fire_station_name
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :region_id
              AND fi.is_archived = FALSE
              AND fi.verification_status != 'REJECTED'
              AND ST_DWithin(
                  fi.location::geography,
                  ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                  :radius
              )
        """),
        {"lon": lon, "lat": lat, "region_id": region_id, "radius": DUPLICATE_RADIUS_METERS},
    ).fetchall()

    if not candidates:
        return duplicates

    for row_index, row_data in enumerate(rows):
        incoming = _extract_row_match_fields(row_data, form_kind)
        best_match: dict[str, Any] | None = None
        for cand in candidates:
            cand_existing = {
                "alarm_level": cand[2],
                "general_category": cand[3],
                "notification_dt": str(cand[4])[:10] if cand[4] else None,
                "fire_station_name": cand[5],
            }
            matched_fields: list[str] = []
            for key, incoming_val in incoming.items():
                cand_val = cand_existing.get(key)
                if (
                    incoming_val is not None
                    and cand_val is not None
                    and str(incoming_val).strip().lower() == str(cand_val).strip().lower()
                ):
                    matched_fields.append(key)
            if len(matched_fields) >= DUPLICATE_MIN_MATCHING_FIELDS:
                if best_match is None or len(matched_fields) > len(best_match["matched_fields"]):
                    best_match = {
                        "row_index": row_index,
                        "existing_incident_id": cand[0],
                        "distance_m": float(cand[1]) if cand[1] is not None else 0.0,
                        "matched_fields": matched_fields,
                        "incoming_values": incoming,
                        "existing_values": cand_existing,
                    }
        if best_match is not None:
            duplicates.append(best_match)

    return duplicates


def commit_afor_import_command(
    db: Session,
    user: dict[str, Any],
    body: AforCommitRequest,
    raw_body: dict[str, Any],
    deps: AforCommitDependencies,
) -> dict[str, Any]:
    """Commit validated AFOR rows to the database."""
    lon, lat = _wgs84_pair_from_raw(raw_body.get("latitude"), raw_body.get("longitude"))

    region_id = user["assigned_region_id"]
    user_id = user["user_id"]

    if not body.rows:
        raise HTTPException(status_code=400, detail="No rows to commit")

    for row_data in body.rows:
        rk = row_data.get("_form_kind")
        if rk != body.form_kind:
            raise HTTPException(
                status_code=400,
                detail="form_kind mismatch: preview rows do not match commit form_kind",
            )

    validated_wildland_rows: list[dict[str, Any]] | None = None
    if body.form_kind == "WILDLAND_AFOR":
        wildland_errors: list[str] = []
        validated_wildland_rows = []
        for idx, row_data in enumerate(body.rows):
            wl_dict = row_data.get("wildland") or {}
            parsed = parse_wildland_afor_report_data(wl_dict, region_id)
            if parsed.status != "VALID":
                for err in parsed.errors:
                    wildland_errors.append(f"Row {idx + 1}: {err}")
            else:
                validated_wildland_rows.append(parsed.data)
        if wildland_errors:
            raise HTTPException(status_code=400, detail=" ".join(wildland_errors))

    # ── M4-D: Multi-factor duplicate pre-check ───────────────────────────────
    # First call (resolutions=None): scan; if duplicates found, return without inserting.
    # Second call (resolutions=[...]): apply per-row decisions (skip/merge/force).
    if body.resolutions is None:
        duplicates = _find_duplicates(db, body.rows, region_id, lon, lat, body.form_kind)
        if duplicates:
            return {
                "status": "DUPLICATE_CHECK_REQUIRED",
                "duplicates": duplicates,
                "radius_meters": DUPLICATE_RADIUS_METERS,
                "min_matching_fields": DUPLICATE_MIN_MATCHING_FIELDS,
            }

    # Build the resolution map keyed by row_index for fast lookup.
    resolution_map: dict[int, RowResolution] = {}
    if body.resolutions:
        for r in body.resolutions:
            resolution_map[r.row_index] = r

    # Create import batch
    batch_row = db.execute(
        text("""
            INSERT INTO wims.data_import_batches (region_id, uploaded_by, record_count)
            VALUES (:region_id, CAST(:uid AS uuid), :count)
            RETURNING batch_id
        """),
        {"region_id": region_id, "uid": user_id, "count": len(body.rows)},
    ).fetchone()

    if not batch_row:
        raise HTTPException(status_code=500, detail="Failed to create import batch")

    batch_id = batch_row[0]
    incident_ids: list[int] = []

    wildland_source: WildlandRowSource = (
        "MANUAL" if body.wildland_row_source == "MANUAL" else "AFOR_IMPORT"
    )

    def _group_total(groups: dict[str, Any], key: str) -> int:
        bucket = groups.get(key, {}) if isinstance(groups, dict) else {}
        return _safe_int(bucket.get("m")) + _safe_int(bucket.get("f"))

    for idx, row_data in enumerate(body.rows):
        # M4-D: skip rows the encoder explicitly chose to skip
        resolution = resolution_map.get(idx)
        if resolution is not None and resolution.action == "skip":
            continue

        if body.form_kind == "WILDLAND_AFOR":
            assert validated_wildland_rows is not None
            _commit_wildland_afor_row(
                db,
                validated_wildland_rows[idx],
                batch_id,
                user_id,
                region_id,
                incident_ids,
                lon,
                lat,
                source=wildland_source,
            )
            continue

        # M4-D: merge into existing incident — UPDATE rather than INSERT
        if resolution is not None and resolution.action == "merge":
            if resolution.existing_incident_id is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Row {idx}: merge action requires existing_incident_id",
                )
            existing_id = resolution.existing_incident_id
            ns_merge = row_data.get("incident_nonsensitive_details", {}) or {}
            db.execute(
                text("""
                    UPDATE wims.incident_nonsensitive_details SET
                        notification_dt = COALESCE(CAST(:notification_dt AS timestamptz), notification_dt),
                        alarm_level = COALESCE(NULLIF(:alarm_level, ''), alarm_level),
                        general_category = COALESCE(NULLIF(:general_category, ''), general_category),
                        sub_category = COALESCE(NULLIF(:sub_category, ''), sub_category),
                        fire_station_name = COALESCE(NULLIF(:fire_station_name, ''), fire_station_name),
                        structures_affected = COALESCE(:structures_affected, structures_affected),
                        households_affected = COALESCE(:households_affected, households_affected),
                        individuals_affected = COALESCE(:individuals_affected, individuals_affected),
                        families_affected = COALESCE(:families_affected, families_affected)
                    WHERE incident_id = :iid
                """),
                {
                    "iid": existing_id,
                    "notification_dt": ns_merge.get("notification_dt"),
                    "alarm_level": ns_merge.get("alarm_level", "") or "",
                    "general_category": _normalize_general_category(
                        ns_merge.get("general_category", "") or ""
                    )
                    or "",
                    "sub_category": ns_merge.get("sub_category", "") or "",
                    "fire_station_name": ns_merge.get("fire_station_name", "") or "",
                    "structures_affected": ns_merge.get("structures_affected"),
                    "households_affected": ns_merge.get("households_affected"),
                    "individuals_affected": ns_merge.get("individuals_affected"),
                    "families_affected": ns_merge.get("families_affected"),
                },
            )
            db.execute(
                text("UPDATE wims.fire_incidents SET updated_at = now() WHERE incident_id = :iid"),
                {"iid": existing_id},
            )
            incident_ids.append(existing_id)
            continue

        ns = row_data.get("incident_nonsensitive_details", {})
        sens = row_data.get("incident_sensitive_details", {})
        casualty_details = (
            sens.get("casualty_details", {})
            if isinstance(sens.get("casualty_details", {}), dict)
            else {}
        )
        injured_groups = (
            casualty_details.get("injured", {})
            if isinstance(casualty_details.get("injured", {}), dict)
            else {}
        )
        fatal_groups = (
            casualty_details.get("fatalities", {}) or casualty_details.get("fatal", {}) or {}
        )

        inc_row = db.execute(
            text("""
                INSERT INTO wims.fire_incidents
                    (import_batch_id, encoder_id, region_id, location, verification_status)
                VALUES
                    (:batch_id, CAST(:uid AS uuid), :region_id,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                     'DRAFT')
                RETURNING incident_id
            """),
            {
                "batch_id": batch_id,
                "uid": user_id,
                "region_id": region_id,
                "lon": lon,
                "lat": lat,
            },
        ).fetchone()

        if not inc_row:
            continue

        incident_id = inc_row[0]
        incident_ids.append(incident_id)

        city_text = row_data.get("_city_text", "")
        geo_ids = db.execute(
            text("""
                SELECT c.city_id
                FROM wims.ref_cities c
                WHERE LOWER(c.city_name) = LOWER(:city)
                LIMIT 1
            """),
            {"city": city_text},
        ).fetchone()
        city_id = geo_ids[0] if geo_ids else None

        db.execute(
            text("""
                INSERT INTO wims.incident_nonsensitive_details (
                    incident_id, city_id, distance_from_station_km, notification_dt,
                    alarm_level, general_category, sub_category,
                    civilian_injured, civilian_deaths, firefighter_injured, firefighter_deaths,
                    families_affected, responder_type, fire_origin, extent_of_damage,
                    structures_affected, households_affected, individuals_affected,
                    resources_deployed, alarm_timeline, problems_encountered, recommendations,
                    fire_station_name, total_response_time_minutes, total_gas_consumed_liters,
                    stage_of_fire, extent_total_floor_area_sqm, extent_total_land_area_hectares,
                    vehicles_affected, province_district, city_municipality, barangay,
                    extent_description, extent_objects_count,
                    general_description_of_involved
                ) VALUES (
                    :incident_id, :city_id, :distance_from_station_km, CAST(:notification_dt AS timestamptz),
                    :alarm_level, :general_category, :sub_category,
                    :civ_inj, :civ_fat, :ff_inj, :ff_fat,
                    :families_affected, :responder_type, :fire_origin, :extent_of_damage,
                    :structures_affected, :households_affected, :individuals_affected,
                    CAST(:resources_deployed AS jsonb), CAST(:alarm_timeline AS jsonb),
                    CAST(:problems_encountered AS jsonb), :recommendations,
                    :fire_station_name, :total_response_time_minutes, :total_gas_consumed_liters,
                    :stage_of_fire, :floor_area, :land_area, :vehicles_affected,
                    :province_district, :city_municipality, :barangay,
                    :extent_description, :extent_objects_count,
                    :general_description_of_involved
                )
            """),
            {
                "incident_id": incident_id,
                "city_id": city_id,
                "distance_from_station_km": ns.get("distance_from_station_km"),
                "notification_dt": ns.get("notification_dt"),
                "alarm_level": ns.get("alarm_level", ""),
                "general_category": _normalize_general_category(
                    ns.get("general_category", "") or ""
                ),
                "sub_category": ns.get("sub_category", ""),
                "civ_inj": _group_total(injured_groups, "civilian"),
                "civ_fat": _group_total(fatal_groups, "civilian"),
                "ff_inj": _group_total(injured_groups, "firefighter"),
                "ff_fat": _group_total(fatal_groups, "firefighter"),
                "families_affected": ns.get("families_affected", 0),
                "responder_type": ns.get("responder_type", ""),
                "fire_origin": ns.get("fire_origin", ""),
                "extent_of_damage": ns.get("extent_of_damage", ""),
                "structures_affected": ns.get("structures_affected", 0),
                "households_affected": ns.get("households_affected", 0),
                "individuals_affected": ns.get("individuals_affected", 0),
                "resources_deployed": json.dumps(ns.get("resources_deployed", {})),
                "alarm_timeline": json.dumps(ns.get("alarm_timeline", {})),
                "problems_encountered": json.dumps(ns.get("problems_encountered", [])),
                "recommendations": ns.get("recommendations", ""),
                "fire_station_name": ns.get("fire_station_name", ""),
                "total_response_time_minutes": ns.get("total_response_time_minutes", 0),
                "total_gas_consumed_liters": ns.get("total_gas_consumed_liters", 0),
                "stage_of_fire": ns.get("stage_of_fire", ""),
                "floor_area": ns.get("extent_total_floor_area_sqm", 0),
                "land_area": ns.get("extent_total_land_area_hectares", 0),
                "vehicles_affected": ns.get("vehicles_affected", 0),
                "province_district": row_data.get("_province_text", ""),
                "city_municipality": row_data.get("_city_text", ""),
                "barangay": row_data.get("_barangay_text", ""),
                "extent_description": ns.get("extent_description") or None,
                "extent_objects_count": ns.get("extent_objects_count"),
                "general_description_of_involved": (ns.get("_response") or {}).get(
                    "general_description_of_involved"
                )
                or ns.get("general_description_of_involved")
                or None,
            },
        )

        # ── Encrypt sensitive fields before INSERT ──────────────────────────────
        # Sensitive fields (caller_name, caller_number, owner_name, occupant_name,
        # narrative_report, casualty_details, estimated_damage_php) are stored
        # ONLY in the encrypted blob. Plaintext columns are set to NULL.
        # receiver_name is NOT encrypted (public / internal use only).
        #
        # caller_info arrives as "Name / Number" at the top-level row_data field;
        # owner_name / occupant_name arrive in sens (incident_sensitive_details body).
        ci = str(row_data.get("caller_info") or "").strip()
        caller_name_row, caller_number_row = "", ""

        if ci:
            if "/" in ci:
                left, right = ci.split("/", 1)
                caller_name_row = left.strip()
                caller_number_row = right.strip()
            else:
                caller_name_row = ci

        pii_for_blob = {
            k: v
            for k, v in (
                ("caller_name", caller_name_row),
                ("caller_number", caller_number_row),
                ("owner_name", sens.get("owner_name")),
                ("occupant_name", sens.get("occupant_name")),
                ("narrative_report", sens.get("narrative_report")),
                ("casualty_details", casualty_details if casualty_details else None),
                ("estimated_damage_php", ns.get("estimated_damage_php")),
            )
            if v  # omit None and empty strings/empty dicts
        }
        aad = f"incident_id:{incident_id}".encode("utf-8")
        nonce_b64: str | None = None
        ct_b64: str | None = None
        try:
            sp = deps.get_security_provider()
            nonce_b64, ct_b64 = sp.encrypt_json(pii_for_blob, aad)
            crypto_provider_val = getattr(sp, "crypto_provider", "env_aesgcm")
            kms_key_name_val = getattr(sp, "kms_key_name", None)
            enc_iv = nonce_b64 if crypto_provider_val == "env_aesgcm" else None
        except SecurityProviderError as exc:
            logger.warning(
                "PII encryption unavailable for incident_id=%s during AFOR commit; proceeding without encrypted blob (%s)",
                incident_id,
                exc,
            )
            crypto_provider_val = "env_aesgcm"
            kms_key_name_val = None
            enc_iv = None

        db.execute(
            text("""
                INSERT INTO wims.incident_sensitive_details (
                    incident_id, street_address, landmark,
                    caller_name, caller_number, receiver_name,
                    owner_name, establishment_name,
                    narrative_report, disposition,
                    disposition_prepared_by, disposition_noted_by,
                    prepared_by_officer, noted_by_officer,
                    personnel_on_duty, other_personnel, casualty_details,
                    is_icp_present, icp_location,
                    pii_blob_enc, encryption_iv,
                    crypto_provider, kms_key_name
                ) VALUES (
                    :incident_id, :street_address, :landmark,
                    NULL, NULL, :receiver_name,
                    NULL, :establishment_name,
                    NULL, :disposition,
                    :disposition_prepared_by, :disposition_noted_by,
                    :prepared_by_officer, :noted_by_officer,
                    CAST(:personnel_on_duty AS jsonb),
                    CAST(:other_personnel AS jsonb),
                    NULL::jsonb,
                    :is_icp_present, :icp_location,
                    :pii_blob_enc, :pii_nonce,
                    :crypto_provider, :kms_key_name
                )
            """),
            {
                "incident_id": incident_id,
                "street_address": sens.get("street_address", ""),
                "landmark": sens.get("landmark", ""),
                # Plaintext PII columns → NULL; only pii_blob_enc is authoritative
                "receiver_name": sens.get("receiver_name", ""),
                "establishment_name": sens.get("establishment_name", ""),
                # narrative_report → encrypted in blob; plaintext column NULL
                # casualty_details → encrypted in blob; plaintext column NULL
                "disposition": sens.get("disposition", ""),
                "disposition_prepared_by": sens.get("disposition_prepared_by", ""),
                "disposition_noted_by": sens.get("disposition_noted_by", ""),
                "prepared_by_officer": sens.get("prepared_by_officer", ""),
                "noted_by_officer": sens.get("noted_by_officer", ""),
                "personnel_on_duty": json.dumps(sens.get("personnel_on_duty", {})),
                "other_personnel": json.dumps(sens.get("other_personnel", [])),
                # casualty_details param removed — now in encrypted blob
                "is_icp_present": sens.get("is_icp_present", False),
                "icp_location": sens.get("icp_location", ""),
                # Encrypted PII blob
                "pii_blob_enc": ct_b64,
                "pii_nonce": enc_iv,
                "crypto_provider": crypto_provider_val,
                "kms_key_name": kms_key_name_val,
            },
        )

        responding_unit = row_data.get("responding_unit", {})
        if any(
            responding_unit.get(key)
            for key in (
                "station_name",
                "engine_number",
                "dispatch_dt",
                "arrival_dt",
                "return_dt",
            )
        ):
            db.execute(
                text("""
                    INSERT INTO wims.responding_units (
                        incident_id, station_name, engine_number, responder_type,
                        dispatch_dt, arrival_dt, return_dt
                    ) VALUES (
                        :incident_id, :station_name, :engine_number, :responder_type,
                        CAST(:dispatch_dt AS timestamptz),
                        CAST(:arrival_dt AS timestamptz),
                        CAST(:return_dt AS timestamptz)
                    )
                """),
                {
                    "incident_id": incident_id,
                    "station_name": responding_unit.get("station_name", ""),
                    "engine_number": responding_unit.get("engine_number", ""),
                    "responder_type": responding_unit.get("responder_type", ""),
                    "dispatch_dt": responding_unit.get("dispatch_dt"),
                    "arrival_dt": responding_unit.get("arrival_dt"),
                    "return_dt": responding_unit.get("return_dt"),
                },
            )

        for extra_eng in row_data.get("_extra_engines", []):
            if any(extra_eng.get(k) for k in ("engine_number", "dispatch_dt", "arrival_dt")):
                db.execute(
                    text("""
                        INSERT INTO wims.responding_units (
                            incident_id, station_name, engine_number, responder_type,
                            dispatch_dt, arrival_dt, return_dt
                        ) VALUES (
                            :incident_id, :station_name, :engine_number, :responder_type,
                            CAST(:dispatch_dt AS timestamptz),
                            CAST(:arrival_dt AS timestamptz),
                            CAST(:return_dt AS timestamptz)
                        )
                    """),
                    {
                        "incident_id": incident_id,
                        "station_name": extra_eng.get("station_name", ""),
                        "engine_number": extra_eng.get("engine_number", ""),
                        "responder_type": extra_eng.get("responder_type", ""),
                        "dispatch_dt": extra_eng.get("dispatch_dt"),
                        "arrival_dt": extra_eng.get("arrival_dt"),
                        "return_dt": extra_eng.get("return_dt"),
                    },
                )

        deps.insert_incident_verification_history(
            db,
            incident_id=incident_id,
            actor_user_id=str(user_id),
            previous_status="DRAFT",
            new_status="DRAFT",
            notes="Imported via XLSX",
            action_label="CREATED_DRAFT",
        )

    db.commit()

    # Sync analytics read model (only VERIFIED non-archived will appear in facts)
    sync_incidents_batch(db, incident_ids)
    db.commit()

    return {
        "status": "ok",
        "batch_id": batch_id,
        "incident_ids": incident_ids,
        "total_committed": len(incident_ids),
    }
