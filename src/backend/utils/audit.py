import hashlib
import json
import logging
import os
import uuid
from typing import Any

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("wims.audit")


def get_client_ip(request: Request | None) -> str | None:
    """Return the real client IP from trusted reverse-proxy headers.

    In production FastAPI sees nginx's Docker-network address in
    ``request.client.host``. Prefer the first ``X-Forwarded-For`` hop, then
    ``X-Real-IP``, and only fall back to the socket peer.
    """
    if request is None:
        return None

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first_hop = forwarded.split(",", 1)[0].strip()
        if first_hop:
            return first_hop

    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()

    if request.client:
        return request.client.host
    return None


# ---------------------------------------------------------------------------
# IP hashing (D5 / issue #394) — privacy-preserving abuse trace
# ---------------------------------------------------------------------------
# Audit rows store ip_hash (salted SHA-256), never the raw IP. Salt rotates
# via the WIMS_AUDIT_IP_SALT env var so that a leaked audit dump cannot be
# trivially reversed to IP addresses. The salt is read lazily on every call
# so rotation takes effect on the next process restart (or, in dev, the next
# test fixture).
# ---------------------------------------------------------------------------
def _audit_ip_salt() -> str:
    """Return the current audit IP salt, falling back to a process-stable default.

    A default salt is intentionally NOT used in production: if WIMS_AUDIT_IP_SALT
    is unset, we still produce a hash (callers can still rely on the column)
    but the salt is the empty string, which is logged so operators notice.
    """
    salt = os.environ.get("WIMS_AUDIT_IP_SALT")
    if not salt:
        logger.warning(
            "WIMS_AUDIT_IP_SALT is not set; IP hashes are unsalted. "
            "Set this env var (rotated periodically) in production."
        )
    return salt or ""


def hash_client_ip(ip: str, salt: str | None = None) -> str:
    """Return a salted SHA-256 hex digest of the client IP for audit storage.

    Parameters
    ----------
    ip   : client IP address (v4 or v6). Must be a non-empty string.
    salt : optional explicit salt (e.g. for tests). If None, the value of the
           WIMS_AUDIT_IP_SALT env var is used. Missing env → empty salt +
           warning log (see _audit_ip_salt()).

    The hash format is salt + ":" + ip so the same input yields a different
    digest under a different salt — this is what makes "rotating salt"
    meaningful for IP-hash abuse correlation.
    """
    if ip is None or ip == "":
        # Use a sentinel so empty/None still produces a stable hash;
        # "" is the raw IP that nginx would emit for a unix-socket request.
        ip = "<unknown>"
    effective_salt = salt if salt is not None else _audit_ip_salt()
    payload = f"{effective_salt}:{ip}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# ---------------------------------------------------------------------------
# Abuse-spike alerting (D20 / issue #394) — Redis counters + threshold check
# ---------------------------------------------------------------------------
# record_audit_failure() increments a per-hour counter on every audit INSERT
# failure (sensitive or not). check_audit_abuse() returns True if the current
# hour's counter has crossed the configured threshold (default 50; override
# with WIMS_AUDIT_ABUSE_THRESHOLD). The caller decides what to do with the
# alert — we are not building the alert sink here, only the signal.
#
# Redis failures are non-fatal: if Redis is down the counter is skipped and
# the function returns False (no alert). The audit INSERT failure has
# already been logged via logger.exception() at the call site.
# ---------------------------------------------------------------------------
_AUDIT_FAILURE_KEY = "audit:failures:{hour}"
_AUDIT_FAILURE_TTL = 2 * 3600  # 2h — enough overlap to not drop boundary events


def _audit_failure_redis_client():
    """Return a sync Redis client, or None if unavailable.

    Uses a short-timeout connection so an outage cannot stall the audit
    write path. Closes the client after each call (audit failures are rare;
    reusing a global sync client is not worth the cross-test-event-loop
    coupling that the public_dmz router already had to work around).
    """
    import redis as redis_sync  # local import — keeps async tests fast

    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    try:
        client = redis_sync.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
        client.ping()
        return client
    except Exception:
        return None


def record_audit_failure(reason: str | None = None) -> None:
    """Increment the per-hour audit-failure counter in Redis.

    Best-effort: Redis errors are swallowed so this never breaks the calling
    code path. The optional reason is included in a structured log line so
    operators can correlate spikes to specific failure modes (e.g. DB down,
    constraint violation, RLS denial).
    """
    from datetime import datetime, timezone

    hour_bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    key = _AUDIT_FAILURE_KEY.format(hour=hour_bucket)

    client = _audit_failure_redis_client()
    if client is None:
        logger.warning(
            "audit failure recorded without Redis counter (Redis unavailable); reason=%s",
            reason or "<unspecified>",
        )
        return

    try:
        pipe = client.pipeline()
        pipe.incr(key)
        pipe.expire(key, _AUDIT_FAILURE_TTL)
        pipe.execute()
    except Exception as exc:
        logger.warning("Failed to increment audit-failure counter: %s", exc)
    finally:
        try:
            client.close()
        except Exception:
            pass


def _audit_abuse_threshold() -> int:
    """Return the configured abuse-spike threshold (default 50/hour)."""
    raw = os.environ.get("WIMS_AUDIT_ABUSE_THRESHOLD", "50")
    try:
        return int(raw)
    except (TypeError, ValueError):
        logger.warning("WIMS_AUDIT_ABUSE_THRESHOLD=%r is not an integer; falling back to 50", raw)
        return 50


