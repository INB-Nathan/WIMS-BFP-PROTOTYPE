"""M8: Behavioral anomaly detection — Celery beat task (60s).

Seven detectors run against wims.system_audit_trails using SQL sliding windows:
  - BULK_DELETE              >10 delete-class actions per user in any 5-min window (HIGH)
  - OFF_HOURS                High-sensitivity actions 22:00–05:59 Asia/Manila (MEDIUM)
  - PRIVILEGE_ESCALATION     ROLE_CHANGE_TO_% events (HIGH)
  - RAPID_IP_SWITCH          Same user, 2+ distinct IPs in 10-min window (MEDIUM)
  - SUSPICIOUS_QUERY_PATTERN >10 PII_EXPORT actions per user in any 5-min window (HIGH)
                             Audit-trail proxy: pg_stat_statements is not enabled
                             in this stack (GH #280).
  - IMPOSSIBLE_TRAVEL        Same user, 2 logins from IPs whose great-circle distance
                             exceeds the distance physically feasible given the time gap
                             (speed > 900 km/h assumed infeasible). Requires
                             GEOIP_DB_PATH env var pointing to a MaxMind GeoLite2-City
                             .mmdb file. Gracefully skipped when DB unavailable.
  - PASSWORD_RESET_ABUSE     >5 PASSWORD_RESET actions per user in any 15-min window (MEDIUM)
                             App-level signal complementing nginx reset-credentials
                             rate limit (1r/m burst=2). Source: Keycloak SPI
                             UPDATE_PASSWORD / SEND_RESET_PASSWORD events (RP-26).

Row-count bounds: RAPID_IP_SWITCH, BULK_DELETE, and PASSWORD_RESET_ABUSE
use ORDER BY timestamp DESC LIMIT to cap scanned rows at _MAX_AUDIT_ROWS
(10 000) per detector invocation.  SUSPICIOUS_QUERY_PATTERN also uses
LIMIT (inner subquery is bounded by the 10-min lookback window).
The bound is generous (~16.7 events/s sustained for 10 min) and preserves
most-recent-first ordering so real anomalies are not hidden.  OFF_HOURS and
PRIVILEGE_ESCALATION operate on a 60 s window with specific action-type
filters, naturally bounding result sets without an explicit LIMIT.

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
import math
import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from celery_config import celery_app
from database import SYSTEM_TASK_USER_ID, get_session

logger = logging.getLogger(__name__)

_PII_EXPORT_ACTION = "PII_EXPORT"
_SUSPICIOUS_QUERY_THRESHOLD = 10

# RP-26: password-reset abuse detector
_PASSWORD_RESET_ACTION = "PASSWORD_RESET"
_PASSWORD_RESET_THRESHOLD = 5
_PASSWORD_RESET_WINDOW_MINUTES = 15

# ---------------------------------------------------------------------------
# Row-count bound for detector queries that scan recent audit windows.
# 10 000 rows ≈ 16.7 events/s sustained for 10 min — well above peak load
# for a single WIMS instance.  ORDER BY timestamp DESC ensures the most
# recent events are processed first when the bound is reached.
# ---------------------------------------------------------------------------
_MAX_AUDIT_ROWS = 10_000

# ---------------------------------------------------------------------------
# Detector helpers
# ---------------------------------------------------------------------------


def _detect_bulk_delete(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for users with >10 delete-class events in any 5-min
    sliding window within the last 10 minutes.

    Uses a correlated subquery so that every delete event counts its own
    trailing-5-min window — an attacker cannot evade by splitting events
    across a fixed floor-bucket boundary.

    Row-count bound: the outer SELECT is limited to _MAX_AUDIT_ROWS rows
    (ORDER BY timestamp DESC).  BULK_DELETE is further scoped to
    OPERATION_DELETE% actions, so this bound is effectively unreachable
    under normal delete rates.
    """
    rows = db.execute(
        text("""
            SELECT user_id,
                   window_start,
                   MAX(cnt) AS cnt,
                   (ARRAY_AGG(DISTINCT ip_address))[1] AS source_ip
            FROM (
                SELECT
                    user_id,
                    ip_address,
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
                ORDER BY t1.timestamp DESC
                LIMIT :max_rows
            ) sub
            WHERE cnt > 10
            GROUP BY user_id, window_start
        """),
        {"max_rows": _MAX_AUDIT_ROWS},
    ).fetchall()

    results = []
    for row in rows:
        user_id, window_start, cnt, source_ip = row
        window_key = window_start.strftime("%Y%m%d%H%M") if window_start else "unknown"
        results.append(
            {
                "anomaly_type": "BULK_DELETE",
                "subject_user_id": str(user_id),
                "severity": "HIGH",
                "details": {"count": int(cnt), "window_start": str(window_start)},
                "dedup_key": f"BULK_DELETE:{user_id}:{window_key}",
                "source_ip": source_ip,
            }
        )
    return results


