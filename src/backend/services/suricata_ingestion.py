"""Suricata EVE log ingestion — parse NDJSON alerts and insert into wims.security_threat_logs."""

from __future__ import annotations

import json
import logging
import os
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from services.event_bus import publish_security_event_sync

logger = logging.getLogger(__name__)

# In-memory position tracking for tail behavior (path -> byte offset).
# Optional: migrate to Redis for multi-worker persistence.
_eve_file_positions: dict[str, int] = {}

# Service account for security incident auto-creation
_SVC_SURICATA_UUID = uuid.UUID("00000000-0000-0000-0000-000000000001")
# Default location: BFP HQ Manila
_BFP_HQ_LONGITUDE = 121.0232
_BFP_HQ_LATITUDE = 14.5906
# Default region: NCR
_DEFAULT_REGION_ID = 1


def parse_eve_alert_line(line: str) -> dict | None:
    """
    Parse a single NDJSON line. Return parsed dict if event_type=="alert", else None.
    """
    line = line.strip()
    if not line:
        return None
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        return None
    if ev.get("event_type") != "alert":
        return None
    return ev


def eve_to_threat_log_row(ev: dict, *, raw_payload: str = "") -> dict:
    """
    Map EVE alert fields to wims.security_threat_logs columns.
    Severity: 1→LOW, 2→MEDIUM, 3→HIGH; default MEDIUM if missing.
    """
    alert = ev.get("alert") or {}
    sid = alert.get("signature_id")
    sev = alert.get("severity")
    if sev == 1:
        severity_level = "LOW"
    elif sev == 2:
        severity_level = "MEDIUM"
    elif sev == 3:
        severity_level = "HIGH"
    else:
        severity_level = "MEDIUM"

    return {
        "source_ip": ev.get("src_ip") or "",
        "destination_ip": ev.get("dest_ip") or "",
        "suricata_sid": int(sid) if sid is not None else None,
        "severity_level": severity_level,
        "raw_payload": raw_payload[:65535] if raw_payload else None,
    }


def _insert_row(db: Session, row: dict) -> int | None:
    """Insert a threat log row via raw SQL. Returns the inserted log_id."""
    result = db.execute(
        text("""
            INSERT INTO wims.security_threat_logs
                (source_ip, destination_ip, suricata_sid, severity_level, raw_payload)
            VALUES
                (:source_ip, :destination_ip, :suricata_sid, :severity_level, :raw_payload)
            RETURNING log_id
        """),
        row,
    )
    return result.scalar() or None


def _security_incident_exists(db, log_id: int) -> bool:
    """Check if a fire incident already exists for this security alert."""
    row = db.execute(
        text("""
            SELECT 1 FROM wims.fire_incidents
            WHERE security_alert_id = :log_id
            LIMIT 1
        """),
        {"log_id": log_id},
    ).fetchone()
    return row is not None


def _create_security_incident(
    db,
    log_id: int,
    source_ip: str,
    suricata_sid: int,
    raw_payload: str,
) -> int:
    """
    Auto-create a DRAFT fire incident from a HIGH-severity Suricata alert.
    Uses svc_suricata service account and BFP HQ as default location.
    Returns the new incident_id.
    """
    result = db.execute(
        text("""
            INSERT INTO wims.fire_incidents
                (encoder_id, region_id, location, verification_status,
                 security_alert_id)
            VALUES
                (:encoder_id, :region_id,
                 ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
                 'DRAFT',
                 :log_id)
            RETURNING incident_id
        """),
        {
            "encoder_id": _SVC_SURICATA_UUID,
            "region_id": _DEFAULT_REGION_ID,
            "lon": _BFP_HQ_LONGITUDE,
            "lat": _BFP_HQ_LATITUDE,
            "log_id": log_id,
        },
    )
    incident_id = result.fetchone()[0]

    db.execute(
        text("""
            INSERT INTO wims.incident_nonsensitive_details
                (incident_id, general_category, alarm_level, fire_station_name)
            VALUES
                (:iid, 'SECURITY', 'ALERT',
                 :station_name)
        """),
        {
            "iid": incident_id,
            "station_name": f"Auto-detected: SID={suricata_sid} SRC={source_ip}",
        },
    )

    db.execute(
        text("""
            INSERT INTO wims.incident_verification_history
                (target_type, target_id, action_by_user_id,
                 previous_status, new_status, comments)
            VALUES
                ('OFFICIAL', :iid, :uid, 'DRAFT', 'DRAFT',
                 'Auto-created from Suricata HIGH severity alert')
        """),
        {
            "iid": incident_id,
            "uid": _SVC_SURICATA_UUID,
        },
    )

    return incident_id


def ingest_eve_file(path: str, *, db_session: Session | None = None) -> int:
    """
    Read EVE file (tail from last position), parse alert lines, insert into security_threat_logs.
    For HIGH severity alerts, auto-create a DRAFT fire incident.
    Returns number of rows inserted into security_threat_logs.
    """
    if not os.path.isfile(path):
        logger.warning("EVE file not found: %s", path)
        return 0

    from database import _SessionLocal

    db = db_session if db_session is not None else _SessionLocal()
    own_session = db_session is None
    try:
        position = _eve_file_positions.get(path, 0)
        file_size = os.path.getsize(path)
        if file_size < position:
            position = 0

        inserted = 0
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(position)
            for line in f:
                line = line.rstrip("\n")
                ev = parse_eve_alert_line(line)
                if ev is None:
                    continue
                row = eve_to_threat_log_row(ev, raw_payload=line)
                log_id = _insert_row(db, row)
                if log_id is not None:
                    inserted += 1
                    # Publish security event (fire-and-forget, sync)
                    publish_security_event_sync(
                        "security.threat_detected",
                        log_id=log_id,
                        severity=row.get("severity_level"),
                        threat_type=row.get("threat_type"),
                    )
                    if row.get("severity_level") == "HIGH":
                        if not _security_incident_exists(db, log_id):
                            try:
                                incident_id = _create_security_incident(
                                    db,
                                    log_id=log_id,
                                    source_ip=row.get("source_ip", "unknown"),
                                    suricata_sid=row.get("suricata_sid", 0),
                                    raw_payload=row.get("raw_payload", ""),
                                )
                                logger.info(
                                    "Auto-created security incident %s from log_id %s",
                                    incident_id,
                                    log_id,
                                )
                            except Exception as e:
                                logger.error(
                                    "Failed to auto-create incident from log_id %s: %s",
                                    log_id,
                                    e,
                                )
            _eve_file_positions[path] = f.tell()

        if own_session:
            db.commit()
        return inserted
    except Exception:
        if own_session:
            db.rollback()
        raise
    finally:
        if own_session:
            db.close()
