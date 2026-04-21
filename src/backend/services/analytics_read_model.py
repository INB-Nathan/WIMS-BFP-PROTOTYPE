"""Analytics Read Model Service — Query and sync for NATIONAL_ANALYST endpoints.

Uses wims.analytics_incident_facts and wims.mv_analytics_incident_counts_daily
instead of scanning fire_incidents + incident_nonsensitive_details.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


def sync_incident_to_analytics(db: Session, incident_id: int) -> None:
    """
    Sync a single incident into analytics_incident_facts.
    Call after create/update of fire_incidents or incident_nonsensitive_details.
    - If VERIFIED and not archived: upsert into facts.
    - Else: remove from facts.
    """
    row = db.execute(
        text("""
            SELECT fi.incident_id, fi.region_id, fi.location, fi.verification_status, fi.is_archived,
                   nd.notification_dt, nd.alarm_level, nd.general_category,
                   nd.civilian_injured, nd.civilian_deaths,
                   nd.firefighter_injured, nd.firefighter_deaths,
                   nd.total_response_time_minutes, nd.estimated_damage_php,
                   nd.fire_station_name,
                   rb.barangay_name
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.ref_barangays rb ON rb.barangay_id = nd.barangay_id
            WHERE fi.incident_id = :iid
        """),
        {"iid": incident_id},
    ).fetchone()

    if row is None:
        return

    verification_status = row[3]
    is_archived = row[4]
    if verification_status != "VERIFIED" or is_archived:
        db.execute(
            text("DELETE FROM wims.analytics_incident_facts WHERE incident_id = :iid"),
            {"iid": incident_id},
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
    barangay_name = row[15]

    db.execute(
        text("""
            INSERT INTO wims.analytics_incident_facts
                (incident_id, region_id, location, notification_dt, notification_date,
                 alarm_level, general_category,
                 civilian_injured, civilian_deaths, firefighter_injured, firefighter_deaths,
                 total_response_time_minutes, estimated_damage_php,
                 fire_station_name, barangay_name)
            SELECT :iid, :region_id, location, :notification_dt, :notification_date,
                   :alarm_level, :general_category,
                   :civilian_injured, :civilian_deaths, :firefighter_injured, :firefighter_deaths,
                   :total_response_time_minutes, :estimated_damage_php,
                   :fire_station_name, :barangay_name
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
                barangay_name = EXCLUDED.barangay_name,
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
            "barangay_name": barangay_name,
        },
    )


def sync_incidents_batch(db: Session, incident_ids: list[int]) -> None:
    """Sync multiple incidents. Call after bulk import."""
    for iid in incident_ids:
        sync_incident_to_analytics(db, iid)


def backfill_analytics_facts(db: Session) -> int:
    """
    Backfill analytics_incident_facts from existing fire_incidents + incident_nonsensitive_details.
    Call once after deploying the read model, or when repairing sync.
    Returns count of rows synced.
    """
    rows = db.execute(
        text("""
            SELECT fi.incident_id FROM wims.fire_incidents fi
            WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
        """)
    ).fetchall()
    incident_ids = [r[0] for r in rows]
    for iid in incident_ids:
        sync_incident_to_analytics(db, iid)
    db.commit()
    return len(incident_ids)


