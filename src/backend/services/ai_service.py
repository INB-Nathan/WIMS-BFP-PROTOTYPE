"""IDS-to-SLM AI Analysis via Ollama (qwen2.5:3b)."""

from __future__ import annotations

import json
import logging
import os

import httpx
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.event_bus import publish_security_event
from utils.config import get_config

logger = logging.getLogger("wims.ai_service")
OLLAMA_MODEL = "qwen2.5:3b"

logger = logging.getLogger("wims.ai_service")


def _ollama_url() -> str:
    return os.environ.get("OLLAMA_URL", "http://wims-ollama:11434").rstrip("/")


async def analyze_threat_log(log_id: int, db: Session) -> dict:
    """
    Fetch log from wims.security_threat_logs, send to Ollama for analysis,
    update xai_narrative and xai_confidence, return updated log dict.
    """
    row = db.execute(
        text("""
            SELECT log_id, timestamp, source_ip, destination_ip, suricata_sid,
                   severity_level, raw_payload, xai_narrative, xai_confidence,
                   admin_action_taken, resolved_at, reviewed_by
            FROM wims.security_threat_logs
            WHERE log_id = :log_id
        """),
        {"log_id": log_id},
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Security log not found")

    severity_level = row[5]
    raw_payload = row[6] or ""
    suricata_sid = row[4]

    prompt = (
        f"Analyze this Suricata IDS alert: severity={severity_level}, "
        f"SID={suricata_sid}, payload={raw_payload}. "
        "Output strictly JSON with keys: "
        "'anomaly_description' (string), "
        "'log_evidence' (string), "
        "'risk_assessment' (string), "
        "'recommended_action' (string), "
        "'confidence' (float 0.0-1.0)."
    )

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }

    try:
        ai_timeout = float(get_config(db, "ai_timeout_seconds", "60"))
    except (TypeError, ValueError):
        ai_timeout = 60.0
    try:
        async with httpx.AsyncClient(timeout=ai_timeout) as client:
            resp = await client.post(f"{_ollama_url()}/api/generate", json=payload)
    except httpx.TimeoutException:
        logger.warning("Ollama analyze_threat_log timed out log_id=%s", log_id)
        raise HTTPException(status_code=502, detail="Ollama request timed out")
    except httpx.ConnectError:
        logger.warning("Ollama analyze_threat_log connect failed log_id=%s", log_id)
        raise HTTPException(status_code=502, detail="Ollama service unavailable")

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama request failed: {resp.status_code}",
        )

    data = resp.json()
    response_text = data.get("response", "{}")
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Ollama returned invalid JSON")

    narrative_data = {
        "anomaly_description": parsed.get("anomaly_description", ""),
        "log_evidence": parsed.get("log_evidence", ""),
        "risk_assessment": parsed.get("risk_assessment", ""),
        "recommended_action": parsed.get("recommended_action", ""),
    }
    narrative = json.dumps(narrative_data)
    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    db.execute(
        text("""
            UPDATE wims.security_threat_logs
            SET xai_narrative = :narrative, xai_confidence = :confidence
            WHERE log_id = :log_id
        """),
        {"narrative": narrative, "confidence": confidence, "log_id": log_id},
    )
    db.commit()

    # Publish security event
    await publish_security_event(
        "security.ai_analysis_complete",
        log_id=log_id,
        severity=row[5],
        extra={"xai_confidence": confidence},
    )

    return {
        "log_id": row[0],
        "timestamp": row[1].isoformat() if row[1] else None,
        "source_ip": row[2],
        "destination_ip": row[3],
        "suricata_sid": row[4],
        "severity_level": row[5],
        "raw_payload": row[6],
        "xai_narrative": narrative,
        "xai_confidence": confidence,
        "admin_action_taken": row[9],
        "resolved_at": row[10].isoformat() if row[10] else None,
        "reviewed_by": str(row[11]) if row[11] else None,
    }


