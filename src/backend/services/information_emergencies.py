"""Draft lifecycle for public emergency updates sourced from official incidents."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

_SOURCE_INCIDENT = text(
    """
    SELECT fi.incident_id,
           r.region_name,
           c.city_name,
           b.barangay_name,
           nd.general_description_of_involved,
           ST_AsText(fi.location) AS geom
    FROM wims.fire_incidents fi
    LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
    LEFT JOIN wims.ref_regions r ON r.region_id = fi.region_id
    LEFT JOIN wims.ref_cities c ON c.city_id = nd.city_id
    LEFT JOIN wims.ref_barangays b ON b.barangay_id = nd.barangay_id
    WHERE fi.incident_id = :incident_id
      AND fi.verification_status = 'VERIFIED'
      AND (
          NOT :require_civilian_link
          OR EXISTS (
              SELECT 1
              FROM wims.fire_incident_civilian_links l
              WHERE l.incident_id = fi.incident_id
          )
      )
    """
)


def ensure_incident_emergency_draft(
    db: Session,
    *,
    incident_id: int,
    actor_user_id: str,
    require_civilian_link: bool,
) -> int | None:
    """Create or refresh one unpublished emergency draft for an eligible incident.

    A published emergency remains the authoritative public record and is never
    overwritten by automation. The partial unique index added with migration
    0026 serializes concurrent creation of an unpublished draft.
    """
    source = (
        db.execute(
            _SOURCE_INCIDENT,
            {"incident_id": incident_id, "require_civilian_link": require_civilian_link},
        )
        .mappings()
        .first()
    )
    if source is None:
        return None

    location_parts = [
        value
        for value in (source["barangay_name"], source["city_name"], source["region_name"])
        if value
    ]
    values = {
        "title": f"Incident #{incident_id}",
        "location": ", ".join(location_parts) or source["geom"] or "Unknown",
        "description": source["general_description_of_involved"]
        or f"Promoted from incident #{incident_id}.",
        "incident_id": incident_id,
        "created_by": actor_user_id,
    }

    existing = (
        db.execute(
            text(
                """
            SELECT id, published
            FROM wims.information_emergencies
            WHERE promoted_from_incident_id = :incident_id
            ORDER BY id
            LIMIT 1
            FOR UPDATE
            """
            ),
            {"incident_id": incident_id},
        )
        .mappings()
        .first()
    )
    if existing is not None:
        if not existing["published"]:
            db.execute(
                text(
                    """
                    UPDATE wims.information_emergencies
                    SET title = :title,
                        location = :location,
                        description = :description,
                        updated_at = now()
                    WHERE id = :id
                    """
                ),
                {**values, "id": existing["id"]},
            )
        return int(existing["id"])

    draft_id = db.execute(
        text(
            """
            INSERT INTO wims.information_emergencies
                (title, location, description, severity, status,
                 promoted_from_incident_id, created_by)
            VALUES (:title, :location, :description, 'moderate', 'ongoing',
                    :incident_id, :created_by)
            ON CONFLICT (promoted_from_incident_id)
            WHERE promoted_from_incident_id IS NOT NULL AND published = FALSE
            DO UPDATE SET title = EXCLUDED.title,
                          location = EXCLUDED.location,
                          description = EXCLUDED.description,
                          updated_at = now()
            RETURNING id
            """
        ),
        values,
    ).scalar_one()
    return int(draft_id)
