"""Civilian Contributor — OSRM routing service.

Computes road distance and estimated driving time from a report location
to nearby fire stations. Falls back to PostGIS straight-line estimate
when OSRM is unavailable.

Call pattern:
  Report-first insert: report commits before any external routing call.
  Async-first: enqueue tasks.routing.compute_routing(report_id) after creation.
  Optional fast inline attempt post-commit, but only if it doesn't block
  the user-visible report confirmation.
"""

from __future__ import annotations

import logging
import os
from typing import NamedTuple

import httpx

logger = logging.getLogger("wims.routing")

OSRM_BASE_URL = os.environ.get(
    "OSRM_BASE_URL",
    "https://router.project-osrm.org",
)

# Average urban speed for PostGIS fallback: 40 km/h = 11.11 m/s
FALLBACK_SPEED_MPS = 11.11
# Sinuosity factor: straight-line × 1.5 to approximate road distance
SINUOSITY_FACTOR = 1.5

# Max station candidates to evaluate
MAX_CANDIDATES = 5


class RoutingResult(NamedTuple):
    distance_m: float
    duration_s: float
    data_source: str  # "osrm" or "postgis_straight_line"
    execution_path: str  # "celery", "inline_after_commit", or "fallback"
    candidate_count: int


async def compute_routing(
    report_lat: float,
    report_lon: float,
    station_lat: float,
    station_lon: float,
) -> RoutingResult:
    """Compute road routing from report to a single station candidate.

    Calls OSRM first; falls back to PostGIS straight-line × 1.5 sinuosity
    estimate with duration = distance / 11.11 m/s (40 km/h urban average).
    """
    result = await _try_osrm(station_lon, station_lat, report_lon, report_lat)
    if result is not None:
        return RoutingResult(
            distance_m=result[0],
            duration_s=result[1],
            data_source="osrm",
            execution_path="celery",
            candidate_count=1,
        )
    return _fallback_estimate(report_lat, report_lon, station_lat, station_lon)


async def _try_osrm(
    src_lon: float, src_lat: float, dst_lon: float, dst_lat: float
) -> tuple[float, float] | None:
    """Call OSRM driving route API. Returns (distance_m, duration_s) or None."""
    url = (
        f"{OSRM_BASE_URL}/route/v1/driving/"
        f"{src_lon},{src_lat};{dst_lon},{dst_lat}"
        "?overview=false&geometries=geojson&steps=false"
    )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            if "routes" not in data or not data["routes"]:
                return None
            route = data["routes"][0]
            return (float(route["distance"]), float(route["duration"]))
    except Exception as exc:
        logger.warning("OSRM lookup failed: %s", exc)
        return None


def _fallback_estimate(
    report_lat: float,
    report_lon: float,
    station_lat: float,
    station_lon: float,
) -> RoutingResult:
    """PostGIS straight-line × 1.5 sinuosity + 40 km/h urban speed estimate."""
    import math

    # Haversine distance
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(report_lat), math.radians(station_lat)
    dphi = math.radians(station_lat - report_lat)
    dlambda = math.radians(station_lon - report_lon)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    straight_line_m = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    distance_m = straight_line_m * SINUOSITY_FACTOR
    duration_s = distance_m / FALLBACK_SPEED_MPS

    return RoutingResult(
        distance_m=round(distance_m, 1),
        duration_s=round(duration_s, 1),
        data_source="postgis_straight_line",
        execution_path="fallback",
        candidate_count=1,
    )
