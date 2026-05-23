"""Analytics Read Model Service — Query and sync for NATIONAL_ANALYST endpoints.

Uses wims.analytics_incident_facts and wims.mv_analytics_incident_counts_daily
instead of scanning fire_incidents + incident_nonsensitive_details.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

EXPORT_LOG_TABLE = "analytics_export_log"
logger = logging.getLogger(__name__)


def _append_common_filters(
    clauses: list[str],
    params: dict[str, Any],
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = None,
    region_ids: Optional[list[int]] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> None:
    if start_date:
        clauses.append("a.notification_date >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("a.notification_date <= CAST(:end_date AS date)")
        params["end_date"] = end_date
    if region_ids:
        clauses.append("a.region_id = ANY(:region_ids)")
        params["region_ids"] = region_ids
    elif region_id is not None:
        clauses.append("a.region_id = :region_id")
        params["region_id"] = region_id
    if province:
        clauses.append("a.province_name = :province")
        params["province"] = province
    if municipality:
        clauses.append("a.municipality_name = :municipality")
        params["municipality"] = municipality
    if alarm_level:
        clauses.append("a.alarm_level = :alarm_level")
        params["alarm_level"] = alarm_level
    if incident_type:
        clauses.append("a.general_category = :incident_type")
        params["incident_type"] = incident_type
    if casualty_severity == "high":
        clauses.append("(a.civilian_deaths + a.firefighter_deaths) > 0")
    elif casualty_severity == "medium":
        clauses.append(
            "(a.civilian_injured + a.firefighter_injured) > 0 "
            "AND (a.civilian_deaths + a.firefighter_deaths) = 0"
        )
    elif casualty_severity == "low":
        clauses.append(
            "(a.civilian_injured + a.firefighter_injured + "
            "a.civilian_deaths + a.firefighter_deaths) = 0"
        )
    if damage_min is not None:
        clauses.append("a.estimated_damage_php >= :damage_min")
        params["damage_min"] = damage_min
    if damage_max is not None:
        clauses.append("a.estimated_damage_php <= :damage_max")
        params["damage_max"] = damage_max


def sync_incident_to_analytics(db: Session, incident_id: int) -> None:
    """
    Sync a single incident into analytics_incident_facts.
    Call after create/update of fire_incidents or incident_nonsensitive_details.
    - If VERIFIED and not archived: upsert into facts.
    - Else: remove from facts.
    """
    try:
        row = db.execute(
            text("""
                SELECT fi.incident_id, fi.region_id, fi.location, fi.verification_status, fi.is_archived,
                       nd.notification_dt, nd.alarm_level, nd.general_category,
                       nd.civilian_injured, nd.civilian_deaths,
                       nd.firefighter_injured, nd.firefighter_deaths,
                       nd.total_response_time_minutes, nd.estimated_damage_php,
                       nd.fire_station_name, nd.city_municipality, nd.province_district
                FROM wims.fire_incidents fi
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                WHERE fi.incident_id = :iid
            """),
            {"iid": incident_id},
        ).fetchone()
    except Exception as e:
        logger.warning(
            "Analytics sync: failed to fetch incident %s from fire_incidents: %s",
            incident_id,
            e,
        )
        return

    if row is None:
        return

    verification_status = row[3]
    is_archived = row[4]
    if verification_status != "VERIFIED" or is_archived:
        try:
            db.execute(
                text("DELETE FROM wims.analytics_incident_facts WHERE incident_id = :iid"),
                {"iid": incident_id},
            )
        except Exception as e:
            logger.warning(
                "Analytics sync: failed to delete stale facts for incident %s: %s",
                incident_id,
                e,
            )
        return

    notification_dt = row[5]
    notification_date = notification_dt.date() if notification_dt else None
    alarm_level = row[6]
    general_category = row[7]
    civilian_injured = row[8] or 0
    civilian_deaths = row[9] or 0
    firefighter_injured = row[10] or 0
    firefighter_deaths = row[11] or 0
    total_response_time_minutes = row[12]
    estimated_damage_php = row[13]
    fire_station_name = row[14]
    municipality_name = row[15]
    province_name = row[16]

    try:
        db.execute(
            text("""
                INSERT INTO wims.analytics_incident_facts
                    (incident_id, region_id, location, notification_dt, notification_date,
                     alarm_level, general_category,
                     civilian_injured, civilian_deaths, firefighter_injured, firefighter_deaths,
                     total_response_time_minutes, estimated_damage_php,
                     fire_station_name, municipality_name, province_name)
                SELECT :iid, :region_id, location, :notification_dt, :notification_date,
                       :alarm_level, :general_category,
                       :civilian_injured, :civilian_deaths, :firefighter_injured, :firefighter_deaths,
                       :total_response_time_minutes, :estimated_damage_php,
                       :fire_station_name, :municipality_name, :province_name
                FROM wims.fire_incidents WHERE incident_id = :iid
                ON CONFLICT (incident_id) DO UPDATE SET
                    region_id = EXCLUDED.region_id,
                    location = EXCLUDED.location,
                    notification_dt = EXCLUDED.notification_dt,
                    notification_date = EXCLUDED.notification_date,
                    alarm_level = EXCLUDED.alarm_level,
                    general_category = EXCLUDED.general_category,
                    civilian_injured = EXCLUDED.civilian_injured,
                    civilian_deaths = EXCLUDED.civilian_deaths,
                    firefighter_injured = EXCLUDED.firefighter_injured,
                    firefighter_deaths = EXCLUDED.firefighter_deaths,
                    total_response_time_minutes = EXCLUDED.total_response_time_minutes,
                    estimated_damage_php = EXCLUDED.estimated_damage_php,
                    fire_station_name = EXCLUDED.fire_station_name,
                    municipality_name = EXCLUDED.municipality_name,
                    province_name = EXCLUDED.province_name,
                    synced_at = now()
            """),
            {
                "iid": incident_id,
                "region_id": row[1],
                "notification_dt": notification_dt,
                "notification_date": notification_date,
                "alarm_level": alarm_level,
                "general_category": general_category,
                "civilian_injured": civilian_injured,
                "civilian_deaths": civilian_deaths,
                "firefighter_injured": firefighter_injured,
                "firefighter_deaths": firefighter_deaths,
                "total_response_time_minutes": total_response_time_minutes,
                "estimated_damage_php": estimated_damage_php,
                "fire_station_name": fire_station_name,
                "municipality_name": municipality_name,
                "province_name": province_name,
            },
        )
    except Exception as e:
        logger.warning(
            "Analytics sync: failed to upsert incident %s into facts: %s",
            incident_id,
            e,
        )


def sync_incidents_batch(db: Session, incident_ids: list[int]) -> None:
    """Sync multiple incidents in a single round-trip. Call after bulk import."""
    if not incident_ids:
        return

    # Bulk fetch: join fire_incidents + incident_nonsensitive_details
    # Partition into delete-candidates vs upsert-candidates in SQL
    rows = db.execute(
        text("""
            SELECT
                fi.incident_id,
                fi.region_id,
                fi.location,
                fi.verification_status,
                fi.is_archived,
                nd.notification_dt,
                nd.alarm_level,
                nd.general_category,
                nd.civilian_injured,
                nd.civilian_deaths,
                nd.firefighter_injured,
                nd.firefighter_deaths,
                nd.total_response_time_minutes,
                nd.estimated_damage_php,
                nd.fire_station_name,
                nd.city_municipality,
                nd.province_district
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                ON nd.incident_id = fi.incident_id
            WHERE fi.incident_id = ANY(:iids)
        """),
        {"iids": incident_ids},
    ).fetchall()

    if not rows:
        return

    # Partition: delete if not VERIFIED or is_archived
    to_delete = [r[0] for r in rows if r[3] != "VERIFIED" or r[4]]
    to_upsert = [r for r in rows if r[3] == "VERIFIED" and not r[4]]

    if to_delete:
        try:
            db.execute(
                text("""
                    DELETE FROM wims.analytics_incident_facts
                    WHERE incident_id = ANY(:iids)
                """),
                {"iids": to_delete},
            )
        except Exception as e:
            logger.warning(
                "Analytics sync batch: failed to delete %d stale records: %s",
                len(to_delete),
                e,
            )

    if to_upsert:
        try:
            upsert_rows = [
                {
                    "iid": r[0],
                    "region_id": r[1],
                    "location": r[2],
                    "notification_dt": r[5],
                    "notification_date": r[5].date() if r[5] else None,
                    "alarm_level": r[6],
                    "general_category": r[7],
                    "civilian_injured": r[8] or 0,
                    "civilian_deaths": r[9] or 0,
                    "firefighter_injured": r[10] or 0,
                    "firefighter_deaths": r[11] or 0,
                    "total_response_time_minutes": r[12],
                    "estimated_damage_php": r[13],
                    "fire_station_name": r[14],
                    "municipality_name": r[15],
                    "province_name": r[16],
                }
                for r in to_upsert
            ]
            db.execute(
                text("""
                    INSERT INTO wims.analytics_incident_facts
                        (incident_id, region_id, location, notification_dt, notification_date,
                         alarm_level, general_category,
                         civilian_injured, civilian_deaths, firefighter_injured, firefighter_deaths,
                         total_response_time_minutes, estimated_damage_php,
                         fire_station_name, municipality_name, province_name)
                    SELECT
                        data.iid, data.region_id, fi.location,
                        data.notification_dt, data.notification_date,
                        data.alarm_level, data.general_category,
                        data.civilian_injured, data.civilian_deaths,
                        data.firefighter_injured, data.firefighter_deaths,
                        data.total_response_time_minutes, data.estimated_damage_php,
                        data.fire_station_name, data.municipality_name, data.province_name
                    FROM jsonb_to_recordset(:rows::jsonb) AS data(
                        iid INTEGER,
                        region_id INTEGER,
                        location GEOMETRY,
                        notification_dt TIMESTAMPTZ,
                        notification_date DATE,
                        alarm_level TEXT,
                        general_category TEXT,
                        civilian_injured INTEGER,
                        civilian_deaths INTEGER,
                        firefighter_injured INTEGER,
                        firefighter_deaths INTEGER,
                        total_response_time_minutes NUMERIC,
                        estimated_damage_php NUMERIC,
                        fire_station_name TEXT,
                        municipality_name TEXT,
                        province_name TEXT
                    )
                    JOIN wims.fire_incidents fi ON fi.incident_id = data.iid
                    ON CONFLICT (incident_id) DO UPDATE SET
                        region_id = EXCLUDED.region_id,
                        location = EXCLUDED.location,
                        notification_dt = EXCLUDED.notification_dt,
                        notification_date = EXCLUDED.notification_date,
                        alarm_level = EXCLUDED.alarm_level,
                        general_category = EXCLUDED.general_category,
                        civilian_injured = EXCLUDED.civilian_injured,
                        civilian_deaths = EXCLUDED.civilian_deaths,
                        firefighter_injured = EXCLUDED.firefighter_injured,
                        firefighter_deaths = EXCLUDED.firefighter_deaths,
                        total_response_time_minutes = EXCLUDED.total_response_time_minutes,
                        estimated_damage_php = EXCLUDED.estimated_damage_php,
                        fire_station_name = EXCLUDED.fire_station_name,
                        municipality_name = EXCLUDED.municipality_name,
                        province_name = EXCLUDED.province_name,
                        synced_at = now()
                """),
                {"rows": json.dumps(upsert_rows)},
            )
        except Exception as e:
            logger.warning(
                "Analytics sync batch: failed to upsert %d records: %s",
                len(to_upsert),
                e,
            )


def backfill_analytics_facts(db: Session) -> int:
    """
    Backfill analytics_incident_facts from existing fire_incidents + incident_nonsensitive_details.
    Call once after deploying the read model, or when repairing sync.
    Returns count of rows synced.
    """
    rows = db.execute(
        text("""
            SELECT
                fi.incident_id,
                fi.region_id,
                fi.location,
                nd.notification_dt,
                nd.alarm_level,
                nd.general_category,
                nd.civilian_injured,
                nd.civilian_deaths,
                nd.firefighter_injured,
                nd.firefighter_deaths,
                nd.total_response_time_minutes,
                nd.estimated_damage_php,
                nd.fire_station_name,
                nd.city_municipality,
                nd.province_district
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                ON nd.incident_id = fi.incident_id
            WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
        """)
    ).fetchall()

    if not rows:
        return 0

    upsert_rows = [
        {
            "iid": r[0],
            "region_id": r[1],
            "location": r[2],
            "notification_dt": r[3],
            "notification_date": r[3].date() if r[3] else None,
            "alarm_level": r[4],
            "general_category": r[5],
            "civilian_injured": r[6] or 0,
            "civilian_deaths": r[7] or 0,
            "firefighter_injured": r[8] or 0,
            "firefighter_deaths": r[9] or 0,
            "total_response_time_minutes": r[10],
            "estimated_damage_php": r[11],
            "fire_station_name": r[12],
            "municipality_name": r[13],
            "province_name": r[14],
        }
        for r in rows
    ]

    try:
        db.execute(
            text("""
                INSERT INTO wims.analytics_incident_facts
                    (incident_id, region_id, location, notification_dt, notification_date,
                     alarm_level, general_category,
                     civilian_injured, civilian_deaths, firefighter_injured, firefighter_deaths,
                     total_response_time_minutes, estimated_damage_php,
                     fire_station_name, municipality_name, province_name)
                SELECT
                    data.iid, data.region_id, fi.location,
                    data.notification_dt, data.notification_date,
                    data.alarm_level, data.general_category,
                    data.civilian_injured, data.civilian_deaths,
                    data.firefighter_injured, data.firefighter_deaths,
                    data.total_response_time_minutes, data.estimated_damage_php,
                    data.fire_station_name, data.municipality_name, data.province_name
                FROM jsonb_to_recordset(:rows::jsonb) AS data(
                    iid INTEGER,
                    region_id INTEGER,
                    location GEOMETRY,
                    notification_dt TIMESTAMPTZ,
                    notification_date DATE,
                    alarm_level TEXT,
                    general_category TEXT,
                    civilian_injured INTEGER,
                    civilian_deaths INTEGER,
                    firefighter_injured INTEGER,
                    firefighter_deaths INTEGER,
                    total_response_time_minutes NUMERIC,
                    estimated_damage_php NUMERIC,
                    fire_station_name TEXT,
                    municipality_name TEXT,
                    province_name TEXT
                )
                JOIN wims.fire_incidents fi ON fi.incident_id = data.iid
                ON CONFLICT (incident_id) DO UPDATE SET
                    region_id = EXCLUDED.region_id,
                    location = EXCLUDED.location,
                    notification_dt = EXCLUDED.notification_dt,
                    notification_date = EXCLUDED.notification_date,
                    alarm_level = EXCLUDED.alarm_level,
                    general_category = EXCLUDED.general_category,
                    civilian_injured = EXCLUDED.civilian_injured,
                    civilian_deaths = EXCLUDED.civilian_deaths,
                    firefighter_injured = EXCLUDED.firefighter_injured,
                    firefighter_deaths = EXCLUDED.firefighter_deaths,
                    total_response_time_minutes = EXCLUDED.total_response_time_minutes,
                    estimated_damage_php = EXCLUDED.estimated_damage_php,
                    fire_station_name = EXCLUDED.fire_station_name,
                    municipality_name = EXCLUDED.municipality_name,
                    province_name = EXCLUDED.province_name,
                    synced_at = now()
            """),
            {"rows": json.dumps(upsert_rows)},
        )
        db.commit()
        return len(upsert_rows)
    except Exception as e:
        logger.warning("Analytics backfill: bulk upsert failed: %s", e)
        db.rollback()
        return 0


def get_heatmap_points(
    db: Session,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = None,
    region_ids: Optional[list[int]] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    alarm_level: Optional[str] = None,
    incident_type: Optional[str] = None,
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> list[dict[str, Any]]:
    """
    Fetch heatmap points from analytics_incident_facts.
    Uses indexed access on notification_date, region_id, alarm_level, general_category.
    """
    clauses = ["1=1"]
    params: dict[str, Any] = {}
    _append_common_filters(
        clauses,
        params,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        region_ids=region_ids,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )

    where_sql = " AND ".join(clauses)
    rows = db.execute(
        text(f"""
            SELECT a.incident_id,
                   ST_X(a.location::geometry) AS lon,
                   ST_Y(a.location::geometry) AS lat,
                   a.alarm_level, a.general_category, a.notification_dt
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
        """),
        params,
    ).fetchall()

    return [
        {
            "incident_id": r[0],
            "lon": float(r[1]),
            "lat": float(r[2]),
            "alarm_level": r[3],
            "general_category": r[4],
            "notification_dt": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


def get_trends(
    db: Session,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = None,
    region_ids: Optional[list[int]] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    interval: str = "daily",
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> list[dict[str, Any]]:
    """
    Time-series counts from analytics_incident_facts.
    Uses indexed notification_date; date_trunc for bucket.
    """
    clauses = ["a.notification_dt IS NOT NULL"]
    params: dict[str, Any] = {}
    _append_common_filters(
        clauses,
        params,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        region_ids=region_ids,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )

    where_sql = " AND ".join(clauses)
    trunc_val = {
        "daily": "day",
        "weekly": "week",
        "monthly": "month",
        "quarterly": "quarter",
        "yearly": "year",
    }[interval]

    rows = db.execute(
        text(f"""
            SELECT date_trunc(:trunc_val, a.notification_dt) AS bucket, COUNT(*) AS cnt
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
            GROUP BY date_trunc(:trunc_val, a.notification_dt)
            ORDER BY bucket
        """),
        {**params, "trunc_val": trunc_val},
    ).fetchall()

    return [{"bucket": r[0].isoformat() if r[0] else None, "count": r[1]} for r in rows]


def count_in_range(
    db: Session,
    range_start: str,
    range_end: str,
    *,
    region_id: Optional[int] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> int:
    """Comparative range count from analytics_incident_facts."""
    clauses = [
        "a.notification_date >= CAST(:range_start AS date)",
        "a.notification_date <= CAST(:range_end AS date)",
    ]
    params: dict[str, Any] = {"range_start": range_start, "range_end": range_end}
    _append_common_filters(
        clauses,
        params,
        region_id=region_id,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )

    where_sql = " AND ".join(clauses)
    result = db.execute(
        text(f"""
            SELECT COUNT(*) FROM wims.analytics_incident_facts a
            WHERE {where_sql}
        """),
        params,
    ).scalar()
    return result or 0


def get_export_rows(
    db: Session,
    filters: dict[str, Any],
    columns: list[str],
    incident_ids: Optional[list[int]] = None,
) -> list[dict[str, Any]]:
    """
    Fetch analyst-safe rows for CSV export from analytics_incident_facts.
    Joins incident_nonsensitive_details and fire_incidents for columns not in facts.
    """
    allowed = {
        "incident_id",
        "notification_dt",
        "alarm_level",
        "general_category",
        "sub_category",
        "fire_origin",
        "extent_of_damage",
        "structures_affected",
        "households_affected",
        "individuals_affected",
        "vehicles_affected",
        "total_response_time_minutes",
        "total_gas_consumed_liters",
        "extent_total_floor_area_sqm",
        "extent_total_land_area_hectares",
        "civilian_injured",
        "civilian_deaths",
        "firefighter_injured",
        "firefighter_deaths",
        "fire_station_name",
        "region_id",
        "verification_status",
        "estimated_damage_php",
        "municipality_name",
        "province_name",
    }
    valid_cols = [c for c in columns if c in allowed]
    if not valid_cols:
        valid_cols = ["incident_id", "notification_dt"]

    fact_cols = {
        "incident_id",
        "region_id",
        "notification_dt",
        "alarm_level",
        "general_category",
        "civilian_injured",
        "civilian_deaths",
        "firefighter_injured",
        "firefighter_deaths",
        "total_response_time_minutes",
        "estimated_damage_php",
        "fire_station_name",
        "municipality_name",
        "province_name",
    }
    select_parts = []
    for c in valid_cols:
        if c == "verification_status":
            select_parts.append("fi.verification_status")
        elif c in fact_cols:
            select_parts.append(f"a.{c}")
        else:
            select_parts.append(f"nd.{c}")

    clauses = ["1=1"]
    params: dict[str, Any] = {}
    _append_common_filters(
        clauses,
        params,
        start_date=filters.get("start_date"),
        end_date=filters.get("end_date"),
        region_id=filters.get("region_id"),
        province=filters.get("province"),
        municipality=filters.get("municipality"),
        incident_type=filters.get("incident_type"),
        alarm_level=filters.get("alarm_level"),
        casualty_severity=filters.get("casualty_severity"),
        damage_min=filters.get("damage_min"),
        damage_max=filters.get("damage_max"),
    )
    if filters.get("incident_id") is not None:
        clauses.append("a.incident_id = :incident_id")
        params["incident_id"] = filters.get("incident_id")
    if incident_ids:
        clauses.append("a.incident_id = ANY(:incident_ids)")
        params["incident_ids"] = sorted(set(incident_ids))

    where_sql = " AND ".join(clauses)
    col_list = ", ".join(select_parts)

    sql = f"""
        SELECT {col_list}
        FROM wims.analytics_incident_facts a
        LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = a.incident_id
        LEFT JOIN wims.fire_incidents fi ON fi.incident_id = a.incident_id
        WHERE {where_sql}
    """

    rows = db.execute(text(sql), params).fetchall()
    return [dict(zip(valid_cols, r)) for r in rows]


def get_analyst_export_rows(
    db: Session,
    filters: dict[str, Any],
    columns: list[str],
    incident_ids: Optional[list[int]] = None,
) -> list[dict[str, Any]]:
    """Fetch analyst incident export rows, optionally intersected by selected IDs."""
    deduped_ids = sorted(set(incident_ids or [])) or None
    return get_export_rows(db, filters, columns, incident_ids=deduped_ids)


def count_export_rows(db: Session, filters: dict[str, Any]) -> int:
    """Count rows matching the export filter contract."""
    return len(get_export_rows(db, filters, ["incident_id"]))


def get_filter_options(
    db: Session,
    *,
    field: str,
    region_id: Optional[int] = None,
    province: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> list[str]:
    """Return sorted non-empty province or municipality names for cascading filters."""
    field_map = {
        "province": "a.province_name",
        "municipality": "a.municipality_name",
    }
    if field not in field_map:
        raise ValueError("field must be province or municipality")

    clauses = [f"{field_map[field]} IS NOT NULL", f"btrim({field_map[field]}) <> ''"]
    params: dict[str, Any] = {}
    _append_common_filters(
        clauses,
        params,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province if field == "municipality" else None,
    )
    where_sql = " AND ".join(clauses)
    rows = db.execute(
        text(f"""
            SELECT DISTINCT {field_map[field]} AS name
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
            ORDER BY name
        """),
        params,
    ).fetchall()
    return [r[0] for r in rows]


def verify_indexed_access(db: Session) -> dict[str, str]:
    """
    Return EXPLAIN output for analytics queries to prove indexed access.
    Used for execution-plan evidence.
    """
    plans = {}

    def _explain(sql: str) -> str:
        rows = db.execute(text(f"EXPLAIN (FORMAT TEXT) {sql}")).fetchall()
        return "\n".join(r[0] for r in rows) if rows else ""

    plans["heatmap"] = _explain("""
        SELECT a.incident_id, ST_X(a.location::geometry), ST_Y(a.location::geometry),
               a.alarm_level, a.general_category, a.notification_dt
        FROM wims.analytics_incident_facts a
        WHERE a.notification_date >= '2024-01-01' AND a.notification_date <= '2024-12-31'
    """)
    plans["trends"] = _explain("""
        SELECT date_trunc('day', a.notification_dt) AS bucket, COUNT(*)
        FROM wims.analytics_incident_facts a
        WHERE a.notification_dt IS NOT NULL
        GROUP BY date_trunc('day', a.notification_dt)
    """)
    return plans


def get_type_distribution(
    db: Session,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Incident count grouped by general_category (for pie chart)."""
    clauses = ["a.general_category IS NOT NULL"]
    params: dict[str, Any] = {}
    _append_common_filters(
        clauses,
        params,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )

    where_sql = " AND ".join(clauses)
    rows = db.execute(
        text(f"""
            SELECT a.general_category, COUNT(*) AS cnt
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
            GROUP BY a.general_category
            ORDER BY cnt DESC
        """),
        params,
    ).fetchall()
    return [{"type": r[0], "count": r[1]} for r in rows]


