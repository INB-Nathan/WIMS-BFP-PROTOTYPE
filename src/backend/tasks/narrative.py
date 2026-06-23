"""Celery task: batch generate AI narratives for VERIFIED incidents without ai_narrative."""

import asyncio
import logging

from celery import shared_task
from sqlalchemy import text

from database import get_session, SYSTEM_TASK_USER_ID

logger = logging.getLogger("wims.narrative")


@shared_task(name="tasks.narrative.batch_generate_narratives")
def batch_generate_narratives(limit: int = 50):
    """
    Generate AI narratives for up to `limit` VERIFIED incidents
    that have neither ai_narrative_enc nor ai_narrative.
    Intended for Celery beat or one-time backfill.

    Processes incidents sequentially with a fresh DB session per call
    to avoid SQLAlchemy session sharing across concurrent asyncio calls
    (GH #246).
    """
    from services.ai_service import generate_incident_narrative

    db = get_session(SYSTEM_TASK_USER_ID)
    try:
        rows = db.execute(
            text("""
                SELECT incident_id
                FROM wims.fire_incidents
                WHERE verification_status = 'VERIFIED'
                  AND is_archived = FALSE
                  AND ai_narrative_enc IS NULL
                  AND ai_narrative IS NULL
                ORDER BY created_at DESC
                LIMIT :lim
            """),
            {"lim": limit},
        ).fetchall()
    finally:
        db.close()

    incident_ids = [r[0] for r in rows]
    logger.info("batch_generate_narratives: %d incidents to process", len(incident_ids))

    if not incident_ids:
        return {"processed": 0, "succeeded": 0, "failed": 0}

    succeeded = 0
    failed = 0

    for iid in incident_ids:
        # Fresh DB session per call — SQLAlchemy sessions are not safe
        # for concurrent use, and asyncio.run() creates its own event loop.
        per_call_db = get_session(SYSTEM_TASK_USER_ID)
        try:
            asyncio.run(generate_incident_narrative(iid, per_call_db))
            succeeded += 1
            logger.info("Narrative generated for incident %s", iid)
        except Exception as exc:
            failed += 1
            logger.warning("Failed to generate narrative for incident %s: %s", iid, exc)
        finally:
            per_call_db.close()

    return {"processed": len(incident_ids), "succeeded": succeeded, "failed": failed}
