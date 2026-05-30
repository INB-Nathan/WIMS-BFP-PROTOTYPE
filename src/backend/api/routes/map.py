"""Public map routes — cluster API, emergency services, stale-if-error cache.

Security domain: PUBLIC (no auth). These endpoints serve the anonymous
civilian-facing map. Fail-closed on misconfiguration.
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from typing import Annotated, Any

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
import auth

router = APIRouter(prefix="/api/public", tags=["public-map"])

logger = logging.getLogger("wims.map")

# ---------------------------------------------------------------------------
# Redis connection (lazy, shared with main.py pattern)
# ---------------------------------------------------------------------------
_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

_REDIS_POOL: aioredis.Redis | None = None
_REDIS_CLUSTER_TTL = 120  # 2 minutes
_REDIS_EMERGENCY_TTL = 300  # 5 minutes
_REDIS_POOL_SIZE = 5
_REDIS_POOL_MAX_CONNECTIONS = 10


async def _get_redis() -> aioredis.Redis | None:
    """Return a lazy Redis connection. Returns None if Redis is unreachable."""
    global _REDIS_POOL  # noqa: PLW0603
    if _REDIS_POOL is None:
        try:
            _REDIS_POOL = aioredis.from_url(
                _REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
                health_check_interval=30,
            )
            await _REDIS_POOL.ping()
        except Exception:
            logger.warning("Redis unreachable — public map cache disabled")
            _REDIS_POOL = None  # type: ignore[assignment]
    return _REDIS_POOL


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _grid_size_for_zoom(zoom: int) -> float:
    """Return grid cell size in degrees for a given zoom level.

    Higher zoom = smaller grid cells = more precise clusters.
    The formula 360 / (2^zoom * 10) gives a reasonable trade-off:
      zoom 4  -> ~2.25 deg  (large regions)
      zoom 8  -> ~0.14 deg  (metro areas)
      zoom 12 -> ~0.009 deg (neighbourhoods)
      zoom 16 -> ~0.0005 deg (street level)
    """
    return 360.0 / (math.pow(2.0, zoom) * 10.0)


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class ClusterItem(BaseModel):
    lat: float
    lng: float
    count: int
    severity: str
    latest_at: str | None = None


class ClusterResponse(BaseModel):
    clusters: list[ClusterItem]
    cached_at: str | None = None


# ---------------------------------------------------------------------------
# GET /api/public/clusters — civilian pressure report areas for the public map
# ---------------------------------------------------------------------------
@router.get("/clusters", response_model=ClusterResponse)
async def get_incident_clusters(
    request: Request,
    sw_lat: Annotated[float, Query(ge=-90, le=90, description="South-west corner latitude")],
    sw_lng: Annotated[float, Query(ge=-180, le=180, description="South-west corner longitude")],
    ne_lat: Annotated[float, Query(ge=-90, le=90, description="North-east corner latitude")],
    ne_lng: Annotated[float, Query(ge=-180, le=180, description="North-east corner longitude")],
    zoom: Annotated[
        int, Query(ge=4, le=18, description="Map zoom level for cluster granularity")
    ] = 10,
    db: Annotated[Session, Depends(get_db)] = None,
):
    """Return clustered civilian pressure report areas for the public map.

    Privacy contract: these are anonymous citizen reports *only*, NOT BFP-confirmed
    incidents. Queries wims.citizen_reports (public signal records), excludes
    rejected/triaged reports, and returns area-level aggregates — never individual
    reports or personally identifiable information.

    Uses PostGIS ST_SnapToGrid for server-side clustering. Zoom controls
    grid cell size — higher zoom = smaller cells = more precise clusters.
    Responses cached in Redis for 2 minutes.
    """
    cache_key = f"map:clusters:{zoom}:{sw_lat:.4f}:{sw_lng:.4f}:{ne_lat:.4f}:{ne_lng:.4f}"

    # ── Attempt cache read ───────────────────────────────────────────────
    r = await _get_redis()
    if r is not None:
        try:
            cached = await r.get(cache_key)
            if cached is not None:
                return ClusterResponse(
                    clusters=[ClusterItem(**c) for c in json.loads(cached)],
                    cached_at=None,
                )
        except Exception:
            logger.warning("Redis GET failed — proceeding without cache")

    # ── Query PostGIS ─────────────────────────────────────────────────────
    grid_deg = _grid_size_for_zoom(zoom)

    # Civilian report statuses included in public pressure map:
    # PENDING, UNDER_REVIEW, LINKED — active pressure signals
    # Excludes rejected statuses (REJECTED_BOGUS, REJECTED_DUPLICATE,
    # REJECTED_INSUFFICIENT, REJECTED_TIMEOUT) and ACTIONED reports.
    rows = db.execute(
        text("""
            WITH clustered AS (
                SELECT
                    ST_SnapToGrid(location::geometry, :grid_deg) AS grid_cell,
                    COUNT(*)                                                        AS cnt,
                    AVG(ST_Y(location::geometry))                                   AS center_lat,
                    AVG(ST_X(location::geometry))                                   AS center_lng,
                    CASE
                        WHEN COUNT(*) >= 10 THEN 'high'
                        WHEN COUNT(*) >= 5  THEN 'medium'
                        ELSE 'low'
                    END                                                             AS severity,
                    MAX(created_at)                                                 AS latest_at
                FROM wims.citizen_reports
                WHERE status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')
                  AND ST_Within(
                      location::geometry,
                      ST_MakeEnvelope(:sw_lng, :sw_lat, :ne_lng, :ne_lat, 4326)
                  )
                GROUP BY ST_SnapToGrid(location::geometry, :grid_deg)
            )
            SELECT
                center_lat,
                center_lng,
                cnt,
                severity,
                latest_at
            FROM clustered
            WHERE center_lat IS NOT NULL AND center_lng IS NOT NULL
            ORDER BY cnt DESC
        """),
        {
            "grid_deg": grid_deg,
            "sw_lat": sw_lat,
            "sw_lng": sw_lng,
            "ne_lat": ne_lat,
            "ne_lng": ne_lng,
        },
    ).fetchall()

    clusters = [
        {
            "lat": round(float(r.center_lat), 6),
            "lng": round(float(r.center_lng), 6),
            "count": r.cnt,
            "severity": r.severity,
            "latest_at": r.latest_at.isoformat() if r.latest_at else None,
        }
        for r in rows
    ]

    # ── Write cache (best-effort) ─────────────────────────────────────────
    if r is not None:
        try:
            await r.setex(cache_key, _REDIS_CLUSTER_TTL, json.dumps(clusters))
        except Exception:
            logger.warning("Redis SET failed — cache write skipped")

    return ClusterResponse(clusters=[ClusterItem(**c) for c in clusters])


# ---------------------------------------------------------------------------
# Pydantic response models for emergency services
# ---------------------------------------------------------------------------


class EmergencyContact(BaseModel):
    name: str
    phone: str
    description: str


class NearbyStation(BaseModel):
    city: str
    province: str
    region: str
    lat: float
    lng: float
    distance_m: float


class EmergencyServicesResponse(BaseModel):
    national: list[EmergencyContact]
    stations: list[NearbyStation]
    cached_at: str | None = None


# ---------------------------------------------------------------------------
# GET /api/public/emergency-services — public emergency contacts & stations
# ---------------------------------------------------------------------------
@router.get("/emergency-services", response_model=EmergencyServicesResponse)
async def get_emergency_services(
    request: Request,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    db: Annotated[Session, Depends(get_db)] = None,
):
    """Return emergency contact information and nearby fire stations.

    Static national contacts are always included. When lat/lng are provided,
    nearby BFP stations (from ref_cities with fire station markers) are
    returned ordered by proximity. Cached for 5 minutes.
    """
    cache_key = "map:emergency-services"
    if lat is not None and lng is not None:
        cache_key = f"map:emergency-services:{lat:.4f}:{lng:.4f}"

    # ── Cache read ────────────────────────────────────────────────────────
    r = await _get_redis()
    if r is not None:
        try:
            cached = await r.get(cache_key)
            if cached is not None:
                return EmergencyServicesResponse(**json.loads(cached))
        except Exception:
            logger.warning("Redis GET failed for emergency-services — querying live")

    # ── Station proximity query ───────────────────────────────────────────
    stations: list[dict[str, Any]] = []
    if lat is not None and lng is not None:
        rows = db.execute(
            text("""
                SELECT
                    rc.city_name,
                    rp.province_name,
                    rr.region_name,
                    ST_Y(rc.location::geometry) AS station_lat,
                    ST_X(rc.location::geometry) AS station_lng,
                    ST_Distance(
                        rc.location::geography,
                        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                    ) AS distance_m
                FROM wims.ref_cities rc
                JOIN wims.ref_provinces rp ON rp.province_id = rc.province_id
                JOIN wims.ref_regions rr ON rr.region_id = rp.region_id
                WHERE rc.location IS NOT NULL
                  AND rc.has_fire_station = TRUE
                ORDER BY rc.location::geography <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                LIMIT 20
            """),
            {"lat": lat, "lng": lng},
        ).fetchall()

        stations = [
            {
                "city": r.city_name,
                "province": r.province_name,
                "region": r.region_name,
                "lat": round(float(r.station_lat), 6),
                "lng": round(float(r.station_lng), 6),
                "distance_m": round(float(r.distance_m), 1),
            }
            for r in rows
        ]

    national = [
        EmergencyContact(
            name="BFP National Emergency Hotline",
            phone="911",
            description="National emergency hotline for fire, medical, and rescue",
        ),
        EmergencyContact(
            name="BFP Command Center",
            phone="(02) 8426-0219",
            description="BFP National Headquarters — Quezon City",
        ),
        EmergencyContact(
            name="NDRRMC Operations Center",
            phone="(02) 8911-5061",
            description="National Disaster Risk Reduction and Management Council",
        ),
        EmergencyContact(
            name="Red Cross 143",
            phone="143",
            description="Philippine Red Cross emergency hotline",
        ),
    ]

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload = EmergencyServicesResponse(
        national=national,
        stations=[NearbyStation(**s) for s in stations],
        cached_at=now_iso,
    )

    # ── Write cache ───────────────────────────────────────────────────────
    if r is not None:
        try:
            await r.setex(cache_key, _REDIS_EMERGENCY_TTL, payload.model_dump_json())
        except Exception:
            logger.warning("Redis SET failed for emergency-services — cache write skipped")

    return payload


# ---------------------------------------------------------------------------
# Authenticated operational map endpoint (for validators/analysts)
# ---------------------------------------------------------------------------

operational_router = APIRouter(prefix="/api/validator", tags=["validator-map"])


@operational_router.get("/operational-map", response_model=ClusterResponse)
async def get_operational_map(
    sw_lat: Annotated[float, Query(ge=-90, le=90)],
    sw_lng: Annotated[float, Query(ge=-180, le=180)],
    ne_lat: Annotated[float, Query(ge=-90, le=90)],
    ne_lng: Annotated[float, Query(ge=-180, le=180)],
    zoom: Annotated[int, Query(ge=4, le=18)] = 10,
    status_filter: Annotated[str | None, Query(description="Filter by verification status")] = None,
    db: Annotated[Session, Depends(get_db)] = None,
    _user: Annotated[dict, Depends(auth.get_current_wims_user)] = None,
):
    """Return clustered incidents for the validator operational map.

    Shows ALL non-archived incidents visible to the authenticated user
    (RLS-scoped). Optional status_filter allows filtering by verification_status.
    """
    grid_deg = _grid_size_for_zoom(zoom)

    status_clause = ""
    if status_filter:
        status_clause = "AND fi.verification_status = :status_filter"
    elif status_filter is None:
        # Default: exclude DRAFT only (validators see everything else)
        status_clause = "AND fi.verification_status != 'DRAFT'"

    rows = db.execute(
        text(f"""
            WITH clustered AS (
                SELECT
                    ST_SnapToGrid(fi.location::geometry, :grid_deg) AS grid_cell,
                    COUNT(*)                                                        AS cnt,
                    AVG(ST_Y(fi.location::geometry))                                AS center_lat,
                    AVG(ST_X(fi.location::geometry))                                AS center_lng,
                    CASE
                        WHEN COUNT(*) >= 10 THEN 'high'
                        WHEN COUNT(*) >= 5  THEN 'medium'
                        ELSE 'low'
                    END                                                             AS severity,
                    MAX(fi.created_at)                                              AS latest_at
                FROM wims.fire_incidents fi
                WHERE fi.is_archived = FALSE
                  {status_clause}
                  AND ST_Within(
                      fi.location::geometry,
                      ST_MakeEnvelope(:sw_lng, :sw_lat, :ne_lng, :ne_lat, 4326)
                  )
                GROUP BY ST_SnapToGrid(fi.location::geometry, :grid_deg)
            )
            SELECT center_lat, center_lng, cnt, severity, latest_at
            FROM clustered
            WHERE center_lat IS NOT NULL AND center_lng IS NOT NULL
            ORDER BY cnt DESC
        """),
        {
            "grid_deg": grid_deg,
            "sw_lat": sw_lat,
            "sw_lng": sw_lng,
            "ne_lat": ne_lat,
            "ne_lng": ne_lng,
            "status_filter": str(status_filter) if status_filter else "",
        },
    ).fetchall()

    clusters = [
        ClusterItem(
            lat=round(float(r.center_lat), 6),
            lng=round(float(r.center_lng), 6),
            count=r.cnt,
            severity=r.severity,
            latest_at=r.latest_at.isoformat() if r.latest_at else None,
        )
        for r in rows
    ]

    return ClusterResponse(clusters=clusters)
