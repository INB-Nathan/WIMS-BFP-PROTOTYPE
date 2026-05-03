import logging
import uuid
from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("wims.audit")


def log_system_audit(
    db: Session,
    user_id: uuid.UUID | str | None,
    action_type: str,
    table_affected: str,
    record_id: int | None,
    request: Request | None = None,
):
    """
    Log a system-level audit event.
    """
    ip_address = None
    user_agent = None

    if request:
        # FastAPI request object might have client info
        if request.client:
            ip_address = request.client.host
        user_agent = request.headers.get("user-agent")

    try:
        db.execute(
            text("""
                INSERT INTO wims.system_audit_trails (
                    user_id, action_type, table_affected, record_id,
                    ip_address, user_agent, timestamp
                ) VALUES (
                    :uid, :action, :table, :rec,
                    :ip, :ua, now()
                )
            """),
            {
                "uid": str(user_id) if user_id else None,
                "action": action_type,
                "table": table_affected,
                "rec": record_id,
                "ip": ip_address,
                "ua": user_agent,
            },
        )
        # Note: Caller is responsible for committing the transaction
    except Exception as e:
        logger.error(f"Failed to log system audit: {e}")
        # We don't want audit failures to block the main action,
        # but we do want to know about it.
