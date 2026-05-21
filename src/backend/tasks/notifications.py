"""Celery tasks — FCM push notifications for citizen report status changes."""

from __future__ import annotations

import json
import logging
import os

from sqlalchemy import text

from celery_config import celery_app
from database import get_session

logger = logging.getLogger(__name__)

_firebase_initialized = False


def _get_messaging():
    """Lazily initialize Firebase Admin SDK and return the messaging module."""
    global _firebase_initialized
    import firebase_admin
    from firebase_admin import credentials, messaging

    if not _firebase_initialized:
        creds_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        creds_path = os.environ.get("FIREBASE_CREDENTIALS_PATH")

        if creds_json:
            cred = credentials.Certificate(json.loads(creds_json))
        elif creds_path:
            cred = credentials.Certificate(creds_path)
        else:
            raise RuntimeError(
                "Firebase credentials not configured. "
                "Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CREDENTIALS_PATH."
            )

        firebase_admin.initialize_app(cred)
        _firebase_initialized = True

    return messaging


_STATUS_LABELS: dict[str, tuple[str, str]] = {
    "VERIFIED": (
        "Report Verified",
        "Your emergency report has been verified. Responders have been dispatched.",
    ),
    "FALSE_ALARM": (
        "Report Closed",
        "Your report has been marked as a false alarm.",
    ),
    "DUPLICATE": (
        "Report Merged",
        "Your report has been merged with an existing incident.",
    ),
}


@celery_app.task(
    bind=True,
    name="tasks.notifications.send_status_notification",
    max_retries=3,
    default_retry_delay=30,
)
def send_status_notification(self, report_id: int, new_status: str) -> dict:
    """
    Send FCM push notifications to all registered tokens for a citizen report.
    Triggered after promote_report() / bulk_promote_reports() commits.
    Stale (UnregisteredError) tokens are deleted to keep the table clean.
    """
    db = get_session()
    try:
        rows = db.execute(
            text(
                "SELECT token_id, fcm_token "
                "FROM wims.report_notification_tokens "
                "WHERE report_id = :rid"
            ),
            {"rid": report_id},
        ).fetchall()
    finally:
        db.close()

    if not rows:
        logger.info("No notification tokens for report_id=%s", report_id)
        return {"sent": 0, "failed": 0, "report_id": report_id}

    try:
        messaging = _get_messaging()
    except Exception as exc:
        logger.error("Firebase not configured: %s", exc)
        raise self.retry(exc=exc)

    title, body = _STATUS_LABELS.get(
        new_status,
        ("Report Update", f"Your emergency report #{report_id} status: {new_status}."),
    )

    sent = 0
    failed = 0
    stale_token_ids: list[int] = []

    for token_id, fcm_token in rows:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={"report_id": str(report_id), "status": new_status},
            token=fcm_token,
        )
        try:
            messaging.send(message)
            sent += 1
        except messaging.UnregisteredError:
            stale_token_ids.append(token_id)
            failed += 1
        except Exception as exc:
            logger.warning(
                "FCM send failed for token_id=%s report_id=%s: %s",
                token_id,
                report_id,
                exc,
            )
            failed += 1

    if stale_token_ids:
        db2 = get_session()
        try:
            db2.execute(
                text("DELETE FROM wims.report_notification_tokens WHERE token_id = ANY(:ids)"),
                {"ids": stale_token_ids},
            )
            db2.commit()
            logger.info(
                "Cleaned %d stale token(s) for report_id=%s",
                len(stale_token_ids),
                report_id,
            )
        finally:
            db2.close()

    logger.info(
        "Notifications report_id=%s status=%s: sent=%d failed=%d",
        report_id,
        new_status,
        sent,
        failed,
    )
    return {"sent": sent, "failed": failed, "report_id": report_id}
