"""Celery tasks for analytics exports."""

from __future__ import annotations

import csv
import io
import logging
import os
import uuid
from typing import Any

from celery_config import celery_app
from database import get_session
from services.analytics_read_model import get_export_rows

logger = logging.getLogger(__name__)

# AFOR/incident columns from schema (analytics_incident_facts + incident_nonsensitive_details)
ALLOWED_EXPORT_COLUMNS = {
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
}

EXPORT_DIR = os.environ.get("EXPORT_DIR", "/tmp/wims-exports")


def _serialize_value(v: Any) -> str:
    """Serialize value for CSV (datetime, etc.)."""
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return str(v.isoformat())
    return str(v)


@celery_app.task(name="tasks.exports.export_incidents_csv")
def export_incidents_csv_task(filters: dict[str, Any], columns: list[str]) -> str:
    """
    Export verified, non-archived incidents to CSV from analytics_incident_facts.
    Returns storage path.
    """
    valid_cols = [c for c in columns if c in ALLOWED_EXPORT_COLUMNS]
    if not valid_cols:
        valid_cols = ["incident_id", "notification_dt"]

    logger.info("Export task started: filters=%s, columns=%s", filters, valid_cols)

    db = get_session()
    try:
        rows = get_export_rows(db, filters, valid_cols)
    finally:
        db.close()

    os.makedirs(EXPORT_DIR, exist_ok=True)
    path = os.path.join(EXPORT_DIR, f"analytics_export_{uuid.uuid4().hex[:12]}.csv")

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=valid_cols, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: _serialize_value(v) for k, v in row.items()})

    logger.info("Export complete: %d rows -> %s", len(rows), path)
    return path
