"""Security threat rollups and raw-ingest filtering for SIEM noise control."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from utils.config import get_config

_LOW_VALUE_CLASSIFICATIONS = frozenset(
    {
        "internet_background_noise",
        "scanner",
        "bot_probe",
    }
)
_RAW_KEEP_CLASSIFICATIONS = frozenset({"credential_probe", "high_signal_threat"})


def _to_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _to_int(value: str | None, *, default: int) -> int:
    try:
        parsed = int(value or "")
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 1 else default


def record_security_threat_rollups(
    db: Session,
    row: dict[str, Any],
    *,
    event_timestamp: datetime | None = None,
) -> None:
    """Increment hourly and daily aggregate buckets for a parsed Suricata alert.

    Rollups preserve weekly/monthly telemetry even when raw logs are pruned after
    24 hours or low-value alerts are not stored raw.
    """
    ts = event_timestamp or datetime.now(timezone.utc)
    params = {
        "ts": ts,
        "severity_level": row.get("severity_level") or "MEDIUM",
        "classification": row.get("classification") or "unclassified",
        "source_ip": row.get("source_ip") or "",
        "suricata_sid": int(row.get("suricata_sid") or 0),
        "suricata_signature": row.get("suricata_signature"),
    }
    db.execute(
        text("""
            INSERT INTO wims.security_threat_log_rollups (
                bucket_start,
                bucket_granularity,
                severity_level,
                classification,
                source_ip,
                suricata_sid,
                suricata_signature,
                alert_count,
                first_seen,
                last_seen
            )
            SELECT date_trunc(granularity, CAST(:ts AS timestamptz)),
                   granularity,
                   :severity_level,
                   :classification,
                   :source_ip,
                   :suricata_sid,
                   :suricata_signature,
                   1,
                   CAST(:ts AS timestamptz),
                   CAST(:ts AS timestamptz)
            FROM (VALUES ('hour'), ('day')) AS g(granularity)
            ON CONFLICT (
                bucket_granularity,
                bucket_start,
                severity_level,
                classification,
                source_ip,
                suricata_sid
            ) DO UPDATE SET
                alert_count = wims.security_threat_log_rollups.alert_count + 1,
                suricata_signature = COALESCE(
                    EXCLUDED.suricata_signature,
                    wims.security_threat_log_rollups.suricata_signature
                ),
                first_seen = LEAST(wims.security_threat_log_rollups.first_seen, EXCLUDED.first_seen),
                last_seen = GREATEST(wims.security_threat_log_rollups.last_seen, EXCLUDED.last_seen),
                updated_at = now()
        """),
        params,
    )


def should_store_raw_security_alert(db: Session, row: dict[str, Any]) -> bool:
    """Return whether an alert should be persisted in raw security_threat_logs.

    Low-value scanner/bot/background alerts are still counted in rollups but are
    not stored raw by default. High-signal and credential alerts are retained raw,
    with a short deduplication window to avoid floods from repeated probes.
    """
    severity = (row.get("severity_level") or "").upper()
    classification = row.get("classification") or "unclassified"

    store_low_value = _to_bool(get_config(db, "siem.store_low_value_raw", "false"))
    if not store_low_value and classification in _LOW_VALUE_CLASSIFICATIONS:
        return False

    should_keep = severity in {"HIGH", "CRITICAL"} or classification in _RAW_KEEP_CLASSIFICATIONS
    if not should_keep:
        return False

    window_minutes = _to_int(get_config(db, "siem.raw_dedup_window_minutes", "5"), default=5)
    duplicate = db.execute(
        text("""
            SELECT 1
            FROM wims.security_threat_logs
            WHERE timestamp >= now() - (:window_minutes || ' minutes')::interval
              AND source_ip = :source_ip
              AND COALESCE(suricata_sid, 0) = :suricata_sid
              AND severity_level = :severity_level
              AND COALESCE(classification, 'unclassified') = :classification
            LIMIT 1
        """),
        {
            "window_minutes": str(window_minutes),
            "source_ip": row.get("source_ip") or "",
            "suricata_sid": int(row.get("suricata_sid") or 0),
            "severity_level": severity,
            "classification": classification,
        },
    ).fetchone()
    return duplicate is None
