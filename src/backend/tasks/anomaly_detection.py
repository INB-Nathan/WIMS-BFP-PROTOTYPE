"""M8: Behavioral anomaly detection — Celery beat task (60s).

Four detectors run against wims.system_audit_trails using SQL sliding windows:
  - BULK_DELETE         >10 delete-class actions per user in any 5-min window (HIGH)
  - OFF_HOURS           High-sensitivity actions 22:00–05:59 Asia/Manila (MEDIUM)
  - PRIVILEGE_ESCALATION ROLE_CHANGE_TO_% events (HIGH)
  - RAPID_IP_SWITCH     Same user, 2+ distinct IPs in 10-min window (MEDIUM)

Deferred (not implemented — M8 remains PARTIAL):
  - Suspicious Query Patterns — needs pg_stat_statements, not enabled
  - Impossible Travel (geo) — needs IP geolocation database, not in-stack;
    RAPID_IP_SWITCH ships as the achievable proxy

Each detected anomaly is written to wims.anomaly_detections with
ON CONFLICT (anomaly_type, dedup_key) DO NOTHING.  Only when a NEW row is
actually inserted is a corresponding row written to wims.security_threat_logs
(suricata_sid=NULL) so it surfaces in the existing Threat Telemetry UI.

Session: get_session(SYSTEM_TASK_USER_ID) → svc_task (SYSTEM_ADMIN role) →
satisfies security_threat_logs RLS (SYSTEM_ADMIN | NATIONAL_ANALYST)
and anomaly_detections INSERT policy (SYSTEM_ADMIN).

Task exceptions are rolled back, logged, and re-raised so Celery/CI/ops
can surface the failure (consistent with other security-adjacent tasks).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from celery_config import celery_app
from database import SYSTEM_TASK_USER_ID, get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Detector helpers
# ---------------------------------------------------------------------------


def _detect_bulk_delete(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for users with >10 delete-class events in any 5-min
    sliding window within the last 10 minutes.

    Uses a correlated subquery so that every delete event counts its own
    trailing-5-min window — an attacker cannot evade by splitting events
    across a fixed floor-bucket boundary.
    """
    rows = db.execute(
        text("""
            SELECT user_id,
                   window_start,
                   MAX(cnt) AS cnt
            FROM (
                SELECT
                    user_id,
                    date_trunc('minute', timestamp)
                        - (EXTRACT(MINUTE FROM timestamp)::int % 5) * interval '1 minute'
                        AS window_start,
                    (SELECT COUNT(*)
                     FROM wims.system_audit_trails t2
                     WHERE t2.user_id = t1.user_id
                       AND t2.action_type LIKE 'OPERATION_DELETE%'
                       AND t2.timestamp >= t1.timestamp - interval '5 minutes'
                       AND t2.timestamp <= t1.timestamp
                    ) AS cnt
                FROM wims.system_audit_trails t1
                WHERE t1.action_type LIKE 'OPERATION_DELETE%'
                  AND t1.timestamp >= now() - interval '10 minutes'
                  AND t1.user_id IS NOT NULL
            ) sub
            WHERE cnt > 10
            GROUP BY user_id, window_start
        """)
    ).fetchall()

    results = []
    for row in rows:
        user_id, window_start, cnt = row
        window_key = window_start.strftime("%Y%m%d%H%M") if window_start else "unknown"
        results.append(
            {
                "anomaly_type": "BULK_DELETE",
                "subject_user_id": str(user_id),
                "severity": "HIGH",
                "details": {"count": int(cnt), "window_start": str(window_start)},
                "dedup_key": f"BULK_DELETE:{user_id}:{window_key}",
                "source_ip": None,
            }
        )
    return results


