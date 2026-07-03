"""IDS-to-SLM AI Analysis via Ollama (qwen2.5:1.5b)."""

from __future__ import annotations

import json
import logging
import os
import re
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
# Redis inference lock — prevents concurrent Suricata AI inference for one log_id.
# TTL matches the max Ollama timeout so locks don't orphan on crash.
# ---------------------------------------------------------------------------
_ANALYSIS_LOCK_PREFIX = "wims:ai:lock:"
_ANALYSIS_LOCK_TTL = int(os.environ.get("OLLAMA_TIMEOUT", "480")) + 60

# ---------------------------------------------------------------------------
# Ollama HTTP timeout (seconds). Override via OLLAMA_TIMEOUT env var.
# Default 480s — CPU-only Ollama can take several minutes per inference.
# ---------------------------------------------------------------------------
_OLLAMA_DEFAULT_TIMEOUT = 480.0
# Retry: 3 attempts, exponential backoff 2s/4s/8s, only on ConnectError + 5xx.
_OLLAMA_MAX_RETRIES = 3
_OLLAMA_RETRY_BASE_DELAY = 2.0
# Keep CPU-only inference bounded. The VPS runs Qwen on CPU, and uncapped JSON
# generation has been observed to run for 8-16 minutes per request.
_OLLAMA_DEFAULT_NUM_PREDICT = 256
_OLLAMA_DEFAULT_RECOMMENDED_ACTION_NUM_PREDICT = 384

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


# ---------------------------------------------------------------------------
# Analysis lock (Redis) — prevents concurrent Suricata AI inference for the same log
# ---------------------------------------------------------------------------


async def acquire_analysis_lock(log_id: int) -> bool:
    """Try to acquire a Redis lock for AI inference on this log.

    Returns True if the lock was acquired (no concurrent inference running).
    The lock auto-expires after _ANALYSIS_LOCK_TTL seconds.
    """
    redis = _get_metrics_redis()
    try:
        result = await redis.set(
            f"{_ANALYSIS_LOCK_PREFIX}{log_id}",
            "1",
            nx=True,
            ex=_ANALYSIS_LOCK_TTL,
        )
        return result is True
    finally:
        await redis.aclose()


async def release_analysis_lock(log_id: int) -> None:
    """Release the Redis analysis lock for this log."""
    redis = _get_metrics_redis()
    try:
        await redis.delete(f"{_ANALYSIS_LOCK_PREFIX}{log_id}")
    finally:
        await redis.aclose()


async def get_analysis_status(log_id: int, db: Session) -> str:
    """Return the analysis status for a log: 'running', 'completed', or 'idle'.

    'running'  — Redis lock exists (analysis in progress)
    'completed' — xai_narrative is populated in DB
    'idle'     — neither
    """
    redis = _get_metrics_redis()
    try:
        lock_exists = await redis.exists(f"{_ANALYSIS_LOCK_PREFIX}{log_id}")
    finally:
        await redis.aclose()

    if lock_exists:
        return "running"

    row = db.execute(
        text("SELECT xai_narrative FROM wims.security_threat_logs WHERE log_id = :log_id"),
        {"log_id": log_id},
    ).fetchone()
    if row and row[0]:
        return "completed"

    return "idle"


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


def _ollama_num_predict() -> int:
    """Return the maximum generated-token budget for Ollama requests."""
    env_val = os.environ.get("OLLAMA_NUM_PREDICT")
    if env_val is not None:
        try:
            value = int(env_val)
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass
        logger.warning(
            "Invalid OLLAMA_NUM_PREDICT=%r, using default %d",
            env_val,
            _OLLAMA_DEFAULT_NUM_PREDICT,
        )
    return _OLLAMA_DEFAULT_NUM_PREDICT