def _detect_off_hours(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for high-sensitivity actions performed outside
    06:00–21:59 Asia/Manila time in the last 60 seconds.

    No explicit row-count bound is needed here: the 60-second window combined
    with specific action-type filters (PII_EXPORT, BACKUP_TRIGGERED,
    BREACH_STATUS_UPDATE, CREATE_INCIDENT_FROM_ALERT, AUDIT_EXPORT,
    ROLE_CHANGE_TO_%)
    naturally limits the result set to a handful of rows under any reasonable
    audit volume.
    """
    rows = db.execute(
        text("""
            SELECT audit_id, user_id, action_type, ip_address, timestamp
            FROM wims.system_audit_trails
            WHERE (
                action_type IN (
                    'PII_EXPORT', 'BACKUP_TRIGGERED', 'BREACH_STATUS_UPDATE',
                    'CREATE_INCIDENT_FROM_ALERT', 'AUDIT_EXPORT'
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

    No explicit row-count bound is needed here: the 60-second window combined
    with the ROLE_CHANGE_TO_% action-type filter naturally limits the result
    set.  Role-change events are inherently rare.
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

    Row-count bound: the sliding CTE is limited to _MAX_AUDIT_ROWS rows
    (ORDER BY timestamp DESC).  This is the primary guard against OOM under
    audit flood — the sliding CTE previously scanned ALL events in the
    10-minute window with no cap.  Action-type filtering was considered but
    rejected: RAPID_IP_SWITCH detects IP changes across ALL action types;
    filtering to auth-only actions would miss IP switches from data-access
    or admin actions, creating false negatives.
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
                ORDER BY t1.timestamp DESC
                LIMIT :max_rows
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
        """),
        {"max_rows": _MAX_AUDIT_ROWS},
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


def _detect_suspicious_query_pattern(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for users with >_SUSPICIOUS_QUERY_THRESHOLD PII_EXPORT
    actions in any 5-min sliding window within the last 10 minutes.

    Uses a correlated subquery (same pattern as _detect_bulk_delete) so that every
    PII_EXPORT event counts its own trailing-5-min window — cross-boundary burst
    evasion is prevented.

    Detection source: wims.system_audit_trails (audit-trail proxy).
    pg_stat_statements is not enabled in this stack; see GH #280 for rationale.
    """
    rows = db.execute(
        text("""
            SELECT user_id,
                   window_start,
                   MAX(cnt) AS cnt,
                   (ARRAY_AGG(DISTINCT ip_address))[1] AS source_ip
            FROM (
                SELECT
                    user_id,
                    ip_address,
                    date_trunc('minute', timestamp)
                        - (EXTRACT(MINUTE FROM timestamp)::int % 5) * interval '1 minute'
                        AS window_start,
                    (SELECT COUNT(*)
                     FROM wims.system_audit_trails t2
                     WHERE t2.user_id = t1.user_id
                       AND t2.action_type = :action
                       AND t2.timestamp >= t1.timestamp - interval '5 minutes'
                       AND t2.timestamp <= t1.timestamp
                    ) AS cnt
                FROM wims.system_audit_trails t1
                WHERE t1.action_type = :action
                  AND t1.timestamp >= now() - interval '10 minutes'
                  AND t1.user_id IS NOT NULL
            ) sub
            WHERE cnt > :threshold
            GROUP BY user_id, window_start
            LIMIT :max_rows
        """),
        {"action": _PII_EXPORT_ACTION, "threshold": _SUSPICIOUS_QUERY_THRESHOLD, "max_rows": _MAX_AUDIT_ROWS},
    ).fetchall()

    results = []
    for row in rows:
        user_id, window_start, cnt, source_ip = row
        window_key = window_start.strftime("%Y%m%d%H%M") if window_start else "unknown"
        results.append(
            {
                "anomaly_type": "SUSPICIOUS_QUERY_PATTERN",
                "subject_user_id": str(user_id),
                "severity": "HIGH",
                "details": {
                    "action_type": _PII_EXPORT_ACTION,
                    "count": int(cnt),
                    "window_minutes": 5,
                    "threshold": _SUSPICIOUS_QUERY_THRESHOLD,
                },
                "dedup_key": f"SUSPICIOUS_QUERY_PATTERN:{user_id}:{window_key}",
                "source_ip": source_ip,
            }
        )
    return results


def _detect_password_reset_abuse(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for users with >_PASSWORD_RESET_THRESHOLD
    PASSWORD_RESET actions in any 15-min sliding window within the last
    30 minutes (RP-26).

    Uses a correlated subquery (same pattern as _detect_bulk_delete and
    _detect_suspicious_query_pattern) so that every PASSWORD_RESET event
    counts its own trailing-15-min window — cross-boundary burst evasion
    is prevented.

    Detection source: wims.system_audit_trails. The Keycloak
    wims-audit-event-listener SPI writes PASSWORD_RESET rows when
    Keycloak emits UPDATE_PASSWORD or SEND_RESET_PASSWORD events.
    nginx already rate-limits reset-credentials POSTs (1r/m burst=2);
    this detector provides the app-level anomaly signal for repeated
    reset attempts that slip through the network-level limiter.
    """
    rows = db.execute(
        text("""
            SELECT user_id,
                   window_start,
                   MAX(cnt) AS cnt,
                   (ARRAY_AGG(DISTINCT ip_address))[1] AS source_ip
            FROM (
                SELECT
                    user_id,
                    ip_address,
                    date_trunc('minute', timestamp)
                        - (EXTRACT(MINUTE FROM timestamp)::int % :window_minutes) * interval '1 minute'
                        AS window_start,
                    (SELECT COUNT(*)
                     FROM wims.system_audit_trails t2
                     WHERE t2.user_id = t1.user_id
                       AND t2.action_type = :action
                       AND t2.timestamp >= t1.timestamp - (:window_minutes || ' minutes')::interval
                       AND t2.timestamp <= t1.timestamp
                    ) AS cnt
                FROM wims.system_audit_trails t1
                WHERE t1.action_type = :action
                  AND t1.timestamp >= now() - (:scan_minutes || ' minutes')::interval
                  AND t1.user_id IS NOT NULL
                ORDER BY t1.timestamp DESC
                LIMIT :max_rows
            ) sub
            WHERE cnt > :threshold
            GROUP BY user_id, window_start
        """),
        {
            "action": _PASSWORD_RESET_ACTION,
            "threshold": _PASSWORD_RESET_THRESHOLD,
            "window_minutes": _PASSWORD_RESET_WINDOW_MINUTES,
            "scan_minutes": _PASSWORD_RESET_WINDOW_MINUTES * 2,
            "max_rows": _MAX_AUDIT_ROWS,
        },
    ).fetchall()

    results = []
    for row in rows:
        user_id, window_start, cnt, source_ip = row
        window_key = window_start.strftime("%Y%m%d%H%M") if window_start else "unknown"
        results.append(
            {
                "anomaly_type": "PASSWORD_RESET_ABUSE",
                "subject_user_id": str(user_id),
                "severity": "MEDIUM",
                "details": {
                    "count": int(cnt),
                    "window_minutes": _PASSWORD_RESET_WINDOW_MINUTES,
                    "threshold": _PASSWORD_RESET_THRESHOLD,
                },
                "dedup_key": f"PASSWORD_RESET_ABUSE:{user_id}:{window_key}",
                "source_ip": source_ip,
            }
        )
    return results


# ---------------------------------------------------------------------------
# Impossible Travel helpers
# ---------------------------------------------------------------------------

_IMPOSSIBLE_TRAVEL_MAX_SPEED_KMH = 900  # commercial aviation ceiling
_IMPOSSIBLE_TRAVEL_MIN_DISTANCE_KM = 500  # ignore hops within the same metro
_EARTH_RADIUS_KM = 6_371.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in km between two lat/lon points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(min(math.sqrt(a), 1.0))


def _load_geoip_reader():
    """Return an open geoip2 City reader, or None if unavailable."""
    db_path = os.environ.get("GEOIP_DB_PATH", "")
    if not db_path or not os.path.isfile(db_path):
        return None
    try:
        import geoip2.database  # type: ignore[import-untyped]

        return geoip2.database.Reader(db_path)
    except Exception:
        return None


def _geolocate(reader, ip: str):
    """Return (lat, lon, country_iso) for ip, or None on failure."""
    try:
        rec = reader.city(ip)
        lat = rec.location.latitude
        lon = rec.location.longitude
        country = rec.country.iso_code or "??"
        if lat is None or lon is None:
            return None
        return (lat, lon, country)
    except Exception:
        return None


def _detect_impossible_travel(db: Session) -> list[dict[str, Any]]:
    """Return anomaly dicts for logins where a user's consecutive IPs imply
    travel faster than _IMPOSSIBLE_TRAVEL_MAX_SPEED_KMH km/h.

    Algorithm:
    1. Load MaxMind GeoLite2-City reader from GEOIP_DB_PATH. Skip if absent.
    2. Query the last 24h of LOGIN_SUCCESS audit rows, ordered per user.
    3. For each consecutive pair of logins from different IPs, compute:
       - great-circle distance between geolocated coordinates
       - hours elapsed between the two events
       - implied speed = distance / hours
    4. Emit an anomaly if speed > threshold AND distance > minimum.

    Skips loopback/private IPs (cannot be geolocated).
    """
    reader = _load_geoip_reader()
    if reader is None:
        return []

    try:
        rows = db.execute(
            text("""
                SELECT user_id, ip_address, timestamp
                FROM wims.system_audit_trails
                WHERE action_type IN ('LOGIN_SUCCESS', 'LOGIN')
                  AND timestamp >= now() - interval '24 hours'
                  AND user_id IS NOT NULL
                  AND ip_address IS NOT NULL
                  AND ip_address NOT IN ('127.0.0.1', '::1', 'localhost')
                ORDER BY user_id, timestamp ASC
            """)
        ).fetchall()
    except Exception as exc:
        logger.warning("Impossible Travel query failed: %s", exc)
        reader.close()
        return []

    results = []
    # Group by user
    by_user: dict[str, list[tuple[str, Any]]] = {}
    for row in rows:
        uid = str(row[0])
        by_user.setdefault(uid, []).append((row[1], row[2]))

    for user_id, events in by_user.items():
        seen_ips: set[str] = set()
        for i in range(len(events) - 1):
            ip_a, ts_a = events[i]
            ip_b, ts_b = events[i + 1]
            if ip_a == ip_b or ip_b in seen_ips:
                continue
            seen_ips.add(ip_a)

            geo_a = _geolocate(reader, ip_a)
            geo_b = _geolocate(reader, ip_b)
            if geo_a is None or geo_b is None:
                continue

            lat_a, lon_a, country_a = geo_a
            lat_b, lon_b, country_b = geo_b
            distance_km = _haversine_km(lat_a, lon_a, lat_b, lon_b)
            if distance_km < _IMPOSSIBLE_TRAVEL_MIN_DISTANCE_KM:
                continue

            delta_sec = (ts_b - ts_a).total_seconds()
            if delta_sec <= 0:
                continue
            speed_kmh = distance_km / (delta_sec / 3600)

            if speed_kmh > _IMPOSSIBLE_TRAVEL_MAX_SPEED_KMH:
                window_key = ts_a.strftime("%Y%m%d%H%M")
                results.append(
                    {
                        "anomaly_type": "IMPOSSIBLE_TRAVEL",
                        "subject_user_id": user_id,
                        "severity": "HIGH",
                        "details": {
                            "ip_a": ip_a,
                            "ip_b": ip_b,
                            "country_a": country_a,
                            "country_b": country_b,
                            "distance_km": round(distance_km, 1),
                            "elapsed_seconds": int(delta_sec),
                            "implied_speed_kmh": round(speed_kmh, 1),
                            "timestamp_a": str(ts_a),
                            "timestamp_b": str(ts_b),
                        },
                        "dedup_key": f"IMPOSSIBLE_TRAVEL:{user_id}:{ip_a}:{ip_b}:{window_key}",
                        "source_ip": ip_b,
                    }
                )

    reader.close()
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
    _detect_suspicious_query_pattern,
    _detect_impossible_travel,
    _detect_password_reset_abuse,
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
        if total_new > 0 or total_dedup > 0:
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
