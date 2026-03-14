"""Zero-Trust Civilian Reporting Portal — public, no auth."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.civilian import CivilianReportCreate, CivilianReportResponse

router = APIRouter(prefix="/api/civilian", tags=["civilian"])


@router.post("/reports", response_model=CivilianReportResponse, status_code=201)
def submit_civilian_report(
    body: CivilianReportCreate,
    db: Annotated[Session, Depends(get_db)],
) -> CivilianReportResponse:
    """
    Public endpoint: submit emergency report with no auth.
    Zero-trust: trust_score is always 0 for unauthenticated submissions.
    """
    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"

    result = db.execute(
        text("""
            INSERT INTO wims.citizen_reports (location, description, status, trust_score)
            VALUES (ST_GeogFromText(:wkt), :description, 'PENDING', 0)
            RETURNING report_id, location, status, trust_score, created_at
        """),
        {"wkt": wkt, "description": body.description},
    )
    row = result.fetchone()
    db.commit()

    if row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="Failed to create report")

    report_id = row[0]
    coord_row = db.execute(
        text(
            "SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon "
            "FROM wims.citizen_reports WHERE report_id = :rid"
        ),
        {"rid": report_id},
    ).fetchone()

    lat = float(coord_row[0])
    lon = float(coord_row[1])

    return CivilianReportResponse(
        report_id=report_id,
        latitude=lat,
        longitude=lon,
        description=body.description,
        trust_score=0,
        status=row[2],
        created_at=row[4],
    )
