"""Reference data endpoints (regions, provinces, cities, fire stations)."""

import json
import math
import os
import redis
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from database import get_db, get_db_with_rls

router = APIRouter(prefix="/api/ref", tags=["ref"])


@router.get("/regions")
def get_regions(
    _user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    region_id: Optional[int] = Query(None),
):
    """Return ref_regions. Optional region_id filter."""
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
    # Support single province_id
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


@router.get("/emergency-services")
def get_emergency_services(
    db: Annotated[Session, Depends(get_db)],
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
):
    """
    Returns public emergency number and BFP station names/locations.
    """
    cache_key = "wims:ref:emergency-services:v1:all"
    redis_client = None
    cached_payload = None
    try:
        redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)
        cached = redis_client.get(cache_key)
        if cached:
            cached_payload = json.loads(cached)
    except Exception:
        pass

    if cached_payload is None:
        try:
            rows = db.execute(
                text("""
                    SELECT
                        station_id, station_name,
                        ST_Y(location::geometry) AS latitude,
                        ST_X(location::geometry) AS longitude
                    FROM wims.ref_fire_stations
                    ORDER BY station_name ASC
                """),
            ).fetchall()

            stations = [
                {
                    "station_id": r[0],
                    "station_name": r[1],
                    "latitude": float(r[2]),
                    "longitude": float(r[3]),
                    "distance_m": None,
                }
                for r in rows
            ]
            cached_payload = {"stations": stations}
            try:
                if redis_client:
                    redis_client.setex(cache_key, 86_400, json.dumps(cached_payload))
                    redis_client.setex(f"{cache_key}:stale", 604_800, json.dumps(cached_payload))
            except Exception:
                pass
        except Exception:
            cached_payload = {"stations": []}

    stations = list(cached_payload.get("stations", []))
    degraded = False
    stale = False

    if not stations:
        try:
            stale_cached = redis_client.get(f"{cache_key}:stale") if redis_client else None
            if stale_cached:
                stations = json.loads(stale_cached).get("stations", [])
                stale = True
            else:
                degraded = True
        except Exception:
            degraded = True

    nearest_station_ids: list[int] = []
    if lat is not None and lon is not None and stations:
        def distance_m(station: dict) -> float:
            station_lat = float(station["latitude"])
            station_lon = float(station["longitude"])
            radius = 6_371_000
            dlat = math.radians(station_lat - lat)
            dlon = math.radians(station_lon - lon)
            a = (
                math.sin(dlat / 2) ** 2
                + math.cos(math.radians(lat))
                * math.cos(math.radians(station_lat))
                * math.sin(dlon / 2) ** 2
            )
            return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        stations = [
            {**station, "distance_m": distance_m(station)}
            for station in stations
        ]
        stations.sort(key=lambda station: station["distance_m"])
        nearest_station_ids = [int(station["station_id"]) for station in stations[:5]]

    response_data = {
        "emergency_number": "911",
        "nearest_station_ids": nearest_station_ids,
        "stations": stations,
        "stale": stale,
        "degraded": degraded,
    }

    return response_data
