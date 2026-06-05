"""Celery task: batch generate AI narratives for VERIFIED incidents without ai_narrative."""

import logging

from celery import shared_task
from sqlalchemy import text

from database import get_session, SYSTEM_TASK_USER_ID

logger = logging.getLogger("wims.narrative")


@shared_task(name="tasks.narrative.batch_generate_narratives")
def batch_generate_narratives(limit: int = 50):
    """
    Generate AI narratives for up to `limit` VERIFIED incidents
    that have ai_narrative IS NULL.
    Intended for Celery beat or one-time backfill.
    """
    import asyncio
    from services.ai_service import generate_incident_narrative

    db = get_session(SYSTEM_TASK_USER_ID)
    try:
        rows = db.execute(
            text("""
                SELECT incident_id
                FROM wims.fire_incidents
                WHERE verification_status = 'VERIFIED'
                  AND is_archived = FALSE
                  AND ai_narrative IS NULL
                ORDER BY created_at DESC
                LIMIT :lim
            """),
            {"lim": limit},
        ).fetchall()

        incident_ids = [r[0] for r in rows]
        logger.info("batch_generate_narratives: %d incidents to process", len(incident_ids))

        if not incident_ids:
            return {"processed": 0}

        async def _generate_all():
            return await asyncio.gather(
                *[generate_incident_narrative(iid, db) for iid in incident_ids],
                return_exceptions=True,
            )

        results = asyncio.run(_generate_all())
        for iid, result in zip(incident_ids, results):
            if isinstance(result, Exception):
                logger.warning("Failed to generate narrative for incident %s: %s", iid, result)
            else:
                logger.info("Narrative generated for incident %s", iid)

        return {"processed": len(incident_ids)}

    finally:
        db.close()
