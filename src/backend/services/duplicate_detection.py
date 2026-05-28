"""5-criterion scored duplicate detection for fire incidents.

Usage
-----
    from services.duplicate_detection import check_for_duplicate

    matched_id = check_for_duplicate(
        db,
        incident_id=123,
        region_id=4,
        alarm_level="1st",
        incident_date="2026-05-09",
        notification_dt=datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc),
        lat=14.5995,
        lon=120.9842,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        city_municipality="Quezon City",
        province_district="NCR",
        exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
    )
    if matched_id:
        # duplicate found
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session


def check_for_duplicate(
    db: Session,
    *,
    incident_id: int,
    region_id: int,
    alarm_level: str | None,
    incident_date: str | None,
    notification_dt: datetime | None = None,
    lat: float | None,
    lon: float | None,
    general_category: str | None = None,
    incident_type_code: str | None = None,
    city_municipality: str | None = None,
    province_district: str | None = None,
    exclude_statuses: tuple[str, ...] = (),
    verified_window_seconds: int | None = None,
) -> int | None:
    """Return the incident_id of a duplicate, or None if no duplicate is found.

    Detection logic
    ---------------
    Scores each candidate incident 0–5 on five criteria:
      1. Distance ≤ 500 m (spatial proximity)
      2. Same general_category AND same incident_type_code (both required)
      3. Same exact fire date (notification_dt date component, Asia/Manila)
      4. Fire time within 1 hour (|Δt| ≤ 3600 s)
      5. Same city/municipality; falls back to same province/district when city is null

    Returns the highest-scoring candidate with score ≥ 3 (3-of-5 threshold).
    Candidate pool is limited to ±3 days when fire_date is provided.

    Parameters
    ----------
    incident_id:
        The incident being checked — excluded from results.
    region_id:
        Region the incident belongs to.
    alarm_level:
        Alarm level string (unused; reserved for future use).
    incident_date:
        YYYY-MM-DD date string in Asia/Manila TZ, or None to skip date window.
    notification_dt:
        Full fire timestamp for the 1-hour time criterion. When provided,
        incident_date is derived from it if incident_date is None.
    lat, lon:
        Coordinates of the incident. Pass None to skip the distance criterion.
    general_category:
        e.g. "STRUCTURAL", "VEHICULAR", "WILDLAND".
    incident_type_code:
        3–4 letter AFOR type code (e.g. "APT", "INF").
    city_municipality:
        Free-text city/municipality name for criterion 5.
    province_district:
        Free-text province/district name, used as fallback for criterion 5.
    exclude_statuses:
        Tuple of verification_status values to ignore.
    verified_window_seconds:
        When set, only VERIFIED rows updated within this many seconds are checked.
        Intended for consecutive bulk-accept duplicate guard.
    """
    # Derive incident_date from notification_dt when not supplied directly
    effective_date = incident_date
    if effective_date is None and notification_dt is not None:
        effective_date = notification_dt.strftime("%Y-%m-%d")

    skip_statuses: list[str] = list(exclude_statuses) if exclude_statuses else []

    params: dict = {
        "rid": region_id,
        "cur_id": incident_id,
        "lat": float(lat) if lat is not None else None,
        "lon": float(lon) if lon is not None else None,
        "gen_cat": general_category,
        "type_code": incident_type_code,
        "fire_date": effective_date,
        "notif_dt": notification_dt.isoformat() if notification_dt is not None else None,
        "city": city_municipality,
        "province": province_district,
    }

    # ── Dynamic WHERE clauses ─────────────────────────────────────────────────
    extra_where: list[str] = []

    if skip_statuses:
        params["skip_statuses"] = skip_statuses
        extra_where.append("fi.verification_status != ALL(:skip_statuses)")

    if verified_window_seconds is not None:
        params["window_seconds"] = verified_window_seconds
        extra_where.append("fi.verification_status = 'VERIFIED'")
        extra_where.append(
            "fi.updated_at > NOW() - (:window_seconds || ' seconds')::interval"
        )

    # Candidate pool: ±3 days from fire_date (ensures candidates within this
    # window can be evaluated; exact-date criterion still distinguishes within it)
    if effective_date is not None:
        extra_where.append(
            """(
                nd.notification_dt IS NULL
                OR DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila')
                     BETWEEN DATE(CAST(:fire_date AS date)) - INTERVAL '3 days'
                         AND DATE(CAST(:fire_date AS date)) + INTERVAL '3 days'
            )"""
        )

    where_sql = ""
    if extra_where:
        where_sql = " AND " + " AND ".join(extra_where)

    row = db.execute(
        text(
            f"""
            SELECT incident_id
            FROM (
                SELECT
                    fi.incident_id,
                    fi.updated_at,
                    (
                        -- Criterion 1: Distance ≤ 500 m
                        CASE
                            WHEN :lat IS NOT NULL AND :lon IS NOT NULL
                                 AND ST_DWithin(
                                     fi.location::geography,
                                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                                     500
                                 ) THEN 1 ELSE 0
                        END
                        +
                        -- Criterion 2: Same classification AND type (both must match)
                        CASE
                            WHEN :gen_cat IS NOT NULL AND :type_code IS NOT NULL
                                 AND nd.general_category = :gen_cat
                                 AND fi.incident_type_code = :type_code THEN 1 ELSE 0
                        END
                        +
                        -- Criterion 3: Same exact fire date
                        CASE
                            WHEN :fire_date IS NOT NULL AND nd.notification_dt IS NOT NULL
                                 AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila')
                                     = CAST(:fire_date AS date)
                            THEN 1 ELSE 0
                        END
                        +
                        -- Criterion 4: Fire time within 1 hour
                        CASE
                            WHEN :notif_dt IS NOT NULL AND nd.notification_dt IS NOT NULL
                                 AND ABS(EXTRACT(EPOCH FROM
                                     (nd.notification_dt - CAST(:notif_dt AS timestamptz))
                                 )) <= 3600
                            THEN 1 ELSE 0
                        END
                        +
                        -- Criterion 5: Same city/municipality (fallback: province/district)
                        CASE
                            WHEN :city IS NOT NULL AND nd.city_municipality IS NOT NULL
                                 AND nd.city_municipality = :city THEN 1
                            WHEN (:city IS NULL OR nd.city_municipality IS NULL)
                                 AND :province IS NOT NULL
                                 AND nd.province_district IS NOT NULL
                                 AND nd.province_district = :province THEN 1
                            ELSE 0
                        END
                    ) AS dup_score
                FROM wims.fire_incidents fi
                LEFT JOIN wims.incident_nonsensitive_details nd
                       ON nd.incident_id = fi.incident_id
                WHERE fi.region_id  = :rid
                  AND fi.incident_id != :cur_id
                  AND fi.is_archived = FALSE
                {where_sql}
            ) sub
            WHERE dup_score >= 3
            ORDER BY dup_score DESC, updated_at DESC
            LIMIT 1
            """
        ),
        params,
    ).fetchone()

    return int(row[0]) if row else None
