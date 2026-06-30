"""IDS-to-SLM AI Analysis via Ollama (qwen2.5:1.5b)."""

from __future__ import annotations

import json
import logging
import os
import time

import httpx
import redis.asyncio as aioredis
import redis.exceptions
from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.event_bus import publish_security_event
from utils.config import get_config
from utils.external_service import (
    CircuitBreakerOpenError,
    ExternalServiceClient,
    ExternalServiceError,
)
from utils.metrics import AI_INFERENCE_DURATION

logger = logging.getLogger("wims.ai_service")
OLLAMA_MODEL = "qwen2.5:1.5b"

# ---------------------------------------------------------------------------
# Ollama HTTP timeout (seconds). Override via OLLAMA_TIMEOUT env var.
# Default 480s — Qwen2.5-3B on CPU-only takes up to 6+ min per inference.
# ---------------------------------------------------------------------------
_OLLAMA_DEFAULT_TIMEOUT = 480.0
# Retry: 3 attempts, exponential backoff 2s/4s/8s, only on ConnectError + 5xx.
_OLLAMA_MAX_RETRIES = 3
_OLLAMA_RETRY_BASE_DELAY = 2.0

# Shared resilient wrapper for Ollama — gains circuit breaker, size cap,
# and concurrency cap. Retry is handled by the wrapper (matches existing behavior
# except TimeoutException is NOT retried, preserving the existing contract).
_ollama_client: ExternalServiceClient | None = None


def _get_ollama_client(timeout: float) -> ExternalServiceClient:
    """Return a shared ExternalServiceClient for Ollama, lazily created."""
    global _ollama_client
    if _ollama_client is None:
        # _OLLAMA_MAX_RETRIES=3 in the legacy code meant 3 total attempts
        # (range(3) loop), i.e. 1 initial + 2 retries. Translate to the
        # wrapper convention where max_retries counts retries only.
        _ollama_client = ExternalServiceClient(
            service_name="ollama",
            timeout=timeout,
            max_retries=_OLLAMA_MAX_RETRIES - 1,  # 2 retries → 3 total attempts
            base_delay=_OLLAMA_RETRY_BASE_DELAY,
            response_size_limit=10 * 1024 * 1024,  # 10 MB
            concurrency_limit=5,
            cb_failure_threshold=5,
            cb_recovery_timeout=60.0,
            retry_on_timeout=False,  # Preserve existing Ollama contract
        )
    # Update timeout in case env changed between calls
    _ollama_client.timeout = timeout
    return _ollama_client


def _get_metrics_redis() -> aioredis.Redis:
    """Create an async Redis client for one metric write.

    Do not cache this client globally: redis.asyncio clients can retain event-loop
    affinity, which breaks pytest-asyncio's per-test event loops and can raise
    `RuntimeError: Event loop is closed` in later tests.
    """
    return aioredis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))


async def _record_inference_metric(function_name: str, elapsed_s: float) -> None:
    """Record AI inference timing to Prometheus (web process) and Redis (cross-process). Fire-and-forget."""
    try:
        AI_INFERENCE_DURATION.labels(function=function_name).observe(elapsed_s)
    except Exception:
        logger.debug("Prometheus observe failed for %s", function_name, exc_info=True)

    redis_client = _get_metrics_redis()
    try:
        pipe = redis_client.pipeline()
        pipe.incr("wims:ai:inference:count")
        pipe.incrbyfloat("wims:ai:inference:sum_ms", elapsed_s * 1000.0)
        await pipe.execute()
    except redis.exceptions.RedisError:
        logger.debug("Redis metric write failed for %s", function_name, exc_info=True)
    finally:
        await redis_client.aclose()


def _ollama_url() -> str:
    return os.environ.get("OLLAMA_URL", "http://ollama:11434").rstrip("/")


def _ollama_timeout(db=None) -> float:
    """Return the Ollama HTTP timeout from env or system_config, with fallback."""
    env_val = os.environ.get("OLLAMA_TIMEOUT")
    if env_val is not None:
        try:
            return float(env_val)
        except (TypeError, ValueError):
            logger.warning(
                "Invalid OLLAMA_TIMEOUT=%r, using default %.0fs", env_val, _OLLAMA_DEFAULT_TIMEOUT
            )
    if db is not None:
        try:
            return float(get_config(db, "ai_timeout_seconds", str(int(_OLLAMA_DEFAULT_TIMEOUT))))
        except (TypeError, ValueError):
            pass
    return _OLLAMA_DEFAULT_TIMEOUT


async def _ollama_post_with_retry(payload: dict, call_label: str = "", db=None) -> httpx.Response:
    """POST to Ollama through the resilient wrapper.

    Delegates retry, circuit breaker, size cap, and concurrency to
    ExternalServiceClient. TimeoutException is NOT retried (preserving
    the existing contract — inference is CPU-bound).
    """
    timeout = _ollama_timeout(db)
    client = _get_ollama_client(timeout)
    url = f"{_ollama_url()}/api/generate"

    try:
        resp = await client.request_async("POST", url, json=payload)

        if resp.status_code == 200:
            return resp
        if resp.status_code >= 500:
            raise HTTPException(
                status_code=502,
                detail=f"Ollama request failed after retries: {resp.status_code}",
            )
        # Non-retryable status (4xx)
        raise HTTPException(
            status_code=502,
            detail=f"Ollama request failed: {resp.status_code}",
        )
    except CircuitBreakerOpenError:
        logger.warning("Ollama %s circuit breaker open", call_label)
        raise HTTPException(status_code=503, detail="Ollama service temporarily unavailable")
    except ExternalServiceError as exc:
        msg = str(exc)
        logger.warning("Ollama %s error: %s", call_label, msg)
        if "timed out" in msg.lower():
            raise HTTPException(status_code=502, detail="Ollama request timed out") from exc
        if "connect" in msg.lower() or "unavailable" in msg.lower():
            raise HTTPException(status_code=502, detail="Ollama service unavailable") from exc
        raise HTTPException(status_code=502, detail="Ollama transport error") from exc


