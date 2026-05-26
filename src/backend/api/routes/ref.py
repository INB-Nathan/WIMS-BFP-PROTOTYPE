"""Reference data endpoints (regions, provinces, cities, fire stations)."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from database import get_db, get_db_with_rls

router = APIRouter(prefix="/api/ref", tags=["ref"])

REGION_RESTRICTED_ROLES = {"REGIONAL_ENCODER", "NATIONAL_VALIDATOR"}


def _get_assigned_region(user: dict, db: Session) -> int | None:
    """Return assigned_region_id for roles that are region-restricted."""
    role = user.get("role", "")
    if role not in REGION_RESTRICTED_ROLES:
        return None
    row = db.execute(
        text(
            "SELECT assigned_region_id FROM wims.users "
            "WHERE user_id = CAST(:uid AS uuid)"
        ),
        {"uid": user["user_id"]},
    ).fetchone()
    return row[0] if row and row[0] else None


@router.get("/regions")
def get_regions(
    _user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    region_id: Optional[int] = Query(None),
):
    """Return ref_regions. Optional region_id filter."""
    assigned_region_id = _get_assigned_region(_user, db)
    if assigned_region_id is not None:
        region_id = assigned_region_id
    if region_id is not None:
        rows = db.execute(
            text(
                "SELECT region_id, region_name, region_code FROM wims.ref_regions WHERE region_id = :rid"
            ),
            {"rid": region_id},
        ).fetchall()
    else:
        rows = db.execute(
            text(
                "SELECT region_id, region_name, region_code FROM wims.ref_regions ORDER BY region_id"
            ),
        ).fetchall()
    return [{"region_id": r[0], "region_name": r[1], "region_code": r[2]} for r in rows]


@router.get("/provinces")
def get_provinces(
    _user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    region_id: Optional[int] = Query(None),
):
    """Return ref_provinces. Optional region_id filter."""
    assigned_region_id = _get_assigned_region(_user, db)
    if assigned_region_id is not None:
        region_id = assigned_region_id
    if region_id is not None:
        rows = db.execute(
            text(
                "SELECT province_id, province_name, region_id FROM wims.ref_provinces WHERE region_id = :rid ORDER BY province_name"
            ),
            {"rid": region_id},
        ).fetchall()
    else:
        rows = db.execute(
            text(
                "SELECT province_id, province_name, region_id FROM wims.ref_provinces ORDER BY province_name"
            ),
        ).fetchall()
    return [{"province_id": r[0], "province_name": r[1], "region_id": r[2]} for r in rows]


@router.get("/cities")
def get_cities(
    _user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    province_id: Optional[int] = Query(None),
    province_ids: Optional[str] = Query(None),
):
    """Return ref_cities. Optional province_id or comma-separated province_ids filter."""
    assigned_region_id = _get_assigned_region(_user, db)
    if assigned_region_id is not None:
        province_ids_allowed = [
            r[0] for r in db.execute(
                text("SELECT province_id FROM wims.ref_provinces WHERE region_id = :rid"),
                {"rid": assigned_region_id}
            ).fetchall()
        ]
        if province_id is not None:
            if province_id not in province_ids_allowed:
                return []
        elif province_ids:
            ids = [int(x) for x in province_ids.split(",") if x.strip().isdigit()]
            ids = [i for i in ids if i in province_ids_allowed]
            if not ids:
                return []
            province_ids = ",".join(str(i) for i in ids)
        else:
            province_ids = ",".join(str(i) for i in province_ids_allowed)
    if province_id is not None:
        rows = db.execute(
            text(
                "SELECT city_id, city_name, province_id FROM wims.ref_cities WHERE province_id = :pid ORDER BY city_name"
            ),
            {"pid": province_id},
        ).fetchall()
    # Support comma-separated province_ids param (e.g. "1,2,3")
    elif province_ids:
        # sanitize and parse ints
        ids = [int(x) for x in province_ids.split(",") if x.strip().isdigit()]
        if not ids:
            return []
        q = text(
            "SELECT city_id, city_name, province_id FROM wims.ref_cities WHERE province_id IN ("
            + ",".join([str(i) for i in ids])
            + ") ORDER BY city_name"
        )
        rows = db.execute(q).fetchall()
    else:
        rows = db.execute(
            text("SELECT city_id, city_name, province_id FROM wims.ref_cities ORDER BY city_name"),
        ).fetchall()
    return [{"city_id": r[0], "city_name": r[1], "province_id": r[2]} for r in rows]


@router.get("/fire-stations")
def get_fire_stations(
    db: Annotated[Session, Depends(get_db)],
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
):
    """
    Return BFP fire stations. No auth — called from the public civilian portal.
    If lat+lon provided: nearest 5 within 5 km ordered by distance.
    Falls back to all stations sorted by name when coords are absent or no results found.
    """
    if lat is not None and lon is not None:
        rows = db.execute(
            text("""
                SELECT
                    station_id, station_name, address,
                    ST_Y(location::geometry) AS latitude,
                    ST_X(location::geometry) AS longitude,
                    ST_Distance(location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS distance_m
                FROM wims.ref_fire_stations
                WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, 5000)
                ORDER BY distance_m ASC
                LIMIT 5
            """),
            {"lat": lat, "lon": lon},
        ).fetchall()

        if rows:
            return [
                {
                    "station_id": r[0],
                    "station_name": r[1],
                    "address": r[2],
                    "latitude": float(r[3]),
                    "longitude": float(r[4]),
                    "distance_m": float(r[5]),
                }
                for r in rows
            ]

    # Fallback: all stations sorted by name (no proximity data)
    rows = db.execute(
        text("""
            SELECT
                station_id, station_name, address,
                ST_Y(location::geometry) AS latitude,
                ST_X(location::geometry) AS longitude
            FROM wims.ref_fire_stations
            ORDER BY station_name ASC
        """),
    ).fetchall()

    return [
        {
            "station_id": r[0],
            "station_name": r[1],
            "address": r[2],
            "latitude": float(r[3]),
            "longitude": float(r[4]),
            "distance_m": None,
        }
        for r in rows
    ]
