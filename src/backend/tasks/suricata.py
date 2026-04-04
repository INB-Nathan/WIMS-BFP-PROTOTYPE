"""Celery task for Suricata EVE log ingestion."""

from __future__ import annotations

import logging
import os
import uuid

from celery_config import celery_app
from database import get_session, set_rls_context
from services.suricata_ingestion import ingest_eve_file

logger = logging.getLogger(__name__)

EVE_LOG_PATH = os.environ.get("SURICATA_EVE_PATH", "/var/log/suricata/eve.json")

# Hard-coded system service account for Suricata ingestion.
# Created via: INSERT INTO wims.users (user_id, keycloak_id, username, role)
#              VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'svc_suricata', 'NATIONAL_ANALYST')
# This user has NATIONAL_ANALYST role, which satisfies the security_threat_logs
# RLS policy: USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'))
# WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'))
# See: src/postgres-init/01_wims_initial.sql — security_logs_admin_only policy.
SYSTEM_SURICATA_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


@celery_app.task(name="tasks.suricata.ingest_suricata_eve")
def ingest_suricata_eve() -> int:
    """
    Ingest new lines from Suricata EVE log into wims.security_threat_logs.
    Runs every 10 seconds via Celery beat.

    Uses a hard-coded system service account (SYSTEM_SURICATA_USER_ID)
    to satisfy the security_threat_logs RLS policy.
    """
    db = get_session()
    try:
        set_rls_context(db, SYSTEM_SURICATA_USER_ID)
        count = ingest_eve_file(EVE_LOG_PATH, db_session=db)
        if count > 0:
            logger.info("Ingested %d Suricata alert(s) from %s", count, EVE_LOG_PATH)
        return count
    except Exception as e:
        logger.exception("Suricata EVE ingestion failed: %s", e)
        raise
    finally:
        db.close()