async def analyze_threat_log(log_id: int, db: Session, request: Request | None = None) -> dict:
    """
    Fetch log from wims.security_threat_logs, send to Ollama for analysis,
    update xai_narrative and xai_confidence, return updated log dict.
    """
    row = db.execute(
        text("""
            SELECT log_id, timestamp, source_ip, destination_ip, suricata_sid,
                   severity_level, raw_payload, xai_narrative, xai_confidence,
                   admin_action_taken, resolved_at, reviewed_by,
                   suricata_signature, classification
            FROM wims.security_threat_logs
            WHERE log_id = :log_id
        """),
        {"log_id": log_id},
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Security log not found")

    # ── Return cached analysis if already done ────────────────────────────
    existing_narrative = row[7]
    existing_confidence = row[8]
    if existing_narrative:
        return {
            "log_id": row[0],
            "timestamp": row[1].isoformat() if row[1] else None,
            "source_ip": row[2],
            "destination_ip": row[3],
            "suricata_sid": row[4],
            "severity_level": row[5],
            "raw_payload": row[6],
            "xai_narrative": existing_narrative,
            "xai_confidence": existing_confidence,
            "admin_action_taken": row[9],
            "resolved_at": row[10].isoformat() if row[10] else None,
            "reviewed_by": str(row[11]) if row[11] else None,
        }

    severity_level = row[5]
    raw_payload = row[6] or ""
    suricata_sid = row[4]
    # Include the signature + classification in the prompt so the XAI LLM
    # can explain what the alert means.  Custom WIMS SIDs 1000001-1000134 are
    # NOT in any public Suricata feed, so SID=1000001 is opaque to Ollama.
    # The human-readable signature ("WIMS OWASP A03 SQLi UNION SELECT") tells
    # the LLM the attack type; the classification ("high_signal_threat") tells
    # the threat model.  Without these, the LLM can only guess from the raw
    # payload, producing generic narratives that don't tell humans what the
    # attack is or what to do for future purposes.
    suricata_signature = row[12] or ""
    classification = row[13] or ""

    prompt = (
        f"Analyze this Suricata IDS alert: severity={json.dumps(severity_level)}, "
        f'SID={suricata_sid}, signature="{suricata_signature}", '
        f"classification={classification}, payload={json.dumps(raw_payload)}. "
        "Output strictly JSON with keys: "
        "'anomaly_description' (string), "
        "'log_evidence' (string), "
        "'risk_assessment' (string), "
        "'recommended_action' (string), "
        "'confidence' (float 0.0-1.0), "
        "'confidence_breakdown' (object with keys 'anomaly_detection', 'classification', 'overall', each float 0.0-1.0), "
        "'sources' (array of strings indicating which data sources were used)."
    )

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "num_ctx": 1024,
            "num_predict": 512,
            "num_thread": 8,
        },
    }

    if request is not None and await request.is_disconnected():
        logger.info("Client disconnected before AI analysis of log %d", log_id)
        raise HTTPException(status_code=499, detail="Client disconnected")

    _t0 = time.perf_counter()
    resp = await _ollama_post_with_retry(payload, call_label="analyze_threat_log", db=db)
    await _record_inference_metric("analyze_threat_log", time.perf_counter() - _t0)

    data = resp.json()
    response_text = data.get("response", "{}")
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Ollama returned invalid JSON")

    if request is not None and await request.is_disconnected():
        logger.info("Client disconnected during AI analysis of log %d, skipping DB write", log_id)
        raise HTTPException(status_code=499, detail="Client disconnected")

    # Extract sources
    sources = parsed.get("sources", ["Suricata EVE log", "Ollama"])
    if not isinstance(sources, list):
        sources = ["Suricata EVE log", "Ollama"]

    narrative_data = {
        "anomaly_description": parsed.get("anomaly_description", ""),
        "log_evidence": parsed.get("log_evidence", ""),
        "risk_assessment": parsed.get("risk_assessment", ""),
        "recommended_action": parsed.get("recommended_action", ""),
        "sources": sources,
    }
    narrative = json.dumps(narrative_data)
    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    # Extract confidence breakdown
    raw_breakdown = parsed.get("confidence_breakdown", {})
    confidence_breakdown = {}
    for key in ("anomaly_detection", "classification", "overall"):
        val = raw_breakdown.get(key, confidence)
        try:
            confidence_breakdown[key] = max(0.0, min(1.0, float(val)))
        except (TypeError, ValueError):
            confidence_breakdown[key] = confidence

    db.execute(
        text("""
            UPDATE wims.security_threat_logs
            SET xai_narrative = :narrative,
                xai_confidence = :confidence,
                xai_confidence_breakdown = CAST(:breakdown AS jsonb)
            WHERE log_id = :log_id
        """),
        {
            "narrative": narrative,
            "confidence": confidence,
            "breakdown": json.dumps(confidence_breakdown),
            "log_id": log_id,
        },
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
        "xai_confidence_breakdown": confidence_breakdown,
        "admin_action_taken": row[9],
        "resolved_at": row[10].isoformat() if row[10] else None,
        "reviewed_by": str(row[11]) if row[11] else None,
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
        "options": {
            "num_ctx": 1024,
            "num_predict": 512,
            "num_thread": 8,
        },
    }

    _t0 = time.perf_counter()
    resp = await _ollama_post_with_retry(payload, call_label="analyze_audit_logs", db=db)
    await _record_inference_metric("analyze_audit_logs", time.perf_counter() - _t0)

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
