"""Celery tasks — FCM push notifications for citizen report status changes."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone

import aiosmtplib
from sqlalchemy import text

from celery_config import celery_app
from database import get_session, SYSTEM_TASK_USER_ID
from services.email.sender import send_email as _send_email

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
    Triggered after triage terminal actions commit.
    Stale (UnregisteredError) tokens are deleted to keep the table clean.

    citizen_reports is anonymous by design — no reporter email is collected.
    Email notification is therefore not applicable here; see email_opt_in on
    wims.users for registered-user notification preferences (#72).
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


# =============================================================================
# Email tasks (M13b) — deferred triggers: Keycloak lockout (#138), weekly
# analytics report, security alert (#176). Event wiring is out of scope here.
# =============================================================================


@celery_app.task(
    bind=True,
    name="tasks.notifications.send_email",
    autoretry_for=(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
)
def send_email_task(
    self,
    to: str | list[str],
    template_name: str,
    context: dict,
) -> dict:
    """Render and send a templated email asynchronously.

    Args:
        to: Recipient email address (or list of addresses).
        template_name: Name of a Jinja2 HTML template in services/email/templates/
                      (without the .html.j2 extension).
        context: Jinja2 template variable dictionary.

    Raises:
        Retries with exponential backoff on transient SMTP/network exceptions
        (max 5 retries, up to 10 minutes between attempts).
        Permanent failures (template/context/type errors) fail fast.
        Does NOT query RLS tables.
    """
    try:
        _send_email(to, template_name, context)
        logger.info("Email sent via send_email_task: to=%s template=%s", to, template_name)
        return {"ok": True, "to": to, "template": template_name}
    except Exception as exc:
        remaining = self.max_retries - self.request.retries
        logger.warning(
            "send_email_task failed for to=%s template=%s: %s — retry %d/%d",
            to,
            template_name,
            exc,
            remaining,
            self.max_retries,
        )
        raise


@celery_app.task(name="tasks.notifications.send_weekly_report_email")
def send_weekly_report_email() -> dict:
    """
    Send weekly analytics summary email to all active SYSTEM_ADMIN users.
    Runs every Monday at 07:00 UTC via Celery beat.
    Queries analytics_incident_facts for 7-day totals and top region.
    """
    db = get_session(SYSTEM_TASK_USER_ID)
    try:
        # Compute 7-day range
        end_date = datetime.now(timezone.utc).date()
        start_date = end_date - timedelta(days=7)
        week_range = f"{start_date.isoformat()} – {end_date.isoformat()}"

        # Query 7-day incident count from analytics_incident_facts
        total_incidents = (
            db.execute(
                text(
                    """
                    SELECT COUNT(*) FROM wims.analytics_incident_facts
                    WHERE notification_date >= :start_date AND notification_date <= :end_date
                    """
                ),
                {"start_date": start_date, "end_date": end_date},
            ).scalar()
            or 0
        )

        # Query top region by incident count
        top_region_row = db.execute(
            text(
                """
                SELECT r.region_code, COUNT(*) AS cnt
                FROM wims.analytics_incident_facts a
                JOIN wims.ref_regions r ON r.region_id = a.region_id
                WHERE a.notification_date >= :start_date AND a.notification_date <= :end_date
                GROUP BY r.region_code
                ORDER BY cnt DESC
                LIMIT 1
                """
            ),
            {"start_date": start_date, "end_date": end_date},
        ).fetchone()
        top_region = top_region_row[0] if top_region_row else "N/A"

        # Fetch SYSTEM_ADMIN emails
        admin_emails = [
            row[0]
            for row in db.execute(
                text(
                    "SELECT email FROM wims.users"
                    " WHERE role = 'SYSTEM_ADMIN' AND is_active = TRUE AND email IS NOT NULL"
                )
            ).fetchall()
        ]

        if not admin_emails:
            logger.info("Weekly report: no SYSTEM_ADMIN emails configured, skipping")
            return {"sent": 0, "reason": "no_recipients"}

        frontend_url = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
        report_link = f"{frontend_url}/admin/analytics"

        send_email_task.delay(
            to=admin_emails,
            template_name="weekly_report",
            context={
                "week_range": week_range,
                "total_incidents": total_incidents,
                "top_region": top_region,
                "report_link": report_link,
            },
        )
        logger.info(
            "Weekly report dispatched to %d admin(s): %d incidents, top region: %s",
            len(admin_emails),
            total_incidents,
            top_region,
        )
        return {
            "sent": len(admin_emails),
            "total_incidents": total_incidents,
            "top_region": top_region,
        }

    except Exception:
        db.rollback()
        logger.exception("Weekly report task failed")
        raise
    finally:
        db.close()
