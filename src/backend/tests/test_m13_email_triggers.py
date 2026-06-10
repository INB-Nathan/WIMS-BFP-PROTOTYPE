"""M13b: Email trigger tests — security_alert + weekly_report + MailHog integration."""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest


# =============================================================================
# Unit tests: mock send_email_task.delay at tasks.notifications level
# =============================================================================


def test_security_alert_dispatched_on_confirm_threat_high():
    """CONFIRM_THREAT + HIGH severity → security_alert email dispatched."""
    from api.routes.admin.security import update_security_log, SecurityLogUpdate

    mock_db = MagicMock()
    mock_admin = {"user_id": "test-admin-uuid"}

    # Setup mock chain: first call returns log metadata (HIGH severity),
    # second call returns UPDATE result, third call returns admin emails
    mock_log_result = MagicMock()
    mock_log_result.fetchone.return_value = ("HIGH", "Test threat", datetime.now(timezone.utc))

    mock_update_result = MagicMock()
    mock_update_result.rowcount = 1

    mock_emails_result = MagicMock()
    mock_emails_result.fetchall.return_value = [("admin@example.com",), ("admin2@example.com",)]

    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return mock_log_result
        elif call_count == 2:
            return mock_update_result
        else:
            return mock_emails_result

    mock_db.execute.side_effect = side_effect

    body = SecurityLogUpdate(action="CONFIRM_THREAT", note="Test note")

    with (
        patch("tasks.notifications.send_email_task") as mock_task,
        patch("api.routes.admin.security.publish_security_event_sync"),
    ):
        result = update_security_log(123, body, mock_admin, mock_db)
        assert result["status"] == "ok"
        # M10d: HIGH/CRITICAL CONFIRM_THREAT now dispatches two emails:
        # security_alert (M13b) + breach_alert (M10d)
        assert mock_task.delay.call_count == 2
        first_call = mock_task.delay.call_args_list[0].kwargs
        assert first_call["template_name"] == "security_alert"
        assert first_call["context"]["severity"] == "HIGH"


def test_security_alert_dispatched_on_confirm_threat_critical():
    """CONFIRM_THREAT + CRITICAL severity → security_alert email dispatched."""
    from api.routes.admin.security import update_security_log, SecurityLogUpdate

    mock_db = MagicMock()
    mock_admin = {"user_id": "test-admin-uuid"}

    # Mock SELECT (returns CRITICAL severity)
    mock_log_result = MagicMock()
    mock_log_result.fetchone.return_value = (
        "CRITICAL",
        "Critical exploit",
        datetime.now(timezone.utc),
    )

    # Setup mock chain: first call returns log metadata, subsequent calls return update result + emails
    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return mock_log_result
        elif call_count == 2:
            mock_update = MagicMock()
            mock_update.rowcount = 1
            return mock_update
        else:
            mock_emails = MagicMock()
            mock_emails.fetchall.return_value = [("admin@example.com",)]
            return mock_emails

    mock_db.execute.side_effect = side_effect

    body = SecurityLogUpdate(action="CONFIRM_THREAT")

    with (
        patch("tasks.notifications.send_email_task") as mock_task,
        patch("api.routes.admin.security.publish_security_event_sync"),
    ):
        result = update_security_log(456, body, mock_admin, mock_db)
        assert result["status"] == "ok"
        # M10d: CRITICAL CONFIRM_THREAT dispatches security_alert + breach_alert
        assert mock_task.delay.call_count == 2
        first_call = mock_task.delay.call_args_list[0].kwargs
        assert first_call["template_name"] == "security_alert"
        assert first_call["context"]["severity"] == "CRITICAL"


def test_security_alert_not_dispatched_on_false_positive():
    """FALSE_POSITIVE → security_alert NOT dispatched."""
    from api.routes.admin.security import update_security_log, SecurityLogUpdate

    mock_db = MagicMock()
    mock_admin = {"user_id": "test-admin-uuid"}

    # Mock UPDATE result
    mock_update_result = MagicMock()
    mock_update_result.rowcount = 1
    mock_db.execute.return_value = mock_update_result

    body = SecurityLogUpdate(action="FALSE_POSITIVE", note="Not a threat")

    with (
        patch("tasks.notifications.send_email_task") as mock_task,
        patch("api.routes.admin.security.publish_security_event_sync"),
    ):
        result = update_security_log(789, body, mock_admin, mock_db)
        assert result["status"] == "ok"
        mock_task.delay.assert_not_called()


