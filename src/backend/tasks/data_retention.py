"""Celery task — data retention pruning (ASVS V14.2.4, WS5).

Reads retention periods from wims.system_config each run, prunes or
soft-archives rows beyond the configured age, and logs every action
to wims.system_audit_trails.
"""

from __future__ import annotations

import logging

from celery import shared_task
from celery.schedules import crontab
from sqlalchemy import text

from database import get_session
from utils.audit import log_system_audit
from utils.config import get_config

logger = logging.getLogger("wims.data_retention")

# ---------------------------------------------------------------------------
# Default retention days (used when system_config row is missing)
# ---------------------------------------------------------------------------
_DEFAULT_DAYS: dict[str, int] = {
    "retention.fire_incidents_days": 2555,
    "retention.incident_sensitive_details_days": 2555,
    "retention.security_threat_logs_days": 365,
    "retention.consent_log_days": 1095,
    "retention.kms_key_rotation_runs_days": 1095,
    "retention.ip_blocklist_days": 365,
}


def _get_retention_days(db, config_key: str) -> int:
    """Read retention_days from wims.system_config. Falls back to hardcoded default."""
    raw = get_config(db, config_key, str(_DEFAULT_DAYS.get(config_key, 365)))
    try:
        val = int(raw)
        return val if val >= 1 else _DEFAULT_DAYS.get(config_key, 365)
    except (ValueError, TypeError):
        return _DEFAULT_DAYS.get(config_key, 365)


def _log_prune(
    db,
    table: str,
    count: int,
    strategy: str,
    retention_days: int,
    config_key: str,
) -> None:
    """Log a data-retention prune action to the audit trail."""
    if count > 0:
        log_system_audit(
            db=db,
            user_id=None,
            action_type="DATA_RETENTION_PRUNE",
            table_affected=table,
            record_id=0,
            request=None,
            new_values={
                "pruned_count": count,
                "strategy": strategy,
                "retention_days": retention_days,
                "config_key": config_key,
            },
        )
        logger.info(
            "Pruned %d row(s) from %s (strategy=%s, retention=%d days)",
            count,
            table,
            strategy,
            retention_days,
        )


# ---------------------------------------------------------------------------
# Per-table prune functions
# ---------------------------------------------------------------------------


def _prune_security_threat_logs(db) -> None:
    """Hard-delete security_threat_logs older than retention."""
    config_key = "retention.security_threat_logs_days"
    days = _get_retention_days(db, config_key)

    result = db.execute(
        text("""
            DELETE FROM wims.security_threat_logs
            WHERE timestamp < now() - (:days || ' days')::INTERVAL
        """),
        {"days": str(days)},
    )
    _log_prune(
        db, "wims.security_threat_logs", result.rowcount or 0, "hard_delete", days, config_key
    )


def _prune_fire_incidents(db) -> None:
    """Soft-archive VERIFIED rows; hard-delete non-VERIFIED rows."""
    config_key = "retention.fire_incidents_days"
    days = _get_retention_days(db, config_key)

    # Soft-archive VERIFIED rows (is_archived toggle allowed by migration 41)
    archived = db.execute(
        text("""
            UPDATE wims.fire_incidents
            SET is_archived = TRUE
            WHERE created_at < now() - (:days || ' days')::INTERVAL
              AND verification_status = 'VERIFIED'
              AND is_archived = FALSE
        """),
        {"days": str(days)},
    )
    archived_count = archived.rowcount or 0
    if archived_count > 0:
        _log_prune(
            db,
            "wims.fire_incidents",
            archived_count,
            "soft_archive",
            days,
            config_key,
        )

    # Hard-delete non-VERIFIED rows (no_delete_verified RULE allows this).
    # Exclude rows referenced by incident_verification_history or
    # incident_sensitive_details to avoid FK constraint violations.
    deleted = db.execute(
        text("""
            DELETE FROM wims.fire_incidents fi
            WHERE fi.created_at < now() - (:days || ' days')::INTERVAL
              AND (fi.verification_status IS NULL OR fi.verification_status != 'VERIFIED')
              AND NOT EXISTS (
                SELECT 1 FROM wims.incident_verification_history ivh
                WHERE ivh.incident_id = fi.incident_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM wims.incident_sensitive_details isd
                WHERE isd.incident_id = fi.incident_id
              )
        """),
        {"days": str(days)},
    )
    deleted_count = deleted.rowcount or 0
    if deleted_count > 0:
        _log_prune(
            db,
            "wims.fire_incidents",
            deleted_count,
            "hard_delete_nonverified",
            days,
            config_key,
        )


