"""Incident geospatial intake API."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from database import get_db
from schemas.incident import IncidentCreate, IncidentResponse

router = APIRouter(prefix="/api", tags=["incidents"])


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
    region_row = db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    if region_row is None:
        raise HTTPException(status_code=500, detail="No ref_regions seed data — cannot create incident")

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
    # Extract lat/lon from PostGIS geography for response
    coord_row = db.execute(
        text("SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM wims.fire_incidents WHERE incident_id = :iid"),
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
