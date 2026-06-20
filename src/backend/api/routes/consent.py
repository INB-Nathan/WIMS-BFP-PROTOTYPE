"""Public consent-recording endpoint — POST /api/auth/consent.

No Keycloak JWT required. Any caller (civilian, anonymous) may record a
consent event. Rate-limited by Redis sliding-window throttle (5/IP/hr, fail-closed).
Audit trail written via log_system_audit (user_id=None for anonymous callers).
"""

from __future__ import annotations

import logging
import os
import threading

import redis
from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.privacy import ConsentRequest, ConsentRecord
from utils.audit import log_system_audit
from utils.public_abuse import rate_limit_public

router = APIRouter(prefix="/api/auth", tags=["consent"])
logger = logging.getLogger("wims.consent")

# Module-level Redis client singleton with connection pooling.
_redis_client: redis.Redis | None = None
_redis_lock = threading.Lock()


def _get_redis() -> redis.Redis:
    """Return the module-level Redis client singleton."""
    global _redis_client
    if _redis_client is None:
        with _redis_lock:
            if _redis_client is None:
                _redis_client = redis.from_url(
                    os.environ.get("REDIS_URL", "redis://redis:6379/0"),
                    decode_responses=True,
                    socket_connect_timeout=0.5,
                    socket_timeout=0.5,
                    health_check_interval=30,
                    max_connections=10,
                )
    return _redis_client


@router.post("/consent", response_model=ConsentRecord, status_code=201)
def record_consent(
    body: ConsentRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Record a data-subject consent grant or withdrawal.

    Publicly accessible — no authentication required. Any subject may record
    their own consent. SYSTEM_ADMIN can query these records via the export
    endpoint.

    Rate limited: 5 requests per IP per hour (fail-closed per D6).
    """
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "unknown")
    )

    # Rate limit: 5 requests per IP per hour (fail-closed)
    rate_limit_public(_get_redis(), client_ip, "public_consent", limit=5, window=3600)

    user_agent = request.headers.get("user-agent")

    row = db.execute(
        text(
            "INSERT INTO wims.consent_log "
            "(subject_type, subject_id, consent_type, action, request_ip, user_agent) "
            "VALUES (:st, :sid, :ct, :action, CAST(:ip AS INET), :ua) "
            "RETURNING consent_id, subject_type, subject_id, consent_type, action, recorded_at"
        ),
        {
            "st": body.subject_type.value,
            "sid": body.subject_id,
            "ct": body.consent_type,
            "action": body.action.value,
            "ip": client_ip,
            "ua": user_agent,
        },
    ).fetchone()

    audit_action = "CONSENT_GRANT" if body.action.value == "GRANTED" else "CONSENT_WITHDRAW"
    log_system_audit(db, None, audit_action, "wims.consent_log", row[0], request)
    db.commit()

    return ConsentRecord(
        consent_id=row[0],
        subject_type=row[1],
        subject_id=row[2],
        consent_type=row[3],
        action=row[4],
        recorded_at=row[5],
    )