def test_security_alert_not_dispatched_on_low_severity():
    """CONFIRM_THREAT + LOW severity → security_alert NOT dispatched."""
    from api.routes.admin.security import update_security_log, SecurityLogUpdate

    mock_db = MagicMock()
    mock_admin = {"user_id": "test-admin-uuid"}

    # Mock SELECT (returns LOW severity)
    mock_log_result = MagicMock()
    mock_log_result.fetchone.return_value = (
        "LOW",
        "Low severity event",
        datetime.now(timezone.utc),
    )

    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return mock_log_result
        else:
            mock_update = MagicMock()
            mock_update.rowcount = 1
            return mock_update

    mock_db.execute.side_effect = side_effect

    body = SecurityLogUpdate(action="CONFIRM_THREAT")

    with (
        patch("tasks.notifications.send_email_task") as mock_task,
        patch("api.routes.admin.security.publish_security_event_sync"),
    ):
        result = update_security_log(321, body, mock_admin, mock_db)
        assert result["status"] == "ok"
        mock_task.delay.assert_not_called()


def test_weekly_task_builds_correct_context():
    """Weekly task queries analytics and dispatches send_email_task with correct context."""
    from tasks.notifications import send_weekly_report_email

    mock_db = MagicMock()

    # Mock incident count query
    mock_count_result = MagicMock()
    mock_count_result.scalar.return_value = 15

    # Mock top region query
    mock_region_result = MagicMock()
    mock_region_result.fetchone.return_value = ("NCR", 15)

    # Mock admin emails query
    mock_emails_result = MagicMock()
    mock_emails_result.fetchall.return_value = [("admin1@example.com",), ("admin2@example.com",)]

    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return mock_count_result
        elif call_count == 2:
            return mock_region_result
        else:
            return mock_emails_result

    mock_db.execute.side_effect = side_effect

    with (
        patch("tasks.notifications.get_session", return_value=mock_db),
        patch("tasks.notifications.send_email_task") as mock_task,
    ):
        result = send_weekly_report_email()
        assert result["sent"] == 2
        assert result["total_incidents"] == 15
        assert result["top_region"] == "NCR"
        mock_task.delay.assert_called_once()
        call_kwargs = mock_task.delay.call_args.kwargs
        assert call_kwargs["template_name"] == "weekly_report"
        context = call_kwargs["context"]
        assert "week_range" in context
        assert "total_incidents" in context
        assert "top_region" in context
        assert "report_link" in context
        assert context["total_incidents"] == 15
        assert context["top_region"] == "NCR"


def test_weekly_task_no_dispatch_if_no_admin_emails():
    """Zero SYSTEM_ADMIN emails → send_email_task NOT called."""
    from tasks.notifications import send_weekly_report_email

    mock_db = MagicMock()

    # Mock incident count query
    mock_count_result = MagicMock()
    mock_count_result.scalar.return_value = 5

    # Mock top region query
    mock_region_result = MagicMock()
    mock_region_result.fetchone.return_value = ("CAR", 5)

    # Mock admin emails query (empty)
    mock_emails_result = MagicMock()
    mock_emails_result.fetchall.return_value = []

    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return mock_count_result
        elif call_count == 2:
            return mock_region_result
        else:
            return mock_emails_result

    mock_db.execute.side_effect = side_effect

    with (
        patch("tasks.notifications.get_session", return_value=mock_db),
        patch("tasks.notifications.send_email_task") as mock_task,
    ):
        result = send_weekly_report_email()
        assert result["sent"] == 0
        assert result["reason"] == "no_recipients"
        mock_task.delay.assert_not_called()


# =============================================================================
# Integration test: MailHog delivery
# =============================================================================


@pytest.mark.integration
def test_mailhog_email_delivery():
    """Direct send_email() call → MailHog receives message."""
    import requests
    from services.email.sender import send_email

    # Check MailHog reachability
    mailhog_url = "http://mailhog:8025"
    try:
        requests.get(f"{mailhog_url}/api/v2/messages", timeout=2)
    except (requests.ConnectionError, requests.Timeout):
        pytest.skip("MailHog not reachable — skipping integration test")

    # Send test email
    send_email(
        "test@example.com",
        "security_alert",
        {
            "severity": "HIGH",
            "summary": "Test alert for MailHog",
            "detected_at": "2024-01-01T00:00:00Z",
            "dashboard_link": "http://localhost:3000",
        },
    )

    # Verify delivery via MailHog API
    resp = requests.get(f"{mailhog_url}/api/v2/messages", timeout=5)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0, "No messages in MailHog"
    # Verify at least one message contains the test recipient
    found = any("test@example.com" in str(msg) for msg in data["items"])
    assert found, "Test email not found in MailHog inbox"