async def generate_incident_narrative(
    incident_id: int,
    db,
) -> dict:
    """
    Generate a plain-language AI narrative for a verified fire incident.
    Fetches incident data, calls Ollama qwen2.5:3b, stores result in DB.
    Returns dict with incident_id, ai_narrative, ai_narrative_confidence.
    """
    row = db.execute(
        text("""
            SELECT
                fi.incident_id,
                fi.verification_status,
                fi.ai_narrative,
                nd.general_category,
                nd.alarm_level,
                nd.civilian_injured,
                nd.civilian_deaths,
                nd.firefighter_injured,
                nd.firefighter_deaths,
                nd.estimated_damage_php,
                nd.fire_station_name,
                nd.total_response_time_minutes,
                nd.extent_of_damage,
                nd.stage_of_fire,
                nd.city_municipality,
                nd.province_district
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                ON nd.incident_id = fi.incident_id
            WHERE fi.incident_id = :iid
              AND fi.is_archived = FALSE
        """),
        {"iid": incident_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")

    if row[1] != "VERIFIED":
        raise HTTPException(
            status_code=409,
            detail=f"Narratives only generated for VERIFIED incidents. Current status: {row[1]}",
        )

    prompt = (
        f"You are a Bureau of Fire Protection analyst. "
        f"Summarize this fire incident in 2-3 plain English sentences for a policy report. "
        f"Incident details: "
        f"Category={row[3] or 'Unknown'}, "
        f"Alarm Level={row[4] or 'Unknown'}, "
        f"Location={row[15] or 'Unknown'}, {row[14] or 'Unknown'}, "
        f"Civilian injured={row[5] or 0}, "
        f"Civilian deaths={row[6] or 0}, "
        f"Firefighter injured={row[7] or 0}, "
        f"Firefighter deaths={row[8] or 0}, "
        f"Estimated damage (PHP)={row[9] or 0}, "
        f"Fire station={row[10] or 'Unknown'}, "
        f"Response time (min)={row[11] or 'Unknown'}, "
        f"Extent of damage={row[12] or 'Unknown'}, "
        f"Fire stage={row[13] or 'Unknown'}. "
        f"Output strictly JSON with keys 'narrative' (string, 2-3 sentences) "
        f"and 'confidence' (float 0.0-1.0)."
    )

    ollama_url = _ollama_url() + "/api/generate"

    try:
        ai_timeout = float(get_config(db, "ai_timeout_seconds", "60"))
        async with httpx.AsyncClient(timeout=ai_timeout) as client:
            response = await client.post(
                ollama_url,
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                },
            )
            response.raise_for_status()
            raw = response.json().get("response", "{}")
            parsed = json.loads(raw)
            narrative = parsed.get("narrative", "")
            confidence = float(parsed.get("confidence", 0.5))
            confidence = max(0.0, min(1.0, confidence))
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama narrative generation failed: {str(e)[:200]}",
        )

    db.execute(
        text("""
            UPDATE wims.fire_incidents
            SET ai_narrative = :narrative,
                ai_narrative_confidence = :confidence
            WHERE incident_id = :iid
        """),
        {
            "narrative": narrative,
            "confidence": confidence,
            "iid": incident_id,
        },
    )
    db.commit()

    return {
        "incident_id": incident_id,
        "ai_narrative": narrative,
        "ai_narrative_confidence": confidence,
    }


async def analyze_audit_logs(audit_ids: list[int], db: Session) -> dict:
    """
    Analyze system audit trail entries for behavioral patterns via Ollama.
    Accepts a batch of audit_ids, fetches rows from wims.system_audit_trails,
    sends a structured prompt for pattern analysis, and returns the result.
    """
    if not audit_ids:
        raise HTTPException(status_code=400, detail="No audit IDs provided")

    try:
        max_batch = int(get_config(db, "ai_audit_batch_limit", "50"))
    except (TypeError, ValueError):
        max_batch = 50

    if len(audit_ids) > max_batch:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {max_batch} audit IDs per request, got {len(audit_ids)}",
        )

    rows = db.execute(
        text("""
            SELECT audit_id, user_id, action_type, table_affected,
                   record_id, ip_address, timestamp
            FROM wims.system_audit_trails
            WHERE audit_id = ANY(CAST(:ids AS bigint[]))
            ORDER BY timestamp DESC
        """),
        {"ids": audit_ids},
    ).fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="No audit logs found for given IDs")

    entries = [
        {
            "audit_id": r[0],
            "user_id": str(r[1]) if r[1] else None,
            "action_type": r[2],
            "table_affected": r[3],
            "record_id": r[4],
            "ip_address": r[5],
            "timestamp": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]

    prompt = (
        f"Analyze these system audit trail entries for suspicious patterns"
        f" (unusual CRUD patterns, role-based anomalies, geographic anomalies,"
        f" off-hours access). Entries: {json.dumps(entries, default=str)}. "
        "Output strictly JSON with keys: "
        "'anomaly_description' (string), "
        "'log_evidence' (string), "
        "'risk_assessment' (string), "
        "'recommended_action' (string), "
        "'confidence' (float 0.0-1.0)."
    )

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }

    try:
        ai_timeout = float(get_config(db, "ai_timeout_seconds", "60"))
    except (TypeError, ValueError):
        ai_timeout = 60.0
    try:
        async with httpx.AsyncClient(timeout=ai_timeout) as client:
            resp = await client.post(f"{_ollama_url()}/api/generate", json=payload)
    except httpx.TimeoutException:
        logger.warning("Ollama analyze_audit_logs timed out audit_ids=%s", audit_ids)
        raise HTTPException(status_code=502, detail="Ollama request timed out")
    except httpx.ConnectError:
        logger.warning("Ollama analyze_audit_logs connect failed audit_ids=%s", audit_ids)
        raise HTTPException(status_code=502, detail="Ollama service unavailable")

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama request failed: {resp.status_code}",
        )

    data = resp.json()
    response_text = data.get("response", "{}")
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Ollama returned invalid JSON")

    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    return {
        "audit_ids": audit_ids,
        "anomaly_description": parsed.get("anomaly_description", ""),
        "log_evidence": parsed.get("log_evidence", ""),
        "risk_assessment": parsed.get("risk_assessment", ""),
        "recommended_action": parsed.get("recommended_action", ""),
        "confidence": confidence,
        "entries_analyzed": len(entries),
    }
