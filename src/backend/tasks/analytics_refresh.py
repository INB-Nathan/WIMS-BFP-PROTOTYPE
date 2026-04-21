"""Celery tasks for refreshing analytics materialized views."""

from __future__ import annotations

import logging

from celery_config import celery_app
from database import get_session

logger = logging.getLogger(__name__)

# Materialized view names managed by this module.
MV_NAMES = [
    "mv_incident_counts_daily",
    "mv_incident_by_region",
    "mv_incident_by_barangay",
    "mv_incident_type_distribution",
]


@celery_app.task(name="analytics.refresh_materialized_views")
def refresh_materialized_views(concurrent: bool = True) -> dict[str, str]:
    """Refresh all analytics materialized views.

    Args:
        concurrent: Use REFRESH MATERIALIZED VIEW CONCURRENTLY (no read lock).
    Returns:
        Dict mapping view name to refresh status.
    """
    results: dict[str, str] = {}
    with get_session() as db:
        for mv_name in MV_NAMES:
            full_name = f"wims.{mv_name}"
            mode = "CONCURRENTLY" if concurrent else ""
            sql = f"REFRESH MATERIALIZED VIEW {mode} {full_name}"
            try:
                db.execute(sql)
                results[mv_name] = "ok"
                logger.info("Refreshed %s", full_name)
            except Exception as exc:
                results[mv_name] = f"error: {exc}"
                logger.error("Failed to refresh %s: %s", full_name, exc)
        db.commit()
    return results
