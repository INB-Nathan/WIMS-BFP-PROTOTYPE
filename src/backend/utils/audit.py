import json
import logging
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


def log_system_audit(
    db: Session,
    user_id: uuid.UUID | str | None,
    action_type: str,
    table_affected: str,
    record_id: int | None,
    request: Request | None = None,
    old_values: dict[str, Any] | None = None,
    new_values: dict[str, Any] | None = None,
):
    """
    Log a system-level audit event.

    old_values / new_values are JSONB snapshots for UPDATE actions
    (forensic completeness per ASVS V7.3.1).  Pass None for
    INSERT or DELETE actions; the columns default to SQL NULL.
    """
    ip_address = None
    user_agent = None

    if request:
        ip_address = get_client_ip(request)
        user_agent = request.headers.get("user-agent")

    try:
        db.execute(
            text("""
                INSERT INTO wims.system_audit_trails (
                    user_id, action_type, table_affected, record_id,
                    ip_address, user_agent, timestamp,
                    old_values, new_values
                ) VALUES (
                    :uid, :action, :table, :rec,
                    :ip, :ua, now(),
                    :oldv, :newv
                )
            """),
            {
                "uid": str(user_id) if user_id else None,
                "action": action_type,
                "table": table_affected,
                "rec": record_id,
                "ip": ip_address,
                "ua": user_agent,
                "oldv": json.dumps(old_values, default=str) if old_values else None,
                "newv": json.dumps(new_values, default=str) if new_values else None,
            },
        )
        # Note: Caller is responsible for committing the transaction
    except Exception as e:
        logger.exception(f"Failed to log system audit: {e}")
        # We don't want audit failures to block the main action,
        # but we do want to know about it.
