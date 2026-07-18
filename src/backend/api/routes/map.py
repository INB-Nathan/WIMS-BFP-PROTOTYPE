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

# Sentinel to distinguish "never initialized" from "initialized but failed."
# _REDIS_POOL = _UNSET → never tried.  None → tried and unreachable.
# During the _REDIS_RETRY_AFTER cooldown, requests skip reconnection to avoid
# creating a new aioredis client per request when Redis is briefly down.
_UNSET: object = object()
_REDIS_POOL: aioredis.Redis | None | object = _UNSET
_REDIS_RETRY_AFTER: float = 0.0  # monotonic timestamp
_REDIS_BACKOFF_SECONDS = 30.0

_REDIS_CLUSTER_TTL = 120  # 2 minutes
_REDIS_EMERGENCY_TTL = 300  # 5 minutes
# A16 (map.py scope): cooldown blast-radius reduction is intentionally a
# documented NO-OP here. The current behavior nulls _REDIS_POOL on connect
# failure and applies a _REDIS_RETRY_AFTER backoff; keeping a known-bad pool
# assigned and only nudging the timestamp risks reusing a dead aioredis client
# (connection storms / silent failures). Correctness is preferred over the
# refactor: the 30s window is bounded and the route is fail-soft. No control
# flow below is changed for A16.
_REDIS_POOL_MAX_CONNECTIONS = 10


async def _get_redis() -> aioredis.Redis | None:
    """Return a lazy Redis connection with backoff. Returns None if Redis is
    unreachable; skips reconnection during cooldown to avoid connection storms."""
    global _REDIS_POOL, _REDIS_RETRY_AFTER  # noqa: PLW0603

    # Known-bad with active cooldown — skip retry
    if _REDIS_POOL is None:
        if time.monotonic() < _REDIS_RETRY_AFTER:
            return None
        # Cooldown expired — fall through to retry

    if _REDIS_POOL is _UNSET or _REDIS_POOL is None:
        try:
            _REDIS_POOL = aioredis.from_url(
                _REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
                health_check_interval=30,
                max_connections=_REDIS_POOL_MAX_CONNECTIONS,
            )
            await _REDIS_POOL.ping()
        except Exception:
            logger.warning("Redis unreachable — public map cache disabled")
            _REDIS_POOL = None
            _REDIS_RETRY_AFTER = time.monotonic() + _REDIS_BACKOFF_SECONDS
            return None

    return _REDIS_POOL  # type: ignore[return-value]


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
    status_breakdown: dict[str, int] | None = None
    category_mix: list[str] | None = None
    total_damage_php: float | None = None
    total_casualties: int | None = None
    earliest_at: str | None = None
    region_id: int | None = None


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

    # ── Query PostGIS (with single-flight lock against cache stampede) ──
    # Concurrent cache misses for the same bbox+zoom would otherwise each
    # hit PostGIS. A Redis SET NX lock lets only one request refresh; the
    # losers fall back to a live DB query rather than erroring. The lock is
    # best-effort: any failure to acquire/release degrades to an unguarded
    # live query, preserving the route's fail-soft contract.
    lock_key = f"map:lock:{cache_key}"
    lock_acquired = False
    if r is not None:
        try:
            lock_acquired = bool(await r.set(lock_key, "1", nx=True, ex=5))
        except Exception:
            logger.warning("Redis lock SET failed — proceeding without lock")
            lock_acquired = False

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

    # ── Write cache (best-effort, only the lock-owning request writes) ────
    if r is not None and lock_acquired:
        try:
            await r.setex(cache_key, _REDIS_CLUSTER_TTL, json.dumps(clusters))
        except Exception:
            logger.warning("Redis SET failed — cache write skipped")
        finally:
            # Release the single-flight lock so the next miss refreshes.
            try:
                await r.delete(lock_key)
            except Exception:
                logger.warning("Redis lock release failed — key expires via TTL")

    return ClusterResponse(clusters=[ClusterItem(**c) for c in clusters])


# ---------------------------------------------------------------------------
# Pydantic response models for emergency services
# ---------------------------------------------------------------------------


class EmergencyContact(BaseModel):
    name: str
    phone: str
    description: str


