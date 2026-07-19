"""Regional Office API — fire incident perimeter routes (#635).

NATIONAL_VALIDATOR (and SYSTEM_ADMIN) may create/update/delete perimeters and
link/unlink civilian reports. REGIONAL_ENCODER may read (GET) only.

Routes are thin: parse request → authorize → call service → marshal response.
All SQL orchestration and GeoJSON normalization live in
services/regional_incidents/perimeters.py. Geometry is passed to PostGIS as a
bound parameter (GeoJSON string) — never interpolated into SQL text.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from auth import get_current_wims_user, get_db_with_rls
from schemas.regional import (
    LinkReportsRequest,
    LinkReportsResponse,
    PerimeterCreateRequest,
    PerimeterResponse,
    PerimeterUpdateRequest,
)
from services.information_emergencies import ensure_incident_emergency_draft
from services.regional_incidents import perimeters as perimeter_service
from utils.audit import log_system_audit

router = APIRouter()

# Roles allowed to mutate perimeters / links, and roles allowed to read.
_PERIMETER_EDIT_ROLES = ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN")
_PERIMETER_READ_ROLES = ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN", "REGIONAL_ENCODER")


def _require_perimeter_editor(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """Dependency: 403 unless role may create/update/delete perimeters."""
    if current_user.get("role") not in _PERIMETER_EDIT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="NATIONAL_VALIDATOR or SYSTEM_ADMIN privileges required",
        )
    return current_user


def _require_perimeter_reader(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """Dependency: 403 unless role may read perimeters."""
    if current_user.get("role") not in _PERIMETER_READ_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Insufficient role to view fire incident perimeters",
        )
    return current_user


def _geometry_or_400(db: Session, geometry: dict) -> str:
    """Normalize + validate a request geometry; raise 400 on any problem."""
    try:
        geojson_text = perimeter_service.normalize_polygon_geojson(geometry)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid geometry: {e}") from e
    if not perimeter_service.validate_geometry_is_valid(db, geojson_text):
        raise HTTPException(status_code=400, detail="Geometry is not valid per ST_IsValid")
    return geojson_text


def _marshal(row: dict, linked: list[dict]) -> PerimeterResponse:
    return PerimeterResponse(
        geometry=row["geometry"],
        properties={
            "gis_acres": row["gis_acres"],
            "map_method": row["map_method"],
            "created_by": row["created_by"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        },
        perimeter_id=row["perimeter_id"],
        incident_id=row["incident_id"],
        gis_acres=row["gis_acres"],
        map_method=row["map_method"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        linked_reports=linked,
    )


@router.post(
    "/incidents/{incident_id}/perimeter",
    status_code=201,
    response_model=PerimeterResponse,
)
def create_perimeter(
    incident_id: int,
    body: PerimeterCreateRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_perimeter_editor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Create a fire incident perimeter (one per incident).

    409 if a perimeter already exists; 400 if geometry invalid.
    """
    if body.map_method not in perimeter_service.VALID_MAP_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid map_method: {body.map_method!r}",
        )
    geojson_text = _geometry_or_400(db, body.geometry)

    try:
        row = perimeter_service.insert_perimeter(
            db,
            incident_id=incident_id,
            geojson_text=geojson_text,
            map_method=body.map_method,
            actor_user_id=user["user_id"],
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=("A perimeter already exists for this incident. Use PUT to replace it."),
        ) from None

    linked = perimeter_service.fetch_linked_reports(db, incident_id)
    db.commit()
    log_system_audit(
        db,
        user["user_id"],
        "PERIMETER_CREATE",
        "fire_incident_perimeters",
        incident_id,
        request,
    )
    db.commit()
    return _marshal(row, linked)


@router.get(
    "/incidents/{incident_id}/perimeter",
    response_model=PerimeterResponse,
)
def get_perimeter(
    incident_id: int,
    user: Annotated[dict, Depends(_require_perimeter_reader)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Return the latest perimeter as a GeoJSON Feature with metadata + links."""
    row = perimeter_service.fetch_perimeter(db, incident_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No perimeter for this incident")
    linked = perimeter_service.fetch_linked_reports(db, incident_id)
    return _marshal(row, linked)


@router.put(
    "/incidents/{incident_id}/perimeter",
    response_model=PerimeterResponse,
)
def update_perimeter(
    incident_id: int,
    body: PerimeterUpdateRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_perimeter_editor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Replace an existing perimeter. 404 if none; 400 if geometry invalid."""
    if body.map_method not in perimeter_service.VALID_MAP_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid map_method: {body.map_method!r}",
        )
    geojson_text = _geometry_or_400(db, body.geometry)

    row = perimeter_service.update_perimeter(
        db,
        incident_id=incident_id,
        geojson_text=geojson_text,
        map_method=body.map_method,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No perimeter for this incident")

    linked = perimeter_service.fetch_linked_reports(db, incident_id)
    db.commit()
    log_system_audit(
        db,
        user["user_id"],
        "PERIMETER_UPDATE",
        "fire_incident_perimeters",
        incident_id,
        request,
    )
    db.commit()
    return _marshal(row, linked)


@router.delete(
    "/incidents/{incident_id}/perimeter",
    status_code=200,
)
def delete_perimeter(
    incident_id: int,
    request: Request,
    user: Annotated[dict, Depends(_require_perimeter_editor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Delete a perimeter (history trigger closes the history row)."""
    removed = perimeter_service.delete_perimeter(db, incident_id=incident_id)
    if not removed:
        raise HTTPException(status_code=404, detail="No perimeter for this incident")
    db.commit()
    log_system_audit(
        db,
        user["user_id"],
        "PERIMETER_DELETE",
        "fire_incident_perimeters",
        incident_id,
        request,
    )
    db.commit()
    return {"incident_id": incident_id, "deleted": True}


@router.post(
    "/incidents/{incident_id}/link-reports",
    status_code=200,
    response_model=LinkReportsResponse,
)
def link_reports(
    incident_id: int,
    body: LinkReportsRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_perimeter_editor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Link civilian reports to an incident. 404 if any report is missing."""
    try:
        linked_count = perimeter_service.link_reports(
            db,
            incident_id=incident_id,
            report_ids=body.report_ids,
            actor_user_id=user["user_id"],
        )
        ensure_incident_emergency_draft(
            db,
            incident_id=incident_id,
            actor_user_id=str(user["user_id"]),
            require_civilian_link=True,
        )
    except LookupError as e:
        db.rollback()
        missing = e.args[0]
        raise HTTPException(
            status_code=404,
            detail=f"Report(s) not found: {missing}",
        ) from None
    except Exception:
        db.rollback()
        raise

    db.commit()
    log_system_audit(
        db,
        user["user_id"],
        "PERIMETER_LINK",
        "fire_incident_civilian_links",
        incident_id,
        request,
    )
    db.commit()
    return LinkReportsResponse(incident_id=incident_id, linked_count=linked_count, removed_count=0)


@router.delete(
    "/incidents/{incident_id}/link-reports",
    status_code=200,
    response_model=LinkReportsResponse,
)
def unlink_reports(
    incident_id: int,
    body: LinkReportsRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_perimeter_editor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Unlink civilian reports from an incident."""
    removed_count = perimeter_service.unlink_reports(
        db,
        incident_id=incident_id,
        report_ids=body.report_ids,
    )
    db.commit()
    log_system_audit(
        db,
        user["user_id"],
        "PERIMETER_UNLINK",
        "fire_incident_civilian_links",
        incident_id,
        request,
    )
    db.commit()
    return LinkReportsResponse(incident_id=incident_id, linked_count=0, removed_count=removed_count)
