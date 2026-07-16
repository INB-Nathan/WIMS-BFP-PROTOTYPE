"""Celery task — async routing computation for civilian reports.

Enqueued after report commit. Selects top 3–5 station candidates by
PostGIS distance, calls OSRM for each, and stores the shortest road-
duration result. Falls back to PostGIS straight-line × 1.5 sinuosity
when OSRM fails.
"""

from __future__ import annotations

import asyncio
import json
import logging

from sqlalchemy import text

from celery_config import celery_app
from database import _AdminSessionLocal
from services.routing import compute_routing, MAX_CANDIDATES

logger = logging.getLogger("wims.tasks.routing")


@celery_app.task(
    name="tasks.routing.compute_routing",
    acks_late=True,
    max_retries=3,
    default_retry_delay=30,
)
def compute_routing_task(report_id: int) -> dict:
    """Async routing task: find best station and store routing results.

    Called after report creation. This is a synchronous celery task that
    runs the async routing service in an event loop.
    """
    db = _AdminSessionLocal()
    try:
        # Fetch report location
        row = db.execute(
            text("""
                SELECT ST_Y(location::geometry) AS lat,
                       ST_X(location::geometry) AS lon
                FROM wims.citizen_reports
                WHERE report_id = :rid
            """),
            {"rid": report_id},
        ).fetchone()
        if row is None:
            logger.warning("compute_routing_task: report_id=%s not found", report_id)
            return {"report_id": report_id, "status": "report_not_found"}

        report_lat, report_lon = float(row.lat), float(row.lon)

        # Select top candidate stations by PostGIS distance
        stations = db.execute(
            text("""
                SELECT station_id,
                       ST_Y(location::geometry) AS lat,
                       ST_X(location::geometry) AS lon,
                       ST_Distance(location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS distance_m
                FROM wims.ref_fire_stations
                ORDER BY location <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                LIMIT :limit
            """),
            {"lat": report_lat, "lon": report_lon, "limit": MAX_CANDIDATES},
        ).fetchall()

        if not stations:
            logger.warning("compute_routing_task: no stations found for report_id=%s", report_id)
            return {"report_id": report_id, "status": "no_stations"}

        # Evaluate each candidate via OSRM, keep shortest duration
        best_distance = None
        best_duration = None
        best_source = None
        best_path = None
        best_geometry = None
        candidates_evaluated = 0

        # Use asyncio.run to call the async routing service
        async def _evaluate_all():
            nonlocal \
                best_distance, \
                best_duration, \
                best_source, \
                best_path, \
                best_geometry, \
                candidates_evaluated
            best = None  # (duration_s, distance_m, source, path, geometry)

            for station in stations:
                candidates_evaluated += 1
                result = await compute_routing(
                    report_lat=report_lat,
                    report_lon=report_lon,
                    station_lat=float(station.lat),
                    station_lon=float(station.lon),
                )
                if best is None or result.duration_s < best[0]:
                    best = (
                        result.duration_s,
                        result.distance_m,
                        result.data_source,
                        result.execution_path,
                        result.geometry,
                    )

            if best:
                best_duration, best_distance, best_source, best_path, best_geometry = best

        asyncio.run(_evaluate_all())

        if best_distance is None:
            logger.warning("compute_routing_task: all routing failed for report_id=%s", report_id)
            return {"report_id": report_id, "status": "all_routing_failed"}

        # ── Validate geometry shape before storage ───────────────────────
        # If best_geometry is malformed (not a proper LineString), log a
        # warning and set it to None so the valid routing metrics are still
        # persisted without discarding geometry-dependent data.
        if best_geometry is not None:
            if not isinstance(best_geometry, dict):
                logger.warning(
                    "Malformed routing geometry for report_id=%s: not a dict",
                    report_id,
                )
                best_geometry = None
            elif not isinstance(best_geometry.get("coordinates"), list):
                logger.warning(
                    "Malformed routing geometry for report_id=%s: coordinates not a list",
                    report_id,
                )
                best_geometry = None
            elif best_geometry.get("type") != "LineString":
                logger.warning(
                    "Malformed routing geometry for report_id=%s: type=%s, expected LineString",
                    report_id,
                    best_geometry.get("type"),
                )
                best_geometry = None
            else:
                coords = best_geometry["coordinates"]
                if len(coords) == 0:
                    logger.warning(
                        "Malformed routing geometry for report_id=%s: empty coordinate list",
                        report_id,
                    )
                    best_geometry = None
                else:
                    # Validate each coordinate is a [lon, lat] pair of numbers
                    for i, coord in enumerate(coords):
                        if (
                            not isinstance(coord, (list, tuple))
                            or len(coord) != 2
                            or not isinstance(coord[0], (int, float))
                            or not isinstance(coord[1], (int, float))
                        ):
                            logger.warning(
                                "Malformed routing geometry for report_id=%s: invalid coordinate at index %s",
                                report_id,
                                i,
                            )
                            best_geometry = None
                            break

        # Store results — single UPDATE with CASE WHEN for geometry
        geojson_str = json.dumps(best_geometry) if best_geometry is not None else None
        params = {
            "rid": report_id,
            "distance": best_distance,
            "duration": best_duration,
            "source": best_source,
            "path": best_path,
            "candidates": candidates_evaluated,
            "geometry_json": geojson_str,
        }

        sql = """
            UPDATE wims.citizen_reports SET
                routing_distance_m = :distance,
                routing_duration_s = :duration,
                routing_data_source = :source,
                routing_execution_path = :path,
                routing_candidate_count = :candidates,
                routing_geometry = CASE
                    WHEN :geometry_json IS NOT NULL THEN ST_GeomFromGeoJSON(:geometry_json)
                    ELSE NULL
                END,
                routing_updated_at = now()
            WHERE report_id = :rid
        """

        db.execute(text(sql), params)
        db.commit()

        logger.info(
            "Routing computed for report_id=%s: %.0fm, %.0fs, source=%s, geometry=%s",
            report_id,
            best_distance,
            best_duration,
            best_source,
            "present" if best_geometry else "none",
        )
        return {
            "report_id": report_id,
            "status": "success",
            "distance_m": best_distance,
            "duration_s": best_duration,
            "source": best_source,
            "has_geometry": best_geometry is not None,
        }

    except Exception as exc:
        logger.error("Routing task failed for report_id=%s: %s", report_id, exc)
        db.rollback()
        raise  # triggers celery retry
    finally:
        db.close()
