import hashlib
import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from database import get_db
from schemas.incident import IncidentCreate, IncidentResponse
from services.analytics_read_model import sync_incident_to_analytics

router = APIRouter(prefix="/api", tags=["incidents"])

STORAGE_DIR = "/app/storage/attachments"


@router.post("/incidents/{incident_id}/attachments", status_code=201)
async def upload_attachment(
    incident_id: int,
    file: UploadFile = File(...),
    db: Annotated[Session, Depends(get_db)] = None,
    user: Annotated[dict, Depends(get_current_wims_user)] = None,
):
    """
    Upload an attachment (e.g., photo sketch) for a specific incident.
    Saves to disk and records in wims.incident_attachments.
    """
    if not os.path.exists(STORAGE_DIR):
        os.makedirs(STORAGE_DIR, exist_ok=True)

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
    storage_path = os.path.join(STORAGE_DIR, unique_filename)

    sha256_hash = hashlib.sha256()
    try:
        with open(storage_path, "wb") as buffer:
            while content := await file.read(1024 * 1024):  # Read in chunks
                sha256_hash.update(content)
                buffer.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

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
    except Exception as e:
        db.rollback()
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    return {
        "status": "ok",
        "attachment_id": incident_id,  # Serial ID, but we don't have it immediately without RETURNING
        "message": "Attachment uploaded successfully",
    }


@router.post("/incidents", response_model=IncidentResponse, status_code=201)
def create_incident(
    body: IncidentCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[dict, Depends(get_current_wims_user)],
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
