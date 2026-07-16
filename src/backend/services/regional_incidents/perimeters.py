"""Fire incident perimeter + civilian-report linking service (#635).

Domain logic for the manually-drawn fire perimeter feature. Keeps the route
module thin: routes only parse/authorize/marshal; all SQL orchestration and
GeoJSON normalization lives here.

Geometry is passed to PostgreSQL as a bound parameter (a GeoJSON string) and
parsed with ST_GeomFromGeoJSON — never interpolated into SQL text (no SQLi).
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# Valid map_method vocabulary (mirrors the CHECK constraint in
# 96_fire_incident_perimeters.sql). Centralized so the route + service
# agree on allowed values even before the DB CHECK enforces them.
VALID_MAP_METHODS = frozenset(
    {
        "GPS-Driven",
        "GPS-Flight",
        "GPS-Walked",
        "GPS-Walked/Driven",
        "GPS-Unknown",
        "Hand-Sketch",
        "Digitized-Image",
        "Digitized-Topo",
        "Digitized-Other",
        "Image-Interpretation",
        "Infrared-Image",
        "Modeled",
        "Mixed-Methods",
        "Remote-Sensing-Derived",
        "Survey/GCDB/Cadastral",
        "Vector",
        "Phone/Tablet",
        "Other",
    }
)


def normalize_polygon_geojson(geometry: dict[str, Any]) -> str:
    """Normalize a request geometry into a GeoJSON Polygon string.

    Accepts:
      * a raw GeoJSON Polygon: {"type": "Polygon", "coordinates": [[...]]}
      * a GeoJSON Feature: {"type": "Feature", "geometry": <Polygon>, ...}
      * a raw coordinates array: [[[lon, lat], ...]]

    Returns the GeoJSON text for ST_GeomFromGeoJSON. Raises ValueError when
    the geometry is not a Polygon or is structurally invalid.
    """
    if not isinstance(geometry, dict):
        raise ValueError("geometry must be a GeoJSON object or coordinates array")

    gj_type = geometry.get("type")

    if gj_type == "Feature":
        inner = geometry.get("geometry")
        if not isinstance(inner, dict):
            raise ValueError("Feature.geometry must be a GeoJSON geometry object")
        return normalize_polygon_geojson(inner)

    if gj_type is None and isinstance(geometry, list):
        # Bare coordinates array.
        coords = geometry
    elif gj_type == "Polygon":
        coords = geometry.get("coordinates")
    else:
        raise ValueError(f"Unsupported geometry type: {gj_type!r}; only Polygon is allowed")

    if not isinstance(coords, list) or not coords:
        raise ValueError("Polygon must have a non-empty coordinates array")

    # A valid polygon ring needs >= 4 positions (first == last closes it).
    outer_ring = coords[0] if isinstance(coords[0], list) else None
    if not outer_ring or len(outer_ring) < 4:
        raise ValueError("Polygon exterior ring must have at least 4 positions")

    return json.dumps({"type": "Polygon", "coordinates": coords})


def validate_geometry_is_valid(db: Session, geojson_text: str) -> bool:
    """Return True when PostGIS reports the GeoJSON geometry as valid."""
    result = db.execute(
        text("SELECT ST_IsValid(ST_GeomFromGeoJSON(:gj))"),
        {"gj": geojson_text},
    ).scalar()
    return bool(result)


def fetch_perimeter(db: Session, incident_id: int) -> dict[str, Any] | None:
    """Fetch the latest perimeter row (as a dict) for an incident, or None."""
    row = db.execute(
        text(
            """
            SELECT
                perimeter_id,
                incident_id,
                ST_AsGeoJSON(perimeter) AS geometry,
                gis_acres,
                map_method,
                created_by,
                created_at,
                updated_at
            FROM wims.fire_incident_perimeters
            WHERE incident_id = :iid
            """
        ),
        {"iid": incident_id},
    ).fetchone()
    if row is None:
        return None
    return _finalize_perimeter(
        {
            "perimeter_id": row[0],
            "incident_id": row[1],
            "geometry": row[2],
            "gis_acres": row[3],
            "map_method": row[4],
            "created_by": str(row[5]) if row[5] else None,
            "created_at": row[6].isoformat() if row[6] else None,
            "updated_at": row[7].isoformat() if row[7] else None,
        }
    )


def _parse_geojson(value: Any) -> Any:
    """ST_AsGeoJSON returns a JSON string; parse to dict for the API contract."""
    if value is None:
        return None
    if isinstance(value, str):
        return json.loads(value)
    return value


def _finalize_perimeter(row_dict: dict[str, Any]) -> dict[str, Any]:
    row_dict["geometry"] = _parse_geojson(row_dict["geometry"])
    return row_dict


def fetch_linked_reports(db: Session, incident_id: int) -> list[dict[str, Any]]:
    """Return public-safe minimal projection of linked civilian reports."""
    rows = db.execute(
        text(
            """
            SELECT
                cr.report_id,
                cr.category,
                cr.status,
                cr.created_at
            FROM wims.fire_incident_civilian_links l
            JOIN wims.citizen_reports cr ON cr.report_id = l.report_id
            WHERE l.incident_id = :iid
            ORDER BY cr.report_id
            """
        ),
        {"iid": incident_id},
    ).fetchall()
    return [
        {
            "report_id": r[0],
            "category": r[1],
            "status": r[2],
            "created_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]


def insert_perimeter(
    db: Session,
    *,
    incident_id: int,
    geojson_text: str,
    map_method: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """INSERT a new perimeter. Raises IntegrityError-style conflict for dup."""
    row = db.execute(
        text(
            """
            INSERT INTO wims.fire_incident_perimeters
                (incident_id, perimeter, gis_acres, map_method, created_by, created_at, updated_at)
            VALUES (
                :iid,
                ST_SetSRID(ST_GeomFromGeoJSON(:gj), 4326),
                ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(:gj), 4326)::geography) / 4046.8564224,
                :map_method,
                CAST(:uid AS uuid),
                now(),
                now()
            )
            RETURNING
                perimeter_id, incident_id,
                ST_AsGeoJSON(perimeter) AS geometry,
                gis_acres, map_method, created_by, created_at, updated_at
            """
        ),
        {
            "iid": incident_id,
            "gj": geojson_text,
            "map_method": map_method,
            "uid": actor_user_id,
        },
    ).fetchone()
    return _finalize_perimeter(
        {
            "perimeter_id": row[0],
            "incident_id": row[1],
            "geometry": row[2],
            "gis_acres": row[3],
            "map_method": row[4],
            "created_by": str(row[5]) if row[5] else None,
            "created_at": row[6].isoformat() if row[6] else None,
            "updated_at": row[7].isoformat() if row[7] else None,
        }
    )


def update_perimeter(
    db: Session,
    *,
    incident_id: int,
    geojson_text: str,
    map_method: str,
) -> dict[str, Any] | None:
    """UPDATE the existing perimeter row (history trigger closes the old one)."""
    row = db.execute(
        text(
            """
            UPDATE wims.fire_incident_perimeters
            SET
                perimeter  = ST_SetSRID(ST_GeomFromGeoJSON(:gj), 4326),
                gis_acres  = ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(:gj), 4326)::geography) / 4046.8564224,
                map_method = :map_method,
                updated_at = now()
            WHERE incident_id = :iid
            RETURNING
                perimeter_id, incident_id,
                ST_AsGeoJSON(perimeter) AS geometry,
                gis_acres, map_method, created_by, created_at, updated_at
            """
        ),
        {
            "iid": incident_id,
            "gj": geojson_text,
            "map_method": map_method,
        },
    ).fetchone()
    if row is None:
        return None
    return _finalize_perimeter(
        {
            "perimeter_id": row[0],
            "incident_id": row[1],
            "geometry": row[2],
            "gis_acres": row[3],
            "map_method": row[4],
            "created_by": str(row[5]) if row[5] else None,
            "created_at": row[6].isoformat() if row[6] else None,
            "updated_at": row[7].isoformat() if row[7] else None,
        }
    )


def delete_perimeter(db: Session, *, incident_id: int) -> bool:
    """DELETE the perimeter row (trigger closes history + records deleted_by)."""
    result = db.execute(
        text("DELETE FROM wims.fire_incident_perimeters WHERE incident_id = :iid"),
        {"iid": incident_id},
    )
    return result.rowcount > 0


def link_reports(
    db: Session,
    *,
    incident_id: int,
    report_ids: list[int],
    actor_user_id: str,
) -> int:
    """Link civilian reports to an incident. Returns the number newly linked.

    Validates each report exists (raises LookupError with the missing id set
    otherwise) then inserts with ON CONFLICT DO NOTHING (PK is composite).
    """
    existing = db.execute(
        text(
            """
            SELECT report_id FROM wims.citizen_reports
            WHERE report_id = ANY(:ids)
            """
        ),
        {"ids": report_ids},
    ).fetchall()
    found = {r[0] for r in existing}
    missing = [rid for rid in report_ids if rid not in found]
    if missing:
        raise LookupError(missing)

    inserted = 0
    for rid in report_ids:
        result = db.execute(
            text(
                """
                INSERT INTO wims.fire_incident_civilian_links
                    (incident_id, report_id, linked_by, linked_at)
                VALUES (:iid, :rid, CAST(:uid AS uuid), now())
                ON CONFLICT (incident_id, report_id) DO NOTHING
                """
            ),
            {"iid": incident_id, "rid": rid, "uid": actor_user_id},
        )
        inserted += result.rowcount
    return inserted


def unlink_reports(
    db: Session,
    *,
    incident_id: int,
    report_ids: list[int],
) -> int:
    """Unlink civilian reports. Returns the number of rows removed."""
    result = db.execute(
        text(
            """
            DELETE FROM wims.fire_incident_civilian_links
            WHERE incident_id = :iid AND report_id = ANY(:ids)
            """
        ),
        {"iid": incident_id, "ids": report_ids},
    )
    return result.rowcount