def get_heatmap_points(
    db: Session,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    region_id: Optional[int] = None,
    region_ids: Optional[list[int]] = None,
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
    if alarm_level:
        clauses.append("a.alarm_level = :alarm_level")
        params["alarm_level"] = alarm_level
    if incident_type:
        clauses.append("a.general_category = :incident_type")
        params["incident_type"] = incident_type
    if casualty_severity == "high":
        clauses.append("a.civilian_deaths > 0")
    elif casualty_severity == "medium":
        clauses.append("a.civilian_injured > 0 AND a.civilian_deaths = 0")
    elif casualty_severity == "low":
        clauses.append("a.civilian_injured = 0 AND a.civilian_deaths = 0")
    if damage_min is not None:
        clauses.append("a.estimated_damage_php >= :damage_min")
        params["damage_min"] = damage_min
    if damage_max is not None:
        clauses.append("a.estimated_damage_php <= :damage_max")
        params["damage_max"] = damage_max

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
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
    interval: str = "daily",
    casualty_severity: Optional[str] = None,
) -> list[dict[str, Any]]:
    """
    Time-series counts from analytics_incident_facts.
    Uses indexed notification_date; date_trunc for bucket.
    """
    clauses = ["a.notification_dt IS NOT NULL"]
    params: dict[str, Any] = {}
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
    if incident_type:
        clauses.append("a.general_category = :incident_type")
        params["incident_type"] = incident_type
    if alarm_level:
        clauses.append("a.alarm_level = :alarm_level")
        params["alarm_level"] = alarm_level
    if casualty_severity == "high":
        clauses.append("a.civilian_deaths > 0")
    elif casualty_severity == "medium":
        clauses.append("a.civilian_injured > 0 AND a.civilian_deaths = 0")
    elif casualty_severity == "low":
        clauses.append("a.civilian_injured = 0 AND a.civilian_deaths = 0")

    where_sql = " AND ".join(clauses)
    trunc_val = {"daily": "day", "weekly": "week", "monthly": "month"}[interval]

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
    incident_type: Optional[str] = None,
    alarm_level: Optional[str] = None,
) -> int:
    """Comparative range count from analytics_incident_facts."""
    clauses = [
        "a.notification_date >= CAST(:range_start AS date)",
        "a.notification_date <= CAST(:range_end AS date)",
    ]
    params: dict[str, Any] = {"range_start": range_start, "range_end": range_end}
    if region_id is not None:
        clauses.append("a.region_id = :region_id")
        params["region_id"] = region_id
    if incident_type:
        clauses.append("a.general_category = :incident_type")
        params["incident_type"] = incident_type
    if alarm_level:
        clauses.append("a.alarm_level = :alarm_level")
        params["alarm_level"] = alarm_level

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
        "barangay_name",
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
        "barangay_name",
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
    for k, v in filters.items():
        if k == "start_date" and v:
            clauses.append("a.notification_date >= CAST(:start_date AS date)")
            params["start_date"] = v
        elif k == "end_date" and v:
            clauses.append("a.notification_date <= CAST(:end_date AS date)")
            params["end_date"] = v
        elif k == "region_id" and v is not None:
            clauses.append("a.region_id = :region_id")
            params["region_id"] = v
        elif k == "incident_type" and v:
            clauses.append("a.general_category = :incident_type")
            params["incident_type"] = v

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
) -> list[dict[str, Any]]:
    """Incident count grouped by general_category (for pie chart)."""
    clauses = ["a.general_category IS NOT NULL"]
    params: dict[str, Any] = {}
    if start_date:
        clauses.append("a.notification_date >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("a.notification_date <= CAST(:end_date AS date)")
        params["end_date"] = end_date
    if region_id is not None:
        clauses.append("a.region_id = :region_id")
        params["region_id"] = region_id

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


def get_top_barangays(
    db: Session,
    *,
    limit: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    incident_type: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Top N barangays by incident count."""
    clauses = ["a.barangay_name IS NOT NULL"]
    params: dict[str, Any] = {}
    if start_date:
        clauses.append("a.notification_date >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("a.notification_date <= CAST(:end_date AS date)")
        params["end_date"] = end_date
    if incident_type:
        clauses.append("a.general_category = :incident_type")
        params["incident_type"] = incident_type

    params["limit"] = min(limit, 50)
    where_sql = " AND ".join(clauses)
    rows = db.execute(
        text(f"""
            SELECT a.barangay_name, COUNT(*) AS cnt
            FROM wims.analytics_incident_facts a
            WHERE {where_sql}
            GROUP BY a.barangay_name
            ORDER BY cnt DESC
            LIMIT :limit
        """),
        params,
    ).fetchall()
    return [{"barangay": r[0], "count": r[1]} for r in rows]


def get_response_time_by_region(
    db: Session,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Average/min/max response time grouped by region."""
    clauses = ["a.total_response_time_minutes IS NOT NULL"]
    params: dict[str, Any] = {}
    if start_date:
        clauses.append("a.notification_date >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("a.notification_date <= CAST(:end_date AS date)")
        params["end_date"] = end_date

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
    incident_type: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Cross-region comparison: per-region aggregate stats."""
    clauses = ["a.region_id = ANY(:region_ids)"]
    params: dict[str, Any] = {"region_ids": region_ids}
    if start_date:
        clauses.append("a.notification_date >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("a.notification_date <= CAST(:end_date AS date)")
        params["end_date"] = end_date
    if incident_type:
        clauses.append("a.general_category = :incident_type")
        params["incident_type"] = incident_type

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
    "barangay": "a.barangay_name",
    "fire_station": "a.fire_station_name",
    "region": "a.region_id::text",
}


def get_top_n(
    db: Session,
    metric: str,
    dimension: str,
    limit: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Configurable top-N analysis by metric and dimension."""
    if metric not in VALID_TOP_N_METRICS:
        raise ValueError(f"Invalid metric: {metric}. Must be one of {VALID_TOP_N_METRICS}")
    if dimension not in VALID_TOP_N_DIMENSIONS:
        raise ValueError(f"Invalid dimension: {dimension}. Must be one of {list(VALID_TOP_N_DIMENSIONS.keys())}")

    dim_col = VALID_TOP_N_DIMENSIONS[dimension]
    if metric == "incidents":
        agg_expr = "COUNT(*) AS value"
    elif metric == "response_time":
        agg_expr = "AVG(a.total_response_time_minutes) AS value"
    else:  # casualties
        agg_expr = "SUM(a.civilian_deaths + a.civilian_injured + a.firefighter_deaths + a.firefighter_injured) AS value"

    clauses = [f"{dim_col} IS NOT NULL"]
    params: dict[str, Any] = {"limit": min(limit, 50)}
    if start_date:
        clauses.append("a.notification_date >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        clauses.append("a.notification_date <= CAST(:end_date AS date)")
        params["end_date"] = end_date

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