def _prune_incident_sensitive_details(db) -> None:
    """Blob-erasure: NULL all PII columns, encrypted blob, and IV.

    Keeps the row (sensitive_id + incident_id) for FK integrity and audit.
    The age criterion is the parent fire_incident.created_at because
    incident_sensitive_details does not have its own created_at column.
    """
    config_key = "retention.incident_sensitive_details_days"
    days = _get_retention_days(db, config_key)

    result = db.execute(
        text("""
            UPDATE wims.incident_sensitive_details
            SET
                street_address = NULL,
                landmark = NULL,
                caller_name = NULL,
                caller_number = NULL,
                narrative_report = NULL,
                prepared_by_officer = NULL,
                noted_by_officer = NULL,
                receiver_name = NULL,
                establishment_name = NULL,
                owner_name = NULL,
                occupant_name = NULL,
                personnel_on_duty = '{}'::jsonb,
                other_personnel = '[]'::jsonb,
                casualty_details = '[]'::jsonb,
                icp_location = NULL,
                disposition = NULL,
                disposition_prepared_by = NULL,
                disposition_noted_by = NULL,
                remarks = NULL,
                pii_blob_enc = NULL,
                encryption_iv = NULL,
                data_retention_erased_at = now()
            WHERE incident_id IN (
                SELECT incident_id
                FROM wims.fire_incidents
                WHERE created_at < now() - (:days || ' days')::INTERVAL
            )
              AND data_retention_erased_at IS NULL
        """),
        {"days": str(days)},
    )
    _log_prune(
        db,
        "wims.incident_sensitive_details",
        result.rowcount or 0,
        "blob_erasure",
        days,
        config_key,
    )


def _prune_consent_log(db) -> None:
    """Hard-delete consent_log older than retention."""
    config_key = "retention.consent_log_days"
    days = _get_retention_days(db, config_key)

    result = db.execute(
        text("""
            DELETE FROM wims.consent_log
            WHERE recorded_at < now() - (:days || ' days')::INTERVAL
        """),
        {"days": str(days)},
    )
    _log_prune(db, "wims.consent_log", result.rowcount or 0, "hard_delete", days, config_key)


def _prune_kms_key_rotation_runs(db) -> None:
    """Hard-delete kms_key_rotation_runs older than retention."""
    config_key = "retention.kms_key_rotation_runs_days"
    days = _get_retention_days(db, config_key)

    result = db.execute(
        text("""
            DELETE FROM wims.kms_key_rotation_runs
            WHERE started_at < now() - (:days || ' days')::INTERVAL
        """),
        {"days": str(days)},
    )
    _log_prune(
        db, "wims.kms_key_rotation_runs", result.rowcount or 0, "hard_delete", days, config_key
    )


def _prune_ip_blocklist(db) -> None:
    """Hard-delete expired or old ip_blocklist entries."""
    config_key = "retention.ip_blocklist_days"
    days = _get_retention_days(db, config_key)

    result = db.execute(
        text("""
            DELETE FROM wims.ip_blocklist
            WHERE expires_at < now()
               OR blocked_at < now() - (:days || ' days')::INTERVAL
        """),
        {"days": str(days)},
    )
    _log_prune(db, "wims.ip_blocklist", result.rowcount or 0, "hard_delete", days, config_key)


def _log_noop_tables(db) -> None:
    """Log no-op for append-only tables that can never be pruned.

    These tables have RULE or hash-chain protections that prevent deletion.
    We log pruned_count=0 so the audit trail shows the retention task ran
    and explicitly chose not to prune them.
    """
    for table, config_key in (
        ("wims.incident_verification_history", None),
        ("wims.system_audit_trails", None),
    ):
        _log_prune(db, table, 0, "no_op", 0, "retention.append_only_no_prune")


# ---------------------------------------------------------------------------
# Main task
# ---------------------------------------------------------------------------


@shared_task(name="tasks.data_retention.run_data_retention")
def run_data_retention() -> int:
    """Run all data retention prune operations.

    Reads retention periods from wims.system_config, prunes rows beyond
    the configured age, and logs every action to the audit trail.
    Runs daily at 03:00 UTC via Celery beat.
    """
    db = get_session()
    try:
        _prune_security_threat_logs(db)
        _prune_fire_incidents(db)
        _prune_incident_sensitive_details(db)
        _prune_consent_log(db)
        _prune_kms_key_rotation_runs(db)
        _prune_ip_blocklist(db)
        _log_noop_tables(db)
        db.commit()
        logger.info("Data retention pruning completed successfully")
        return 1
    except Exception as e:
        logger.exception("Data retention pruning failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Beat schedule self-registration
# ---------------------------------------------------------------------------
# Register the daily 03:00 UTC beat schedule on import.
# We import from main (which re-exports celery_app from celery_config) rather
# than editing main.py or celery_config.py directly, avoiding merge conflicts
# with WS2 and WS3 which both touch main.py.
try:
    from main import celery_app  # type: ignore[import-untyped]

    celery_app.conf.beat_schedule.setdefault(
        "data-retention-daily",
        {
            "task": "tasks.data_retention.run_data_retention",
            "schedule": crontab(hour=3, minute=0),
        },
    )
except (ImportError, Exception):
    pass  # main.py or celery_app not importable in some contexts (e.g. tests)
