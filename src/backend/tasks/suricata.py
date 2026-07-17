"""Celery tasks for Suricata EVE log ingestion and rule updates."""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone

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

DOCKER_AVAILABLE = False
try:
    import docker  # noqa: F811

    DOCKER_AVAILABLE = True
except ImportError:
    pass


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
        db.commit()
        if count > 0:
            logger.info("Ingested %d Suricata alert(s) from %s", count, EVE_LOG_PATH)
        return count
    except Exception as e:
        db.rollback()
        logger.exception("Suricata EVE ingestion failed: %s", e)
        raise
    finally:
        db.close()


def _count_active_rules(container: "docker.models.containers.Container") -> int:
    """Count currently loaded Suricata rules via suricata --dump-stats."""
    _RULES_LOADED_RE = re.compile(r"detect\.rules_loaded\s*\|\s*\S+\s*\|\s*(\d+)")

    try:
        result = container.exec_run("suricata --dump-stats", timeout=120)
        output = result.output.decode(errors="replace")
        for line in output.splitlines():
            m = _RULES_LOADED_RE.search(line)
            if m:
                return int(m.group(1))
        logger.warning(
            "Failed to parse rules count from suricata --dump-stats output: %s",
            output[:500],
        )
    except Exception as exc:
        logger.warning("Failed to count loaded rules: %s", exc)
    return -1


@celery_app.task(name="tasks.suricata.update_rules")
def update_suricata_rules() -> dict:
    """
    Run suricata-update in the Suricata container to fetch latest ET Open rules
    and trigger a live rule reload. WIMS custom rules load directly from YAML.

    Runs weekly via Celery beat (Sunday 03:00 UTC).
    Returns dict with rules_before, rules_after, and any errors.
    """
    if not DOCKER_AVAILABLE:
        missing = "docker Python SDK not installed — skipping suricata-update"
        logger.warning(missing)
        return {"success": False, "error": missing}

    client = None
    try:
        client = docker.from_env()
        container = client.containers.get("wims-suricata")
    except Exception as exc:
        msg = f"Docker API error (suricata container not running?): {exc}"
        logger.error(msg)
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
        return {"success": False, "error": msg}

    try:
        rules_before = _count_active_rules(container)
        logger.info("Suricata rules before update: %d loaded", rules_before)

        update_result = container.exec_run("suricata-update", timeout=120)
        update_output = update_result.output.decode(errors="replace")

        if update_result.exit_code != 0:
            logger.error(
                "suricata-update failed (exit %d): %s", update_result.exit_code, update_output
            )
            return {
                "success": False,
                "error": update_output[:500],
                "rules_before": rules_before,
                "rules_after": -1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        reload_result = container.exec_run("kill -USR2 1", timeout=120)
        if reload_result.exit_code != 0:
            logger.warning(
                "Failed to send USR2 reload signal: %s",
                reload_result.output.decode(errors="replace"),
            )

        # Poll for rule count to stabilize after async USR2 reload.
        rules_after = -1
        for attempt in range(5):
            time.sleep(2)
            rules_after = _count_active_rules(container)
            if rules_after >= 0 and rules_after != rules_before:
                break
            logger.debug(
                "Rules count unchanged after reload (attempt %d/5, %d loaded)",
                attempt + 1,
                rules_after,
            )
        else:
            logger.warning(
                "Rule count never changed after USR2 reload — reload may have silently failed"
            )
        logger.info("Suricata rules after update: %d loaded (was %d)", rules_after, rules_before)

        result = {
            "success": True,
            "rules_before": rules_before,
            "rules_after": rules_after,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        if rules_before < 0 or rules_after < 0:
            result["rules_parse_error"] = True
            logger.warning(
                "Rule count parse failed: before=%d, after=%d", rules_before, rules_after
            )

        if rules_after < rules_before and rules_before > 0:
            logger.warning(
                "Suricata rule count decreased after update (%d → %d). "
                "Check suricata-update output for dropped rules.",
                rules_before,
                rules_after,
            )
            result["warning"] = "Rule count decreased after update"

        return result
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
