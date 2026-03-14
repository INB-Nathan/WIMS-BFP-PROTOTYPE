"""Celery task for Suricata EVE log ingestion."""

from __future__ import annotations

import logging
import os

from celery_config import celery_app
from services.suricata_ingestion import ingest_eve_file

logger = logging.getLogger(__name__)

EVE_LOG_PATH = os.environ.get("SURICATA_EVE_PATH", "/var/log/suricata/eve.json")


@celery_app.task(name="tasks.suricata.ingest_suricata_eve")
def ingest_suricata_eve() -> int:
    """
    Ingest new lines from Suricata EVE log into wims.security_threat_logs.
    Runs every 10 seconds via Celery beat.
    """
    try:
        count = ingest_eve_file(EVE_LOG_PATH)
        if count > 0:
            logger.info("Ingested %d Suricata alert(s) from %s", count, EVE_LOG_PATH)
        return count
    except Exception as e:
        logger.exception("Suricata EVE ingestion failed: %s", e)
        raise
