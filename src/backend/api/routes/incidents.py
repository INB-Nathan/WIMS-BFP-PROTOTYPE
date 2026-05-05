import hashlib
import json
import logging
import os
import uuid
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

import auth
from auth import get_current_wims_user
from database import get_db_with_rls
from schemas.incident import IncidentCreate, IncidentResponse
from services.analytics_read_model import sync_incident_to_analytics
from api.routes.regional import _normalize_general_category, _generate_reference_number

router = APIRouter(prefix="/api", tags=["incidents"])
logger = logging.getLogger("wims.incidents")

STORAGE_DIR = "/app/storage/attachments"


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
    raise HTTPException(
        status_code=500, detail="No writable attachment storage path available"
    )


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

    region_id_raw = body.get("region_id") or user.get("assigned_region_id")
    try:
        region_id = int(region_id_raw)
    except (TypeError, ValueError):
        region_row = db.execute(
            text("SELECT region_id FROM wims.ref_regions LIMIT 1")
        ).fetchone()
        if not region_row:
            raise HTTPException(status_code=500, detail="No region available")
        region_id = int(region_row[0])

    user_id = user["user_id"]

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
    incident_ids: list[int] = []

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

    for item in incidents:
        if not isinstance(item, dict):
            continue

        ns = item.get("incident_nonsensitive_details") or {}
        sens = item.get("incident_sensitive_details") or {}
        if not isinstance(ns, dict):
            ns = {}
        if not isinstance(sens, dict):
            sens = {}

        lon = _safe_float(item.get("longitude"), 0.0)
        lat = _safe_float(item.get("latitude"), 0.0)

        incident_type_code_val = (ns.get("incident_type_code") or "").strip().upper() or None
        station_code_val = (ns.get("station_code") or "TBA").strip() or "TBA"
        ref_num: str | None = None
        if incident_type_code_val:
            ref_num = _generate_reference_number(
                db, region_id, incident_type_code_val, station_code_val,
                ns.get("notification_dt"),
            )

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

        inc_row = db.execute(
            text(
                """
                INSERT INTO wims.fire_incidents
                    (import_batch_id, encoder_id, region_id, location, verification_status,
                     incident_type_code, reference_number)
                VALUES
                    (:batch_id, CAST(:uid AS uuid), :region_id,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                     'DRAFT', :incident_type_code, :reference_number)
                RETURNING incident_id
                """
            ),
            {
                "batch_id": batch_id,
                "uid": user_id,
                "region_id": region_id,
                "lon": lon,
                "lat": lat,
                "incident_type_code": incident_type_code_val,
                "reference_number": ref_num,
            },
        ).fetchone()

        if not inc_row:
            continue

        incident_id = int(inc_row[0])
        incident_ids.append(incident_id)

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
                    distance_from_station_km, station_code
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
                    :distance_from_station_km, :station_code
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
                "total_response_time_minutes": _safe_int(
                    ns.get("total_response_time_minutes")
                ),
                "total_gas_consumed_liters": _safe_float(
                    ns.get("total_gas_consumed_liters")
                ),
                "resources_deployed": json.dumps(ns.get("resources_deployed", {})),
                "alarm_timeline": json.dumps(ns.get("alarm_timeline", {})),
                "problems_encountered": json.dumps(ns.get("problems_encountered", [])),
                "recommendations": ns.get("recommendations", ""),
                "fire_station_name": ns.get("fire_station_name", ""),
                "stage_of_fire": ns.get("stage_of_fire", ""),
                "floor_area": _safe_float(ns.get("extent_total_floor_area_sqm")),
                "land_area": _safe_float(ns.get("extent_total_land_area_hectares")),
                "distance_from_station_km": _safe_float(
                    ns.get("distance_to_fire_scene_km")
                    or ns.get("distance_from_station_km")
                ),
                "station_code": station_code_val,
            },
        )

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
                    is_icp_present, icp_location
                ) VALUES (
                    :incident_id, :street_address, :landmark,
                    :caller_name, :caller_number, :receiver_name,
                    :owner_name, :establishment_name,
                    :narrative_report, :disposition,
                    :disposition_prepared_by, :disposition_noted_by,
                    CAST(:personnel_on_duty AS jsonb), CAST(:other_personnel AS jsonb), CAST(:casualty_details AS jsonb),
                    :is_icp_present, :icp_location
                )
                """
            ),
            {
                "incident_id": incident_id,
                "street_address": sens.get("street_address")
                or ns.get("incident_address")
                or "",
                "landmark": sens.get("landmark") or ns.get("nearest_landmark") or "",
                "caller_name": sens.get("caller_name", ""),
                "caller_number": sens.get("caller_number", ""),
                "receiver_name": sens.get("receiver_name", ""),
                "owner_name": sens.get("owner_name", ""),
                "establishment_name": sens.get("establishment_name", ""),
                "narrative_report": sens.get("narrative_report", ""),
                "disposition": sens.get("disposition", ""),
                "disposition_prepared_by": sens.get("prepared_by_officer")
                or sens.get("disposition_prepared_by", ""),
                "disposition_noted_by": sens.get("noted_by_officer")
                or sens.get("disposition_noted_by", ""),
                "personnel_on_duty": json.dumps(sens.get("personnel_on_duty", {})),
                "other_personnel": json.dumps(ns.get("other_personnel", [])),
                "casualty_details": json.dumps(sens.get("casualty_details", {})),
                "is_icp_present": bool(sens.get("is_icp_present", False)),
                "icp_location": sens.get("icp_location", ""),
            },
        )

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("upload-bundle commit failed")
        raise HTTPException(
            status_code=500, detail=f"upload-bundle commit failed: {type(e).__name__}"
        ) from None

    for iid in incident_ids:
        try:
            sync_incident_to_analytics(db, iid)
        except Exception:
            logger.warning("Failed to sync incident %s to analytics read model", iid)
    db.commit()

    return {
        "status": "ok",
        "batch_id": batch_id,
        "incident_ids": incident_ids,
        "message": f"Committed {len(incident_ids)} incident(s).",
    }


@router.post("/incidents/{incident_id}/attachments", status_code=201)
async def upload_attachment(
    incident_id: int,
    file: UploadFile = File(...),
    db: Annotated[Session, Depends(get_db_with_rls)] = None,
    user: Annotated[dict, Depends(get_current_wims_user)] = None,
):
    """
    Upload an attachment (e.g., photo sketch) for a specific incident.
    Saves to disk and records in wims.incident_attachments.
    """
    storage_dir = _resolve_storage_dir()

    # 1. Verify incident exists and belongs to user's region (standard isolation)
    # For now, just check existence
    incident = db.execute(
        text("SELECT incident_id FROM wims.fire_incidents WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    # 2. Save file to disk
    file_ext = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    storage_path = os.path.join(storage_dir, unique_filename)

    sha256_hash = hashlib.sha256()
    try:
        with open(storage_path, "wb") as buffer:
            while content := await file.read(1024 * 1024):  # Read in chunks
                sha256_hash.update(content)
                buffer.write(content)
    except Exception:
        logger.exception("Failed to save uploaded file")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file")

    # 3. Record in DB
    try:
        db.execute(
            text("""
                INSERT INTO wims.incident_attachments (
                    incident_id, file_name, storage_path, mime_type, file_hash_sha256, uploaded_by
                ) VALUES (
                    :iid, :fname, :path, :mime, :hash, :uid
                )
            """),
            {
                "iid": incident_id,
                "fname": file.filename,
                "path": storage_path,
                "mime": file.content_type,
                "hash": sha256_hash.hexdigest(),
                "uid": user["user_id"],
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        if os.path.exists(storage_path):
            os.remove(storage_path)
        logger.exception("Database error during attachment upload")
        raise HTTPException(status_code=500, detail="Internal server error")

    return {
        "status": "ok",
        "attachment_id": incident_id,  # Serial ID, but we don't have it immediately without RETURNING
        "message": "Attachment uploaded successfully",
    }


@router.post("/incidents", response_model=IncidentResponse, status_code=201)
def create_incident(
    body: IncidentCreate,
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
    region_row = db.execute(
        text("SELECT region_id FROM wims.ref_regions LIMIT 1")
    ).fetchone()
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
    db.commit()

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create incident")

    incident_id = row[0]
    sync_incident_to_analytics(db, incident_id)
    db.commit()

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
        encoder_id=row[2],
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
                   nd.barangay, nd.specific_type
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
                "barangay": r[16],
                "specific_type": r[17],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