class NearbyStation(BaseModel):
    name: str
    address: str
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
                    fs.station_name,
                    fs.address,
                    rr.region_name,
                    ST_Y(fs.location::geometry) AS station_lat,
                    ST_X(fs.location::geometry) AS station_lng,
                    ST_Distance(
                        fs.location::geography,
                        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                    ) AS distance_m
                FROM wims.ref_fire_stations fs
                JOIN wims.ref_regions rr ON rr.region_id = fs.region_id
                ORDER BY fs.location::geography <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                LIMIT 20
            """),
            {"lat": lat, "lng": lng},
        ).fetchall()

        stations = [
            {
                "name": r.station_name,
                "address": r.address or "",
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
# Pydantic model for validator fire station response
# ---------------------------------------------------------------------------


class StationItem(BaseModel):
    station_id: int
    station_name: str
    address: str | None = None
    region_name: str | None = None
    latitude: float
    longitude: float


# ---------------------------------------------------------------------------
# Authenticated operational map endpoints (for validators/analysts)
# ---------------------------------------------------------------------------

operational_router = APIRouter(prefix="/api/validator", tags=["validator-map"])


@operational_router.get("/fire-stations", response_model=list[StationItem])
async def get_validator_fire_stations(
    db: Annotated[Session, Depends(auth.get_db_with_rls)] = None,
):
    """Return all BFP fire stations with region names for the validator map.

    JOINs ref_fire_stations with ref_regions to include region_name.
    Used by the validator operational map's fire station layer.
    """
    rows = db.execute(
        text("""
            SELECT
                fs.station_id,
                fs.station_name,
                fs.address,
                rr.region_name,
                ST_Y(fs.location::geometry) AS latitude,
                ST_X(fs.location::geometry) AS longitude
            FROM wims.ref_fire_stations fs
            LEFT JOIN wims.ref_regions rr ON rr.region_id = fs.region_id
            ORDER BY fs.station_name ASC
        """),
    ).fetchall()

    return [
        StationItem(
            station_id=r.station_id,
            station_name=r.station_name,
            address=r.address,
            region_name=r.region_name,
            latitude=round(float(r.latitude), 6),
            longitude=round(float(r.longitude), 6),
        )
        for r in rows
    ]


@operational_router.get("/operational-map", response_model=ClusterResponse)
async def get_operational_map(
    sw_lat: Annotated[float, Query(ge=-90, le=90)],
    sw_lng: Annotated[float, Query(ge=-180, le=180)],
    ne_lat: Annotated[float, Query(ge=-90, le=90)],
    ne_lng: Annotated[float, Query(ge=-180, le=180)],
    zoom: Annotated[int, Query(ge=4, le=18)] = 10,
    status_filter: Annotated[
        str | None,
        Query(
            description="Filter by verification status",
            pattern=r"^(DRAFT|PENDING|PENDING_VALIDATION|VERIFIED|REJECTED)$",
        ),
    ] = None,
    date_from: Annotated[
        str | None,
        Query(description="Filter AFORs from this date (ISO 8601)", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ] = None,
    date_to: Annotated[
        str | None,
        Query(
            description="Filter AFORs up to this date (ISO 8601, inclusive)",
            pattern=r"^\d{4}-\d{2}-\d{2}$",
        ),
    ] = None,
    db: Annotated[Session, Depends(auth.get_db_with_rls)] = None,
):
    """Return clustered incidents for the validator operational map.

    Shows ALL non-archived incidents visible to the authenticated user
    (RLS-scoped). Optional status_filter allows filtering by verification_status.
    Optional date_from/date_to filter by AFOR submission timestamp.
    """
    grid_deg = _grid_size_for_zoom(zoom)

    # ── Attempt cache read ───────────────────────────────────────────────
    cache_key = (
        f"map:operational:v2:{zoom}:"
        f"{sw_lat:.4f}:{sw_lng:.4f}:{ne_lat:.4f}:{ne_lng:.4f}:"
        f"{status_filter or 'all'}:"
        f"{date_from or ''}:{date_to or ''}"
    )
    r = await _get_redis()
    cached_at = None
    if r is not None:
        try:
            cached = await r.get(cache_key)
            if cached is not None:
                cached_data = json.loads(cached)
                return ClusterResponse(
                    clusters=[ClusterItem(**c) for c in cached_data["clusters"]],
                    cached_at=cached_data.get("cached_at"),
                )
        except Exception:
            logger.warning("Redis GET failed for operational map — proceeding without cache")

    # Build WHERE clauses. All optional — when omitted, no filter is applied.
    query_params: dict[str, Any] = {
        "grid_deg": grid_deg,
        "sw_lat": sw_lat,
        "sw_lng": sw_lng,
        "ne_lat": ne_lat,
        "ne_lng": ne_lng,
    }
    if status_filter:
        status_clause = "AND fi.verification_status = :status_filter"
        query_params["status_filter"] = str(status_filter)
    else:
        status_clause = "AND fi.verification_status != 'DRAFT'"

    date_clauses: list[str] = []
    if date_from:
        date_clauses.append("fi.created_at >= :date_from")
        query_params["date_from"] = date_from
    if date_to:
        # Inclusive: compare < next day so the entire date_to day is covered
        date_clauses.append("fi.created_at < :date_to::date + interval '1 day'")
        query_params["date_to"] = date_to
    date_clause = ""
    if date_clauses:
        date_clause = "AND " + " AND ".join(date_clauses)

    try:
        rows = db.execute(
            text(f"""
                WITH detail_agg AS (
                    SELECT
                        ind.incident_id,
                        jsonb_agg(DISTINCT ind.general_category) FILTER (WHERE ind.general_category IS NOT NULL) AS categories,
                        SUM(ind.estimated_damage_php) AS total_damage,
                        SUM(COALESCE(ind.civilian_injured, 0) + COALESCE(ind.civilian_deaths, 0)) AS total_casualties
                    FROM wims.incident_nonsensitive_details ind
                    JOIN wims.fire_incidents fi ON fi.incident_id = ind.incident_id
                    WHERE fi.is_archived = FALSE
                      AND ST_Within(fi.location::geometry, ST_MakeEnvelope(:sw_lng, :sw_lat, :ne_lng, :ne_lat, 4326))
                    GROUP BY ind.incident_id
                ),
                clustered AS (
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
                        MAX(fi.created_at)                                              AS latest_at,
                        COUNT(*) FILTER (WHERE fi.verification_status = 'PENDING') AS pending_count,
                        COUNT(*) FILTER (WHERE fi.verification_status = 'PENDING_VALIDATION') AS pending_validation_count,
                        COUNT(*) FILTER (WHERE fi.verification_status = 'VERIFIED') AS verified_count,
                        COUNT(*) FILTER (WHERE fi.verification_status = 'REJECTED') AS rejected_count,
                        MIN(fi.created_at) AS earliest_at,
                        MAX(da.categories::text)::jsonb AS categories,
                        MAX(da.total_damage) AS total_damage,
                        MAX(da.total_casualties) AS total_casualties,
                        mode() WITHIN GROUP (ORDER BY fi.region_id) AS region_id
                    FROM wims.fire_incidents fi
                    LEFT JOIN detail_agg da ON da.incident_id = fi.incident_id
                    WHERE fi.is_archived = FALSE
                      {status_clause}
                      {date_clause}
                      AND ST_Within(
                          fi.location::geometry,
                          ST_MakeEnvelope(:sw_lng, :sw_lat, :ne_lng, :ne_lat, 4326)
                      )
                    GROUP BY ST_SnapToGrid(fi.location::geometry, :grid_deg)
                )
                SELECT center_lat, center_lng, cnt, severity, latest_at,
                       pending_count, pending_validation_count, verified_count, rejected_count,
                       earliest_at, categories, total_damage, total_casualties, region_id
                FROM clustered
                WHERE center_lat IS NOT NULL AND center_lng IS NOT NULL
                ORDER BY cnt DESC
            """),
            query_params,
        ).fetchall()

        clusters = [
            ClusterItem(
                lat=round(float(r.center_lat), 6),
                lng=round(float(r.center_lng), 6),
                count=r.cnt,
                severity=r.severity,
                latest_at=r.latest_at.isoformat() if r.latest_at else None,
                status_breakdown={
                    "PENDING": r.pending_count,
                    "PENDING_VALIDATION": r.pending_validation_count,
                    "VERIFIED": r.verified_count,
                    "REJECTED": r.rejected_count,
                }
                if r.pending_count is not None
                else None,
                category_mix=list(r.categories) if r.categories else None,
                total_damage_php=float(r.total_damage) if r.total_damage is not None else None,
                total_casualties=int(r.total_casualties)
                if r.total_casualties is not None
                else None,
                earliest_at=r.earliest_at.isoformat() if r.earliest_at else None,
                region_id=int(r.region_id) if r.region_id is not None else None,
            )
            for r in rows
        ]
    except Exception:
        logger.warning("Operational map DB query failed — attempting stale cache")
        if r is not None:
            try:
                stale = await r.get(cache_key)
                if stale is not None:
                    stale_data = json.loads(stale)
                    return ClusterResponse(
                        clusters=[ClusterItem(**c) for c in stale_data["clusters"]],
                        cached_at=stale_data.get("cached_at"),
                    )
            except Exception:
                logger.warning("Stale cache read also failed")
        raise

    cached_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # ── Write cache (best-effort) ─────────────────────────────────────────
    if r is not None:
        try:
            cache_payload = json.dumps(
                {
                    "clusters": [c.model_dump() for c in clusters],
                    "cached_at": cached_at,
                }
            )
            await r.setex(cache_key, _REDIS_CLUSTER_TTL, cache_payload)
        except Exception:
            logger.warning("Redis SET failed for operational map — cache write skipped")

    return ClusterResponse(clusters=clusters, cached_at=cached_at)
