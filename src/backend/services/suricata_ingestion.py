"""Suricata EVE log ingestion — parse NDJSON alerts and insert into wims.security_threat_logs."""

from __future__ import annotations

import json
import logging
import os

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# In-memory position tracking for tail behavior (path -> byte offset).
# Optional: migrate to Redis for multi-worker persistence.
_eve_file_positions: dict[str, int] = {}


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


def _insert_row(db: Session, row: dict) -> None:
    """Insert a threat log row via raw SQL (schema uses timestamp, destination_ip)."""
    db.execute(
        text("""
            INSERT INTO wims.security_threat_logs
                (source_ip, destination_ip, suricata_sid, severity_level, raw_payload)
            VALUES
                (:source_ip, :destination_ip, :suricata_sid, :severity_level, :raw_payload)
        """),
        row,
    )


def ingest_eve_file(path: str, *, db_session: Session | None = None) -> int:
    """
    Read EVE file (tail from last position), parse alert lines, insert into security_threat_logs.
    Returns number of rows inserted.
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
            # File rotated or truncated
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
                _insert_row(db, row)
                inserted += 1
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
