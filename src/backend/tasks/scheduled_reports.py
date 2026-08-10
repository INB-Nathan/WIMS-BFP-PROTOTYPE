"""Celery task — execute due scheduled reports and deliver to recipients."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from croniter import croniter
from sqlalchemy import text

from celery_config import celery_app
from database import get_session, set_rls_context, SYSTEM_TASK_USER_ID
from tasks.exports import export_scheduled_report
from tasks.notifications import send_email_task

logger = logging.getLogger(__name__)

SCHEDULE_CHECK_INTERVAL = int(os.environ.get("SCHEDULE_CHECK_INTERVAL", 300))


def _format_for(fmt: str) -> str:
    """Normalize format field to lowercase."""
    return (fmt or "").lower().strip()


SCHEDULED_EXPORT_COLUMNS = [
    "incident_id",
    "notification_dt",
    "region_name",
    "province_name",
    "municipality_name",
    "general_category",
    "alarm_level",
    "estimated_damage_php",
    "total_response_time_minutes",
]


@celery_app.task(
    bind=True,
    name="tasks.scheduled_reports.execute_due_reports",
    max_retries=1,
    default_retry_delay=60,
)
def execute_due_reports(self) -> dict:
    """
    Find all enabled scheduled reports whose next cron trigger has elapsed
    since last_run_at, generate exports, notify recipients via email,
    and update last_run_at.

    Runs periodically via Celery beat. Each report runs only once per beat
    cycle (at most once every SCHEDULE_CHECK_INTERVAL seconds) to avoid
    duplicate deliveries.
    """
    now = datetime.now(timezone.utc)
    db = get_session()
    try:
        # RLS context: SYSTEM_TASK_USER_ID sees all rows
        set_rls_context(db, SYSTEM_TASK_USER_ID)

        rows = db.execute(
            text(
                "SELECT id, name, cron_expr, format, filters, recipients "
                "FROM wims.scheduled_reports "
                "WHERE enabled = TRUE "
                "ORDER BY id ASC"
            )
        ).fetchall()

        if not rows:
            logger.info("No enabled scheduled reports found.")
            return {"status": "ok", "due": 0, "executed": 0, "skipped": 0}

        due_reports: list[dict] = []
        for row in rows:
            report_id, name, cron_expr, fmt, filters_json, recipients_json = row
            # Get last_run_at for this specific report
            last_run_raw = db.execute(
                text("SELECT last_run_at FROM wims.scheduled_reports WHERE id = :rid"),
                {"rid": report_id},
            ).scalar()

            # Determine reference time for cron iteration
            if last_run_raw is not None:
                # Ensure timezone-aware
                if last_run_raw.tzinfo is None:
                    last_run_at = last_run_raw.replace(tzinfo=timezone.utc)
                else:
                    last_run_at = last_run_raw
            else:
                last_run_at = None

            # Check if report is due
            try:
                cron = croniter(cron_expr, now)
                # Get the most recent trigger time before now
                prev_trigger = cron.get_prev(datetime)
                if prev_trigger.tzinfo is None:
                    prev_trigger = prev_trigger.replace(tzinfo=timezone.utc)

                if last_run_at is None:
                    # Never run — it's due
                    due = True
                elif prev_trigger > last_run_at:
                    # The most recent scheduled time is after the last run
                    due = True
                else:
                    due = False
            except (ValueError, KeyError) as exc:
                logger.warning(
                    "Invalid cron expression for report %d (name=%s): %s — %s",
                    report_id,
                    name,
                    cron_expr,
                    exc,
                )
                due = False

            if due:
                filters = filters_json if isinstance(filters_json, dict) else {}
                recipients = recipients_json if isinstance(recipients_json, list) else []
                due_reports.append(
                    {
                        "id": report_id,
                        "name": name,
                        "format": _format_for(fmt),
                        "filters": filters,
                        "recipients": recipients,
                    }
                )
    finally:
        db.close()

    if not due_reports:
        logger.info("No due scheduled reports (checked %d enabled).", len(rows) if rows else 0)
        return {"status": "ok", "due": 0, "executed": 0, "skipped": len(rows) if rows else 0}

    executed = 0
    skipped = 0

    for report in due_reports:
        rid = report["id"]
        rname = report["name"]
        rfmt = report["format"]
        rfilters = report["filters"]
        rrecipients = report["recipients"]

        logger.info(
            "Executing scheduled report %d (%s, format=%s) for %d recipients",
            rid,
            rname,
            rfmt,
            len(rrecipients),
        )

        # Generate export through the canonical export and audit seam
        export_path = None
        try:
            export_path = _generate_report_export(
                rid, rname, rfmt, rfilters, task_id=getattr(self.request, "id", None)
            )
        except Exception as exc:
            logger.error(
                "Failed to generate export for report %d (%s): %s",
                rid,
                rname,
                exc,
            )
            skipped += 1
            continue

        if export_path is None:
            # _generate_report_export already logged the failure: do not
            # count the run as executed or advance last_run_at.
            skipped += 1
            continue

        # Deliver to recipients
        if rrecipients and export_path:
            try:
                frontend_url = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
                # For email delivery: recipients can be email addresses
                valid_emails = [e for e in rrecipients if isinstance(e, str) and "@" in e]
                if valid_emails:
                    send_email_task.delay(
                        to=valid_emails,
                        template_name="scheduled_report",
                        context={
                            "report_name": rname,
                            "report_format": rfmt.upper(),
                            "generated_at": datetime.now(timezone.utc).strftime(
                                "%Y-%m-%d %H:%M:%S UTC"
                            ),
                            "filters_summary": json.dumps(rfilters) if rfilters else "None",
                            "report_link": f"{frontend_url}/admin/analytics",
                            "download_path": export_path,
                        },
                    )
                    logger.info(
                        "Dispatched scheduled report %d (%s) to %d recipients",
                        rid,
                        rname,
                        len(valid_emails),
                    )
                else:
                    logger.warning(
                        "Scheduled report %d (%s) has no valid email recipients: %s",
                        rid,
                        rname,
                        rrecipients,
                    )
            except Exception as exc:
                logger.error(
                    "Failed to dispatch email for report %d (%s): %s",
                    rid,
                    rname,
                    exc,
                )

        # Update last_run_at
        db2 = get_session()
        try:
            set_rls_context(db2, SYSTEM_TASK_USER_ID)
            db2.execute(
                text("UPDATE wims.scheduled_reports SET last_run_at = :now WHERE id = :rid"),
                {"now": now, "rid": rid},
            )
            db2.commit()
        except Exception as exc:
            logger.error("Failed to update last_run_at for report %d: %s", rid, exc)
            db2.rollback()
        finally:
            db2.close()

        executed += 1

    return {
        "status": "ok",
        "due": len(due_reports),
        "executed": executed,
        "skipped": skipped,
    }


def _generate_report_export(
    report_id: int,
    name: str,
    fmt: str,
    filters: dict,
    task_id: str | None = None,
) -> str | None:
    """Generate an analytics export file for a scheduled report.

    Routes through tasks.exports.export_scheduled_report — the same
    canonical export seam used by the dashboard export queue — so every
    successful run records exactly one analytics_export_log row and one
    BULK_EXPORT system-audit event under the system-task identity
    (SYSTEM_TASK_USER_ID, SYSTEM_ADMIN role, RLS-permitted insert).
    Returns the file path on success, or None on failure.
    """
    try:
        return export_scheduled_report(
            task_id=task_id,
            user_id=str(SYSTEM_TASK_USER_ID),
            report_id=report_id,
            export_format=fmt,
            filters=filters,
            columns=SCHEDULED_EXPORT_COLUMNS,
        )
    except Exception as exc:
        logger.error("Export generation failed for report %d: %s", report_id, exc)
        return None