def _ollama_recommended_action_num_predict() -> int:
    """Return generated-token budget for stage-2 recommended actions."""
    env_val = os.environ.get("OLLAMA_RECOMMENDED_ACTION_NUM_PREDICT")
    if env_val is not None:
        try:
            value = int(env_val)
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass
        logger.warning(
            "Invalid OLLAMA_RECOMMENDED_ACTION_NUM_PREDICT=%r, using default %d",
            env_val,
            _OLLAMA_DEFAULT_RECOMMENDED_ACTION_NUM_PREDICT,
        )
    return _OLLAMA_DEFAULT_RECOMMENDED_ACTION_NUM_PREDICT


def _truncate_for_narrative(value: str, max_len: int = 700) -> str:
    """Keep repaired XAI fields readable and bounded."""
    value = value.strip()
    if len(value) <= max_len:
        return value
    return value[: max_len - 1].rstrip() + "…"


def _extract_jsonish_string_field(text_value: str, key: str) -> str | None:
    """Extract a JSON string field from complete or token-truncated LLM JSON.

    Ollama can hit num_predict mid-field, leaving otherwise useful output like
    `{ "anomaly_description": "...", "log_evidence": "partial`. This helper
    scans from the requested field's opening quote and accepts a partial terminal
    string so the backend can store readable structured sections instead of raw
    broken JSON.
    """
    match = re.search(rf'"{re.escape(key)}"\s*:\s*"', text_value)
    if not match:
        return None

    chars: list[str] = []
    escaped = False
    complete = False
    for char in text_value[match.end() :]:
        if escaped:
            chars.append("\\" + char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            complete = True
            break
        chars.append(char)

    raw_value = "".join(chars).strip()
    if not raw_value:
        return None
    if escaped:
        raw_value = raw_value.rstrip("\\")

    try:
        decoded = json.loads(f'"{raw_value}"')
    except json.JSONDecodeError:
        decoded = raw_value.replace('\\"', '"').replace("\\n", "\n")

    if not complete:
        decoded = decoded.rstrip(' ,}\n\t"')
    return _truncate_for_narrative(decoded)


def _extract_jsonish_sources(text_value: str) -> list[str] | None:
    """Best-effort extraction for a complete sources array."""
    match = re.search(r'"sources"\s*:\s*(\[[^\]]*\])', text_value, re.DOTALL)
    if not match:
        return None
    try:
        sources = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    if not isinstance(sources, list) or not all(isinstance(item, str) for item in sources):
        return None
    return sources


def _coerce_text_field(value: object, max_len: int = 900) -> str:
    """Normalize model field values to readable strings for frontend cards."""
    if value is None:
        return ""
    if isinstance(value, str):
        return _truncate_for_narrative(value, max_len)
    try:
        return _truncate_for_narrative(json.dumps(value, ensure_ascii=False), max_len)
    except TypeError:
        return _truncate_for_narrative(str(value), max_len)


def _narrative_to_dict(narrative: str | None) -> dict:
    """Parse stored xai_narrative into a mutable dict, preserving raw text."""
    if not narrative:
        return {}
    try:
        parsed = json.loads(narrative)
    except json.JSONDecodeError:
        return {"anomaly_description": narrative}
    if isinstance(parsed, dict):
        return parsed
    return {"anomaly_description": _coerce_text_field(parsed)}


def _narrative_has_recommended_action(narrative: str | None) -> bool:
    data = _narrative_to_dict(narrative)
    return bool(str(data.get("recommended_action") or "").strip())


def _parse_confidence(value: object, default: float = 0.5) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        confidence = default
    if confidence > 1.0 and confidence <= 100.0:
        confidence = confidence / 100.0
    return max(0.0, min(1.0, confidence))


async def get_recommended_action_status(log_id: int, db: Session) -> str:
    """Return recommended-action status: running, completed, needs_analysis, or idle."""
    redis = _get_metrics_redis()
    try:
        lock_exists = await redis.exists(f"{_ANALYSIS_LOCK_PREFIX}{log_id}")
    finally:
        await redis.aclose()

    if lock_exists:
        return "running"

    row = db.execute(
        text("SELECT xai_narrative FROM wims.security_threat_logs WHERE log_id = :log_id"),
        {"log_id": log_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Security log not found")
    if _narrative_has_recommended_action(row[0]):
        return "completed"
    if not row[0]:
        return "needs_analysis"
    return "idle"


def _repair_threat_narrative_json(
    response_text: str,
    raw_payload: str,
    suricata_signature: str,
    classification: str,
) -> dict | None:
    """Return structured narrative data from malformed/truncated model JSON."""
    extracted = {
        key: _extract_jsonish_string_field(response_text, key)
        for key in (
            "anomaly_description",
            "log_evidence",
            "risk_assessment",
        )
    }
    if not any(extracted.values()):
        return None

    evidence_fallback = _truncate_for_narrative(raw_payload, 700) if raw_payload else ""
    if not evidence_fallback:
        evidence_fallback = (
            f'No raw payload excerpt was available; inference used signature "{suricata_signature}" '
            f'and classification "{classification}".'
        )

    return {
        "anomaly_description": extracted["anomaly_description"]
        or _truncate_for_narrative(response_text, 700),
        "log_evidence": extracted["log_evidence"] or evidence_fallback,
        "risk_assessment": extracted["risk_assessment"]
        or (
            "Potential confidentiality, integrity, and availability impact should be reviewed "
            f'based on signature "{suricata_signature}" and classification "{classification}".'
        ),
        "sources": _extract_jsonish_sources(response_text)
        or ["Suricata EVE log", "Payload content", "Signature taxonomy"],
    }


def _ollama_payload(prompt: str) -> dict:
    """Build a bounded non-streaming JSON-generation payload for Ollama.

    Options:
    - num_ctx:    1024  — low-latency default for the compact stage-1 analysis.
    - num_predict: env-configured (default 256) — hard cap on output tokens.
    - num_thread:    6  — match the Docker CPU limit (cpus: '6').
                       Using more threads than available CPUs causes
                       oversubscription and context-switching thrash.
    """
    return {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "num_ctx": 1024,
            "num_predict": _ollama_num_predict(),
            "num_thread": 6,
        },
    }


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
        f"SID={suricata_sid}, signature={json.dumps(suricata_signature)}, "
        f"classification={json.dumps(classification)}, payload={json.dumps(raw_payload)}. "
        "Return valid compact JSON with these keys only: "
        "'anomaly_description' (string; one clear paragraph explaining what the alert means), "
        "'log_evidence' (string; exact payload substrings or field values that support the anomaly), "
        "'risk_assessment' (string; concise confidentiality, integrity, availability impact), "
        "'confidence' (float 0.0-1.0), "
        "'confidence_breakdown' (object with keys 'anomaly_detection', 'classification', 'overall'), "
        "'sources' (array of strings). "
        "Do not include recommended_action; the administrator can generate that separately after reviewing this narrative."
    )

    payload = _ollama_payload(prompt)

    # Acquire Redis lock to prevent concurrent analysis of the same log
    if not await acquire_analysis_lock(log_id):
        raise HTTPException(
            status_code=409,
            detail=f"AI analysis is already running for log {log_id}",
        )

    _t0 = time.perf_counter()
    resp = await _ollama_post_with_retry(payload, call_label="analyze_threat_log", db=db)
    await _record_inference_metric("analyze_threat_log", time.perf_counter() - _t0)

    data = resp.json()
    response_text = data.get("response", "")

    # Try to parse as JSON — if it fails, gracefully degrade to raw text.
    # The frontend normalizer (normalizeNarrative) handles both structured
    # JSON and plain text narratives.
    narrative = response_text
    confidence = 0.5
    confidence_breakdown = None

    try:
        parsed = json.loads(response_text)
        if isinstance(parsed, dict):
            sources = parsed.get("sources", ["Suricata EVE log", "Ollama"])
            if not isinstance(sources, list):
                sources = ["Suricata EVE log", "Ollama"]

            narrative_data = {
                "anomaly_description": _coerce_text_field(parsed.get("anomaly_description")),
                "log_evidence": _coerce_text_field(parsed.get("log_evidence")),
                "risk_assessment": _coerce_text_field(parsed.get("risk_assessment")),
                "sources": sources,
            }
            narrative = json.dumps(narrative_data)

            confidence = _parse_confidence(parsed.get("confidence"), default=0.5)

            raw_breakdown = parsed.get("confidence_breakdown", {})
            if raw_breakdown:
                confidence_breakdown = {}
                for key in ("anomaly_detection", "classification", "overall"):
                    val = raw_breakdown.get(key, confidence)
                    confidence_breakdown[key] = _parse_confidence(val, default=confidence)
    except json.JSONDecodeError:
        repaired = _repair_threat_narrative_json(
            response_text,
            raw_payload,
            suricata_signature,
            classification,
        )
        if repaired:
            narrative = json.dumps(repaired)
            logger.warning(
                "Ollama response for log %d was not valid JSON; stored repaired structured narrative",
                log_id,
            )
        else:
            logger.warning(
                "Ollama response for log %d was not valid JSON, storing as raw narrative", log_id
            )

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
            "breakdown": json.dumps(confidence_breakdown) if confidence_breakdown else None,
            "log_id": log_id,
        },
    )
    db.commit()

    # Release the analysis lock — only after DB is committed so that the
    # status endpoint reliably sees "completed" (xai_narrative IS NOT NULL).
    await release_analysis_lock(log_id)

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


