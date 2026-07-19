"""Privacy-preserving public emergency and civilian-signal projections."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

_PUBLIC_EMERGENCY_SOURCE = """
    FROM wims.information_emergencies ie
    JOIN wims.fire_incidents fi
      ON fi.incident_id = ie.promoted_from_incident_id
     AND fi.verification_status = 'VERIFIED'
    WHERE ie.published = TRUE
      AND EXISTS (
          SELECT 1
          FROM wims.fire_incident_civilian_links l
          WHERE l.incident_id = fi.incident_id
      )
"""

# A report is eligible only while unresolved and strictly inside an active
# verified perimeter. EXISTS keeps the result cardinality independent of
# perimeter rows, and is shared by the count and timestamp-only projections.
_ELIGIBLE_CIVILIAN_SIGNAL = """
    cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')
    AND EXISTS (
        SELECT 1
        FROM wims.fire_incident_perimeters p
        WHERE p.incident_id = fi.incident_id
          AND ST_Contains(p.perimeter::geometry, cr.location::geometry)
    )
"""


def list_public_emergencies(db: Session) -> list[dict]:
    """Return published verified emergencies with coarse civilian-signal counts."""
    rows = (
        db.execute(
            text(
                f"""
                SELECT ie.id, ie.title, ie.location, ie.description, ie.severity, ie.status,
                       ie.promoted_from_incident_id, ie.published, ie.published_at, ie.created_at,
                       ST_Y(fi.location::geometry) AS latitude,
                       ST_X(fi.location::geometry) AS longitude,
                       (
                           SELECT ST_AsGeoJSON(p.perimeter) AS perimeter_geometry
                           FROM wims.fire_incident_perimeters p
                           WHERE p.incident_id = fi.incident_id
                           ORDER BY p.perimeter_id
                           LIMIT 1
                       ) AS perimeter_geometry,
                       (
                           SELECT COUNT(DISTINCT cr.report_id)
                           FROM wims.citizen_reports cr
                           WHERE {_ELIGIBLE_CIVILIAN_SIGNAL}
                       ) AS civilian_signal_count
                {_PUBLIC_EMERGENCY_SOURCE}
                ORDER BY ie.published_at DESC NULLS LAST, ie.created_at DESC
                """
            )
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def get_public_civilian_signal_timestamps(db: Session, emergency_id: int) -> list[dict] | None:
    """Return ordered timestamps only, or None when the public source is unavailable."""
    source = (
        db.execute(
            text(
                f"""
            SELECT fi.incident_id
            {_PUBLIC_EMERGENCY_SOURCE}
              AND ie.id = :emergency_id
            """
            ),
            {"emergency_id": emergency_id},
        )
        .mappings()
        .first()
    )
    if source is None:
        return None

    rows = (
        db.execute(
            text(
                f"""
                SELECT cr.created_at AS submitted_at
                FROM wims.fire_incidents fi
                CROSS JOIN wims.citizen_reports cr
                WHERE fi.incident_id = :incident_id
                  AND {_ELIGIBLE_CIVILIAN_SIGNAL}
                ORDER BY cr.created_at ASC, cr.report_id ASC
                """
            ),
            {"incident_id": source["incident_id"]},
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]