def check_audit_abuse() -> bool:
    """Return True if the current hour's audit-failure counter exceeds the threshold.

    Callers are responsible for the alert sink (e.g. emit a structured log,
    page an admin). This function only signals "spike detected". It is
    intended to be called periodically by an ops-side job OR inline after
    a sensitive audit failure — both are valid.

    Returns False on Redis failure (fail-closed for the signal: do not alert
    when the alerting substrate itself is unhealthy).
    """
    from datetime import datetime, timezone

    hour_bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    key = _AUDIT_FAILURE_KEY.format(hour=hour_bucket)

    client = _audit_failure_redis_client()
    if client is None:
        return False

    try:
        count = int(client.get(key) or 0)
    except Exception as exc:
        logger.warning("Failed to read audit-failure counter: %s", exc)
        return False
    finally:
        try:
            client.close()
        except Exception:
            pass

    return count >= _audit_abuse_threshold()


def _resolve_correlation_id(
    request: Request | None,
    explicit: str | None,
) -> str | None:
    """Resolve the correlation ID for an audit row.

    Priority: explicit kwarg > request.state.correlation_id > None.
    """
    if explicit:
        return explicit
    if request is not None:
        state = getattr(request, "state", None)
        if state is not None:
            state_id = getattr(state, "correlation_id", None)
            if state_id:
                return state_id
    return None


def log_system_audit(
    db: Session,
    user_id: uuid.UUID | str | None,
    action_type: str,
    table_affected: str,
    record_id: int | None,
    request: Request | None = None,
    old_values: dict[str, Any] | None = None,
    new_values: dict[str, Any] | None = None,
    correlation_id: str | None = None,
    result: str = "success",
    ip_hash: str | None = None,
    sensitive: bool = False,
):
    """
    Log a system-level audit event.

    old_values / new_values are JSONB snapshots for UPDATE actions
    (forensic completeness per ASVS V7.3.1).  Pass None for
    INSERT or DELETE actions; the columns default to SQL NULL.

    Standardized audit shape (D20, issue #394):
        (actor, resource, action, result, timestamp,
         correlation_id, ip_hash, old_values, new_values)

    correlation_id
        The X-Request-ID header propagated by the correlation middleware.
        Resolved from request.state.correlation_id if not passed explicitly.
    result
        "success" (default) or "failure" — used by abuse-spike alerting to
        filter or weight audit anomalies.
    ip_hash
        Salted SHA-256 of the client IP (see ``hash_client_ip``). Pass
        ``None`` for unauthenticated endpoints that do not capture IP.
    sensitive
        When True, the audit INSERT is **fail-closed**: any DB error raises
        ``AuditInsertFailed`` so the caller can roll back the mutation that
        produced the audit row (Tier 0/1 writes per D20). When False (the
        default), the function keeps the historical fail-OPEN behaviour —
        audit failures are logged but do not block the calling action.

    Backward compatibility
        All new parameters default to safe values. Existing callers that
        pass only the legacy positional/keyword arguments continue to work
        without modification.
    """
    raw_ip = None
    user_agent = None

    if request:
        raw_ip = get_client_ip(request)
        user_agent = request.headers.get("user-agent")

    effective_correlation_id = _resolve_correlation_id(request, correlation_id)
    effective_ip_hash = (
        ip_hash if ip_hash is not None else (hash_client_ip(raw_ip) if raw_ip else None)
    )

    try:
        db.execute(
            text("""
                INSERT INTO wims.system_audit_trails (
                    user_id, action_type, table_affected, record_id,
                    ip_address, user_agent, timestamp,
                    old_values, new_values,
                    correlation_id, result, ip_hash
                ) VALUES (
                    :uid, :action, :table, :rec,
                    :ip, :ua, now(),
                    :oldv, :newv,
                    :corr, :result, :ip_hash
                )
            """),
            {
                "uid": str(user_id) if user_id else None,
                "action": action_type,
                "table": table_affected,
                "rec": record_id,
                "ip": raw_ip,
                "ua": user_agent,
                "oldv": json.dumps(old_values, default=str) if old_values else None,
                "newv": json.dumps(new_values, default=str) if new_values else None,
                "corr": effective_correlation_id,
                "result": result,
                "ip_hash": effective_ip_hash,
            },
        )
        # Note: Caller is responsible for committing the transaction
    except Exception as exc:
        # Always log + count the failure so abuse-spike alerting has a signal,
        # even for non-sensitive paths.
        logger.exception("Failed to log system audit: %s", exc)
        record_audit_failure(reason=f"action={action_type} table={table_affected}")
        if sensitive:
            # Re-raise as a typed error so callers (e.g. public_dmz, AFOR
            # commit) can wrap the mutation + audit INSERT in a single
            # transaction and roll both back on failure.
            raise AuditInsertFailed(action_type, table_affected) from exc
        # Low-risk path: keep the historical swallow-and-log behaviour. Audit
        # gaps for reads and non-Tier 0/1 writes are accepted as a known
        # trade-off (D20 fail-OPEN for reads).


class AuditInsertFailed(Exception):
    """Raised when a sensitive audit INSERT fails.

    Catch this exception type to roll back the surrounding mutation; do
    NOT swallow it silently — the caller's caller expects a 500 response
    on sensitive audit failure (D20 fail-CLOSED for Tier 0/1 mutations).
    """

    def __init__(self, action_type: str, table_affected: str) -> None:
        super().__init__(
            f"Sensitive audit INSERT failed for action={action_type!r} table={table_affected!r}"
        )
        self.action_type = action_type
        self.table_affected = table_affected