async def generate_recommended_action(log_id: int, db: Session) -> dict:
    """Generate only the recommended_action field as stage 2 of XAI review."""
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

    if not row[7]:
        raise HTTPException(status_code=409, detail="Run AI analysis before generating action")

    narrative_data = _narrative_to_dict(row[7])
    if str(narrative_data.get("recommended_action") or "").strip():
        return {
            "log_id": row[0],
            "timestamp": row[1].isoformat() if row[1] else None,
            "source_ip": row[2],
            "destination_ip": row[3],
            "suricata_sid": row[4],
            "severity_level": row[5],
            "raw_payload": row[6],
            "xai_narrative": json.dumps(narrative_data),
            "xai_confidence": row[8],
            "admin_action_taken": row[9],
            "resolved_at": row[10].isoformat() if row[10] else None,
            "reviewed_by": str(row[11]) if row[11] else None,
        }

    if not await acquire_analysis_lock(log_id):
        raise HTTPException(
            status_code=409,
            detail=f"AI inference is already running for log {log_id}",
        )

    raw_payload = row[6] or ""
    suricata_signature = row[12] or ""
    classification = row[13] or ""
    anomaly = _coerce_text_field(narrative_data.get("anomaly_description"), max_len=1200)
    evidence = _coerce_text_field(narrative_data.get("log_evidence"), max_len=900)
    risk = _coerce_text_field(narrative_data.get("risk_assessment"), max_len=900)

    prompt = (
        "You are a BFP WIMS incident-response advisor. Generate only recommended actions.\n"
        f"Severity: {row[5]}\n"
        f"SID: {row[4]}\n"
        f"Signature: {suricata_signature}\n"
        f"Classification: {classification}\n"
        f"Anomaly summary: {json.dumps(anomaly)}\n"
        f"Evidence summary: {json.dumps(evidence)}\n"
        f"Risk summary: {json.dumps(risk)}\n"
        f"Raw Payload Excerpt: {json.dumps(raw_payload[:1800])}\n"
        "Return ONLY valid JSON. No markdown. Values must be strings except confidence must be a decimal 0.0 to 1.0. "
        'Schema: {"recommended_action": string, "risk_assessment": string, "confidence": number}. '
        "recommended_action must be 4 concise sentences covering: immediate containment, logs/evidence to inspect, "
        "remediation for the exposed route/configuration, and monitoring for recurrence. "
        "Use concrete details from the signature and payload; do not return generic labels like only 'containment'."
    )

    payload = _ollama_payload(prompt)
    payload["options"]["num_predict"] = _ollama_recommended_action_num_predict()

    confidence = row[8] if row[8] is not None else 0.5
    try:
        _t0 = time.perf_counter()
        resp = await _ollama_post_with_retry(
            payload,
            call_label="generate_recommended_action",
            db=db,
        )
        await _record_inference_metric(
            "generate_recommended_action",
            time.perf_counter() - _t0,
        )

        response_text = resp.json().get("response", "")
        recommended_action = ""
        risk_assessment = ""
        try:
            parsed = json.loads(response_text)
            if isinstance(parsed, dict):
                recommended_action = _coerce_text_field(
                    parsed.get("recommended_action"), max_len=1200
                )
                risk_assessment = _coerce_text_field(parsed.get("risk_assessment"), max_len=900)
                confidence = _parse_confidence(parsed.get("confidence"), default=float(confidence))
        except json.JSONDecodeError:
            recommended_action = (
                _extract_jsonish_string_field(response_text, "recommended_action") or ""
            )
            risk_assessment = _extract_jsonish_string_field(response_text, "risk_assessment") or ""

        if not recommended_action:
            recommended_action = _truncate_for_narrative(response_text, 1200) or (
                "Review the source request and related logs, block or rate-limit the source if malicious, "
                "and remediate the exposed endpoint or rule condition identified by the Suricata signature."
            )

        narrative_data["recommended_action"] = recommended_action
        if risk_assessment and not str(narrative_data.get("risk_assessment") or "").strip():
            narrative_data["risk_assessment"] = risk_assessment
        sources = narrative_data.get("sources")
        if isinstance(sources, list):
            if "Ollama recommended-action pass" not in sources:
                sources.append("Ollama recommended-action pass")
        else:
            narrative_data["sources"] = [
                "Suricata EVE log",
                "Payload content",
                "Signature taxonomy",
                "Ollama recommended-action pass",
            ]

        narrative = json.dumps(narrative_data)
        db.execute(
            text("""
                UPDATE wims.security_threat_logs
                SET xai_narrative = :narrative,
                    xai_confidence = :confidence
                WHERE log_id = :log_id
            """),
            {"narrative": narrative, "confidence": confidence, "log_id": log_id},
        )
        db.commit()

        await publish_security_event(
            "security.ai_recommended_action_complete",
            log_id=log_id,
            severity=row[5],
            extra={"xai_confidence": confidence},
        )
    finally:
        await release_analysis_lock(log_id)

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
        "Provide a structured analysis as JSON with these keys: "
        "'anomaly_description' (string), "
        "'log_evidence' (string), "
        "'risk_assessment' (string), "
        "'recommended_action' (string), "
        "'confidence' (float 0.0-1.0)."
    )

    payload = _ollama_payload(prompt)

    _t0 = time.perf_counter()
    resp = await _ollama_post_with_retry(payload, call_label="analyze_audit_logs", db=db)
    await _record_inference_metric("analyze_audit_logs", time.perf_counter() - _t0)

    data = resp.json()
    response_text = data.get("response", "")
    anomaly_description = ""
    log_evidence = ""
    risk_assessment = ""
    recommended_action = ""
    confidence = 0.5

    try:
        parsed = json.loads(response_text)
        if isinstance(parsed, dict):
            anomaly_description = parsed.get("anomaly_description", "")
            log_evidence = parsed.get("log_evidence", "")
            risk_assessment = parsed.get("risk_assessment", "")
            recommended_action = parsed.get("recommended_action", "")
            try:
                confidence = float(parsed.get("confidence", 0.5))
            except (TypeError, ValueError):
                confidence = 0.5
            confidence = max(0.0, min(1.0, confidence))
    except json.JSONDecodeError:
        logger.warning("Ollama returned invalid JSON for audit analysis, using raw text")

    return {
        "audit_ids": audit_ids,
        "anomaly_description": anomaly_description,
        "log_evidence": log_evidence,
        "risk_assessment": risk_assessment,
        "recommended_action": recommended_action,
        "confidence": confidence,
        "entries_analyzed": len(entries),
    }