def _detect_off_hours(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for high-sensitivity actions performed outside
    06:00–21:59 Asia/Manila time in the last 60 seconds."""
    rows = db.execute(
        text("""
            SELECT audit_id, user_id, action_type, ip_address, timestamp
            FROM wims.system_audit_trails
            WHERE (
                action_type IN (
                    'PII_EXPORT', 'BACKUP_TRIGGERED', 'BREACH_STATUS_UPDATE',
                    'CREATE_INCIDENT_FROM_ALERT'
                )
                OR action_type LIKE 'ROLE_CHANGE_TO_%'
            )
              AND (
                EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Asia/Manila') < 6
                OR EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Asia/Manila') >= 22
              )
              AND timestamp >= now() - interval '60 seconds'
              AND user_id IS NOT NULL
        """)
    ).fetchall()

    results = []
    for row in rows:
        audit_id, user_id, action_type, ip_address, timestamp = row
        results.append(
            {
                "anomaly_type": "OFF_HOURS",
                "subject_user_id": str(user_id),
                "severity": "MEDIUM",
                "details": {
                    "action_type": action_type,
                    "audit_id": audit_id,
                    "timestamp": str(timestamp),
                },
                "dedup_key": f"OFF_HOURS:{audit_id}",
                "source_ip": ip_address,
            }
        )
    return results


def _detect_privilege_escalation(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for any ROLE_CHANGE_TO_% events in the last 60s.

    Catches all privilege-change actions (not just SYSTEM_ADMIN) to satisfy
    the broader RBAC-violation language in GH #160 / FRS M8.
    """
    rows = db.execute(
        text("""
            SELECT audit_id, user_id, action_type, ip_address, timestamp
            FROM wims.system_audit_trails
            WHERE action_type LIKE 'ROLE_CHANGE_TO_%'
              AND timestamp >= now() - interval '60 seconds'
              AND user_id IS NOT NULL
        """)
    ).fetchall()

    results = []
    for row in rows:
        audit_id, user_id, action_type, ip_address, timestamp = row
        results.append(
            {
                "anomaly_type": "PRIVILEGE_ESCALATION",
                "subject_user_id": str(user_id),
                "severity": "HIGH",
                "details": {
                    "action_type": action_type,
                    "audit_id": audit_id,
                    "timestamp": str(timestamp),
                },
                "dedup_key": f"PRIV_ESC:{audit_id}",
                "source_ip": ip_address,
            }
        )
    return results


def _detect_rapid_ip_switch(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for users with 2+ distinct IPs in any 10-min
    sliding window within the last 10 minutes.

    Uses a correlated subquery so that every event counts its own
    trailing-10-min distinct IPs — cross-boundary evasion is prevented.
    The ip_list is collected from all events in the triggered floor window.
    """
    rows = db.execute(
        text("""
            WITH sliding AS (
                SELECT
                    t1.user_id,
                    t1.timestamp,
                    t1.ip_address,
                    (SELECT COUNT(DISTINCT t2.ip_address)
                     FROM wims.system_audit_trails t2
                     WHERE t2.user_id = t1.user_id
                       AND t2.timestamp >= t1.timestamp - interval '10 minutes'
                       AND t2.timestamp <= t1.timestamp
                       AND t2.ip_address IS NOT NULL
                    ) AS distinct_ips
                FROM wims.system_audit_trails t1
                WHERE t1.timestamp >= now() - interval '10 minutes'
                  AND t1.user_id IS NOT NULL
                  AND t1.ip_address IS NOT NULL
            ),
            triggered_windows AS (
                SELECT
                    user_id,
                    date_trunc('minute', timestamp)
                        - (EXTRACT(MINUTE FROM timestamp)::int % 10) * interval '1 minute'
                        AS window_start,
                    MAX(distinct_ips) AS distinct_ips
                FROM sliding
                WHERE distinct_ips >= 2
                GROUP BY user_id, window_start
            )
            SELECT
                tw.user_id,
                tw.window_start,
                tw.distinct_ips,
                array_agg(DISTINCT s.ip_address) AS ip_list
            FROM triggered_windows tw
            JOIN sliding s ON s.user_id = tw.user_id
                AND s.timestamp >= tw.window_start
                AND s.timestamp < tw.window_start + interval '10 minutes'
            GROUP BY tw.user_id, tw.window_start, tw.distinct_ips
        """)
    ).fetchall()

    results = []
    for row in rows:
        user_id, window_start, distinct_ips, ip_list = row
        window_key = window_start.strftime("%Y%m%d%H%M") if window_start else "unknown"
        results.append(
            {
                "anomaly_type": "RAPID_IP_SWITCH",
                "subject_user_id": str(user_id),
                "severity": "MEDIUM",
                "details": {
                    "distinct_ip_count": int(distinct_ips),
                    "ips": list(ip_list) if ip_list else [],
                    "window_start": str(window_start),
                },
                "dedup_key": f"RAPID_IP:{user_id}:{window_key}",
                "source_ip": ip_list[0] if ip_list else None,
            }
        )
    return results


# ---------------------------------------------------------------------------
# Dual-write helper
# ---------------------------------------------------------------------------


def _write_anomaly(
    db: Session,
    anomaly_type: str,
    subject_user_id: str | None,
    severity: str,
    details: dict[str, Any],
    dedup_key: str,
    source_ip: str | None = None,
) -> bool:
    """Insert into anomaly_detections with ON CONFLICT DO NOTHING.

    Returns True only when a new row was actually inserted.  Only in that case
    is a corresponding row written to security_threat_logs (suricata_sid=NULL)
    so the Threat Telemetry table does not accumulate duplicates across runs.
    """
    row = db.execute(
        text("""
            INSERT INTO wims.anomaly_detections
                (anomaly_type, subject_user_id, severity, details, dedup_key)
            VALUES (
                :anomaly_type,
                CAST(:subject_user_id AS uuid),
                :severity,
                CAST(:details AS jsonb),
                :dedup_key
            )
            ON CONFLICT (anomaly_type, dedup_key) DO NOTHING
            RETURNING anomaly_id
        """),
        {
            "anomaly_type": anomaly_type,
            "subject_user_id": subject_user_id,
            "severity": severity,
            "details": json.dumps(details),
            "dedup_key": dedup_key,
        },
    ).fetchone()

    if row is None:
        return False  # dedup hit — already recorded

    threat_payload = json.dumps({**details, "anomaly_type": anomaly_type})
    db.execute(
        text("""
            INSERT INTO wims.security_threat_logs
                (severity_level, raw_payload, source_ip)
            VALUES (:severity, :payload, :source_ip)
        """),
        {
            "severity": severity,
            "payload": threat_payload,
            "source_ip": source_ip,
        },
    )
    return True


# ---------------------------------------------------------------------------
# Celery beat task
# ---------------------------------------------------------------------------

_DETECTORS = [
    _detect_bulk_delete,
    _detect_off_hours,
    _detect_privilege_escalation,
    _detect_rapid_ip_switch,
]


@celery_app.task(name="tasks.anomaly_detection.detect_behavioral_anomalies")
def detect_behavioral_anomalies() -> dict[str, int]:
    """Run all behavioral anomaly detectors against recent audit data.

    Registered in celery_config.py beat_schedule at 60s intervals.
    Uses get_session(SYSTEM_TASK_USER_ID) — svc_task has SYSTEM_ADMIN role,
    which satisfies both security_threat_logs and anomaly_detections RLS.

    On failure the session is rolled back, the exception is logged, and then
    re-raised so Celery retry / ops monitoring can surface the failure.
    """
    db = get_session(SYSTEM_TASK_USER_ID)
    total_new = 0
    total_dedup = 0
    try:
        for detector in _DETECTORS:
            anomalies = detector(db)
            for anomaly in anomalies:
                inserted = _write_anomaly(db, **anomaly)
                if inserted:
                    total_new += 1
                else:
                    total_dedup += 1
        db.commit()
        if total_new > 0:
            logger.info(
                "Anomaly detection: %d new anomalies inserted, %d deduplicated",
                total_new,
                total_dedup,
            )
    except Exception:
        logger.exception("Anomaly detection task failed")
        db.rollback()
        raise
    finally:
        db.close()
    return {"new": total_new, "dedup": total_dedup}
