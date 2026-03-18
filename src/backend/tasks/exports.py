"""Celery tasks for analytics exports."""

from __future__ import annotations

import logging
from typing import Any

from celery_config import celery_app

logger = logging.getLogger(__name__)

# AFOR/incident columns from schema (incident_nonsensitive_details, fire_incidents)
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


@celery_app.task(name="tasks.exports.export_incidents_csv")
def export_incidents_csv_task(filters: dict[str, Any], columns: list[str]) -> str:
    """
    Export verified, non-archived incidents to CSV.
    Filters and columns are passed from the API.
    Returns a storage path or task result identifier.
    """
    # Validate columns against allowed set
    valid_cols = [c for c in columns if c in ALLOWED_EXPORT_COLUMNS]
    if not valid_cols:
        valid_cols = ["incident_id", "notification_dt"]

    # Minimal implementation: task is dispatched, result placeholder
    logger.info(
        "Export task started: filters=%s, columns=%s",
        filters,
        valid_cols,
    )
    return f"export_complete_{len(valid_cols)}_cols"
