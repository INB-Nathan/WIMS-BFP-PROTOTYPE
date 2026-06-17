"""Public consent-recording endpoint — POST /api/auth/consent.

No Keycloak JWT required. Any caller (civilian, anonymous) may record a
consent event. Rate-limited by the global sliding-window middleware in main.py.
Audit trail written via log_system_audit (user_id=None for anonymous callers).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.privacy import ConsentRequest, ConsentRecord
from utils.audit import log_system_audit

router = APIRouter(prefix="/api/auth", tags=["consent"])
logger = logging.getLogger("wims.consent")


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
    """
    client_ip = None
    if request.client:
        client_ip = request.client.host
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
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