def get_response_time_by_region(
    db: Session,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Average/min/max response time grouped by region."""
    clauses = ["a.total_response_time_minutes IS NOT NULL"]
    params: dict[str, Any] = {}
    _append_common_filters(
        clauses,
        params,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )

    where_sql = " AND ".join(clauses)
    rows = db.execute(
        text(f"""
            SELECT a.region_id,
                   AVG(a.total_response_time_minutes) AS avg_rt,
                   MIN(a.total_response_time_minutes) AS min_rt,
                   MAX(a.total_response_time_minutes) AS max_rt
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
            GROUP BY a.region_id
            ORDER BY avg_rt DESC
        """),
        params,
    ).fetchall()
    return [
        {
            "region_id": r[0],
            "region_name": str(r[0]),  # resolved from ref_regions in route layer
            "avg_response_time": round(float(r[1]), 1),
            "min_response_time": r[2],
            "max_response_time": r[3],
        }
        for r in rows
    ]


def get_compare_regions(
    db: Session,
    region_ids: list[int],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Cross-region comparison: per-region aggregate stats."""
    clauses: list[str] = []
    params: dict[str, Any] = {}
    _append_common_filters(
        clauses,
        params,
        start_date=start_date,
        end_date=end_date,
        region_ids=region_ids,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )

    where_sql = " AND ".join(clauses)
    rows = db.execute(
        text(f"""
            SELECT a.region_id,
                   COUNT(*) AS total_incidents,
                   AVG(a.total_response_time_minutes) AS avg_rt,
                   MODE() WITHIN GROUP (ORDER BY a.general_category) AS top_type
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
            GROUP BY a.region_id
            ORDER BY total_incidents DESC
        """),
        params,
    ).fetchall()
    return [
        {
            "region_id": r[0],
            "region_name": str(r[0]),
            "total_incidents": r[1],
            "avg_response_time": round(float(r[2]), 1) if r[2] else None,
            "top_type": r[3],
        }
        for r in rows
    ]


VALID_TOP_N_METRICS = ("incidents", "response_time", "casualties")
VALID_TOP_N_DIMENSIONS = {
    "fire_station": "a.fire_station_name",
    "region": "a.region_id::text",
    "municipality": "a.municipality_name",
}


def get_top_n(
    db: Session,
    metric: str,
    dimension: str,
    limit: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = None,
    province: Optional[str] = None,
    municipality: Optional[str] = None,
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    casualty_severity: Optional[str] = None,
    damage_min: Optional[float] = None,
    damage_max: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Configurable top-N analysis by metric and dimension."""
    if metric not in VALID_TOP_N_METRICS:
        raise ValueError(f"Invalid metric: {metric}. Must be one of {VALID_TOP_N_METRICS}")
    if dimension not in VALID_TOP_N_DIMENSIONS:
        raise ValueError(
            f"Invalid dimension: {dimension}. Must be one of {list(VALID_TOP_N_DIMENSIONS.keys())}"
        )

    dim_col = VALID_TOP_N_DIMENSIONS[dimension]
    if metric == "incidents":
        agg_expr = "COUNT(*) AS value"
    elif metric == "response_time":
        agg_expr = "AVG(a.total_response_time_minutes) AS value"
    else:  # casualties
        agg_expr = "SUM(a.civilian_deaths + a.civilian_injured + a.firefighter_deaths + a.firefighter_injured) AS value"

    clauses = [f"{dim_col} IS NOT NULL"]
    params: dict[str, Any] = {"limit": min(limit, 50)}
    _append_common_filters(
        clauses,
        params,
        start_date=start_date,
        end_date=end_date,
        region_id=region_id,
        province=province,
        municipality=municipality,
        incident_type=incident_type,
        alarm_level=alarm_level,
        casualty_severity=casualty_severity,
        damage_min=damage_min,
        damage_max=damage_max,
    )

    where_sql = " AND ".join(clauses)
    rows = db.execute(
        text(f"""
            SELECT {dim_col} AS name, {agg_expr}
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
            GROUP BY {dim_col}
            ORDER BY value DESC
            LIMIT :limit
        """),
        params,
    ).fetchall()
    return [{"name": r[0], "value": float(r[1]) if r[1] is not None else 0} for r in rows]


def get_incident_export_data(
    db: Session,
    incident_id: int,
) -> dict[str, Any]:
    """
    Fetch all data needed to fill the AFOR template for a single VERIFIED incident.
    Used by export tasks — runs with RLS context already set by the caller.
    Returns a flat dict matching the AFOR cell-address map.
    """
    row = db.execute(
        text("""
            SELECT
                fi.incident_id,
                fi.reference_number,
                fi.verification_status,
                fi.is_archived,
                fi.created_at,
                nd.notification_dt,
                COALESCE(r.region_code, r.region_name, '') AS region,
                COALESCE(aif.province_name, '') AS province_name,
                COALESCE(aif.municipality_name, '') AS municipality_name,
                COALESCE(nd.general_category, '') AS general_category,
                COALESCE(nd.sub_category, '') AS sub_category,
                COALESCE(nd.alarm_level, '') AS alarm_level,
                COALESCE(nd.fire_origin, '') AS fire_origin,
                COALESCE(nd.extent_of_damage, '') AS extent_of_damage,
                COALESCE(aif.estimated_damage_php, nd.estimated_damage_php) AS estimated_damage_php,
                COALESCE(aif.total_response_time_minutes, nd.total_response_time_minutes) AS total_response_time_minutes,
                COALESCE(nd.total_gas_consumed_liters, 0) AS total_gas_consumed_liters,
                COALESCE(nd.extent_total_floor_area_sqm, 0) AS extent_total_floor_area_sqm,
                COALESCE(nd.extent_total_land_area_hectares, 0) AS extent_total_land_area_hectares,
                COALESCE(nd.structures_affected, 0) AS structures_affected,
                COALESCE(nd.households_affected, 0) AS households_affected,
                COALESCE(nd.families_affected, 0) AS families_affected,
                COALESCE(nd.individuals_affected, 0) AS individuals_affected,
                COALESCE(nd.vehicles_affected, 0) AS vehicles_affected,
                COALESCE(nd.civilian_injured, 0) AS civilian_injured,
                COALESCE(nd.civilian_deaths, 0) AS civilian_deaths,
                COALESCE(nd.firefighter_injured, 0) AS firefighter_injured,
                COALESCE(nd.firefighter_deaths, 0) AS firefighter_deaths,
                COALESCE(nd.fire_station_name, '') AS fire_station_name,
                COALESCE(nd.distance_from_station_km, 0) AS distance_from_station_km,
                nd.responder_type,
                nd.stage_of_fire,
                nd.resources_deployed,
                nd.alarm_timeline,
                nd.problems_encountered,
                nd.water_tankers_used,
                nd.breathing_apparatus_used,
                CASE WHEN w.incident_id IS NOT NULL THEN 'WILDLAND_AFOR' ELSE 'STRUCTURAL_AFOR' END AS form_kind
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd  ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.analytics_incident_facts aif       ON aif.incident_id = fi.incident_id
            LEFT JOIN wims.ref_regions r                      ON r.region_id = fi.region_id
            LEFT JOIN wims.incident_wildland_afor w           ON w.incident_id = fi.incident_id
            WHERE fi.incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    if not row:
        return {}

    r = row._mapping

    # Parse alarm_timeline JSON
    alarm_timeline = []
    if r["alarm_timeline"]:
        try:
            import json as _json

            alarm_timeline = _json.loads(r["alarm_timeline"])
        except Exception:
            alarm_timeline = []

    # Parse alarm levels for response section
    alarm_levels = []
    for entry in alarm_timeline:
        if isinstance(entry, dict) and entry.get("alarm_level"):
            alarm_levels.append(entry["alarm_level"])
        elif isinstance(entry, dict) and entry.get("status"):
            alarm_levels.append(entry["status"])

    # Build resources deployed list
    resources = []
    if r["resources_deployed"]:
        try:
            import json as _json

            resources = _json.loads(r["resources_deployed"])
        except Exception:
            resources = []

    # Problems encountered
    problems = []
    if r["problems_encountered"]:
        try:
            import json as _json

            problems = _json.loads(r["problems_encountered"])
        except Exception:
            problems = []

    # Extract key alarm times from timeline
    def extract_time(status: str) -> str:
        for entry in alarm_timeline:
            if isinstance(entry, dict) and entry.get("status") == status:
                t = entry.get("time") or entry.get("time_declared") or ""
                return t if t else "N/A"
        return "N/A"

    def extract_datetime(status: str) -> str:
        for entry in alarm_timeline:
            if isinstance(entry, dict) and entry.get("status") == status:
                dt = entry.get("datetime") or entry.get("time_declared") or ""
                return dt if dt else "N/A"
        return "N/A"

    # Notification datetime parts
    notif_dt = r["notification_dt"]
    if hasattr(notif_dt, "isoformat"):
        notif_dt = notif_dt.isoformat()
    notif_date = ""
    notif_time = ""
    if notif_dt:
        if "T" in str(notif_dt):
            parts = str(notif_dt).split("T")
            notif_date = parts[0] if len(parts) > 1 else str(notif_dt)
            notif_time = parts[1][:8] if len(parts) > 1 else ""
        else:
            notif_date = str(notif_dt)

    return {
        # Row 7-12: Header
        "region": r["region"],
        "address": "",  # not in DB — leave blank
        "contact": "",  # not in DB — leave blank
        # Row 22-23: Date/Time Notification
        "date_notification": notif_date,
        "time_notification": notif_time,
        # Row 24-27: Location
        "region_name": r["region"],
        "province": r["province_name"],
        "municipality": r["municipality_name"],
        "address_fire": "",  # not stored precisely
        "landmark": "",  # not in DB
        # Row 28-30: Caller info
        "caller_name": "",  # PII — not in nonsensitive
        "caller_number": "",  # PII
        "personnel_received": "",  # not in DB
        # Row 31: Engine dispatched
        "engine_dispatched": r["fire_station_name"],
        # Row 34: Time dispatched
        "time_dispatched": extract_time("dispatched"),
        # Row 37: Time arrived
        "time_arrived": extract_time("arrived"),
        # Row 40: Total response time
        "response_time_min": r["total_response_time_minutes"] or "",
        # Row 41: Distance
        "distance_km": r["distance_from_station_km"] or "",
        # Row 42: Highest alarm level
        "highest_alarm": r["alarm_level"],
        # Row 43: Time returned to base
        "time_returned": extract_time("returned") if extract_time("returned") != "N/A" else "",
        # Row 44: Total gas consumed
        "gas_consumed_liters": r["total_gas_consumed_liters"] or "",
        # Row 47: Classification of involved
        "general_category": r["general_category"],
        "sub_category": r["sub_category"],
        # Row 51: Owner / establishment
        "owner_name": "",  # PII
        "establishment_name": "",  # PII
        # Row 52: General description
        "general_description": r["fire_origin"] or "",
        # Row 53: Area of origin
        "area_of_origin": r["fire_origin"] or "",
        # Row 54: Stage of fire
        "stage_of_fire": r["stage_of_fire"] or "",
        # Row 55: Extent of damage
        "extent_of_damage": r["extent_of_damage"] or "",
        # Row 62-66: Impact numbers
        "structures_affected": r["structures_affected"] or "",
        "households_affected": r["households_affected"] or "",
        "families_affected": r["families_affected"] or "",
        "individuals_affected": r["individuals_affected"] or "",
        "vehicles_affected": r["vehicles_affected"] or "",
        # Row 69-77: Response vehicles (from resources_deployed JSON)
        "bfp_fire_trucks": _count_resource(resources, "BFP Fire Truck"),
        "bfp_manned_trucks": _count_resource(resources, "BFP Manned Fire Truck"),
        "non_bfp_trucks": _count_resource(resources, "Non-BFP Fire Truck"),
        "bfp_ambulance": _count_resource(resources, "BFP Ambulance"),
        "non_bfp_ambulance": _count_resource(resources, "Non-BFP Ambulance"),
        "bfp_rescue_trucks": _count_resource(resources, "BFP Rescue Truck"),
        "non_bfp_rescue_trucks": _count_resource(resources, "Non-BFP Rescue Truck"),
        "other_vehicles": _count_resource(resources, "Other"),
        # Row 79-84: Tools
        "scba_used": r["breathing_apparatus_used"] or "",
        "rope_used": "",
        "ladder_used": "",
        "hoseline_used": "",
        "hydraulic_tools": "",
        "other_tools": "",
        # Row 85: Nearest hydrant
        "hydrant_location": "",
        # Row 88-100: Alarm levels (fire alarm level section)
        "alarm_timeline": alarm_timeline,
        "alarm_levels": alarm_levels,
        # Row 101-103: ICP
        "icp_status": "Without",
        "icp_location": "",
        # Row 105-111: Casualties (E. Profile of Casualties)
        "civilian_injured_male": r["civilian_injured"] or 0,
        "civilian_injured_female": 0,
        "firefighter_injured_male": r["firefighter_injured"] or 0,
        "firefighter_injured_female": 0,
        "civilian_deaths_male": r["civilian_deaths"] or 0,
        "civilian_deaths_female": 0,
        "firefighter_deaths_male": r["firefighter_deaths"] or 0,
        "firefighter_deaths_female": 0,
        # Row 113-121: Personnel
        "engine_commander": "",
        "shift_in_charge": "",
        "nozzleman": "",
        "lineman": "",
        "engine_crew": "",
        "driver_dpo": "",
        "safety_officer": "",
        "investigator": "",
        # Row 194-219: Problems encountered
        "problems": problems,
        # Row 238-241: Prepared by / Noted by
        "prepared_by_rank": "",
        "prepared_by_name": "",
        "noted_by_rank": "",
        "noted_by_name": "",
        # Alarm timeline helper
        "alarm_1st": extract_datetime("1ST ALARM"),
        "alarm_2nd": extract_datetime("2ND ALARM"),
        "alarm_3rd": extract_datetime("3RD ALARM"),
        "alarm_4th": extract_datetime("4TH ALARM"),
        "alarm_5th": extract_datetime("5TH ALARM"),
        "alarm_tf_alpha": extract_datetime("TASK FORCE ALPHA"),
        "alarm_tf_bravo": extract_datetime("TASK FORCE BRAVO"),
        "alarm_tf_charlie": extract_datetime("TASK FORCE CHARLIE"),
        "alarm_tf_delta": extract_datetime("TASK FORCE DELTA"),
        "alarm_general": extract_datetime("GENERAL ALARM"),
        "alarm_fuc": extract_datetime("FIRE UNDER CONTROL"),
        "alarm_fo": extract_datetime("FIRE OUT"),
        # Row 44 continued: time returned
        "time_returned_base": extract_time("returned") if extract_time("returned") != "N/A" else "",
        # Misc
        "responder_type": r["responder_type"] or "",
        "form_kind": r["form_kind"],
        "estimated_damage": r["estimated_damage_php"] or "",
        "extent_floor_area": r["extent_total_floor_area_sqm"] or "",
        "extent_land_area": r["extent_total_land_area_hectares"] or "",
        "water_tankers": r["water_tankers_used"] or "",
    }


def _count_resource(resources: list, keyword: str) -> str:
    """Count resources matching a keyword from resources_deployed JSON."""
    if not resources:
        return "N/A"
    count = 0
    for r in resources:
        if isinstance(r, dict):
            name = str(r.get("name") or r.get("resource") or "").lower()
            if keyword.lower() in name:
                try:
                    count += int(r.get("quantity") or r.get("number") or 1)
                except (ValueError, TypeError):
                    count += 1
        elif isinstance(r, str) and keyword.lower() in r.lower():
            count += 1
    return str(count) if count > 0 else "N/A"
