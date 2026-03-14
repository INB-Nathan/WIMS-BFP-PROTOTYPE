"""IDS-to-SLM AI Analysis via Ollama (qwen2.5:3b)."""

from __future__ import annotations

import json
import os

import httpx
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

OLLAMA_MODEL = "qwen2.5:3b"


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
        "Output strictly JSON with keys 'narrative' (string) and 'confidence' (float 0.0-1.0)."
    )

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(f"{_ollama_url()}/api/generate", json=payload)

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

    narrative = parsed.get("narrative", "")
    confidence = float(parsed.get("confidence", 0.0))

    db.execute(
        text("""
            UPDATE wims.security_threat_logs
            SET xai_narrative = :narrative, xai_confidence = :confidence
            WHERE log_id = :log_id
        """),
        {"narrative": narrative, "confidence": confidence, "log_id": log_id},
    )
    db.commit()

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
