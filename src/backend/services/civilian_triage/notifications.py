"""Notification enqueue seam for civilian triage workflow.

Failures are intentionally logged and swallowed so notification enqueue problems do
not roll back already committed triage state.
"""

from __future__ import annotations

import logging

from tasks.notifications import send_status_notification

logger = logging.getLogger("wims.civilian_triage.notifications")


def enqueue_status_notification(report_id: int, status: str) -> None:
    try:
        send_status_notification.delay(report_id, status)
    except Exception:
        logger.exception(
            "Failed to enqueue status notification for report_id=%s status=%s",
            report_id,
            status,
        )


def notify_reports(report_ids: list[int], status: str) -> None:
    for report_id in report_ids:
        enqueue_status_notification(report_id, status)
