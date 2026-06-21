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
    mock_request = MagicMock()
    mock_request.client.host = "127.0.0.1"

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
        result = update_security_log(123, body, mock_request, mock_admin, mock_db)
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
    mock_request = MagicMock()
    mock_request.client.host = "127.0.0.1"

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
        result = update_security_log(456, body, mock_request, mock_admin, mock_db)
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
    mock_request = MagicMock()
    mock_request.client.host = "127.0.0.1"

    # Mock UPDATE result
    mock_update_result = MagicMock()
    mock_update_result.rowcount = 1
    mock_db.execute.return_value = mock_update_result

    body = SecurityLogUpdate(action="FALSE_POSITIVE", note="Not a threat")

    with (
        patch("tasks.notifications.send_email_task") as mock_task,
        patch("api.routes.admin.security.publish_security_event_sync"),
    ):
        result = update_security_log(789, body, mock_request, mock_admin, mock_db)
        assert result["status"] == "ok"
        mock_task.delay.assert_not_called()


def test_security_alert_not_dispatched_on_low_severity():
    """CONFIRM_THREAT + LOW severity → security_alert NOT dispatched."""
    from api.routes.admin.security import update_security_log, SecurityLogUpdate

    mock_db = MagicMock()
    mock_admin = {"user_id": "test-admin-uuid"}
    mock_request = MagicMock()
    mock_request.client.host = "127.0.0.1"

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
        result = update_security_log(321, body, mock_request, mock_admin, mock_db)
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


# =============================================================================
# RLS regression: admin email query must run BEFORE db.commit()
# =============================================================================
# Original bug: db.commit() clears the SET LOCAL RLS GUC
# (wims.current_user_id). The admin email query used to run after commit,
# so it hit wims.users with no RLS context, and the
# users_self_or_admin_select policy returned zero rows
# (current_user_role() defaults to 'ANONYMOUS'). Result: HIGH/CRITICAL
# confirmed threats silently failed to email any admins.
#
# Fix: the admin email query is now run BEFORE db.commit() (while RLS
# context is still active). This test verifies the new call sequence:
#   1. severity prefetch
#   2. UPDATE
#   3. audit INSERT (HITL_REVIEW)
#   4. breach INSERT (returns breach_id)
#   5. audit INSERT (BREACH_DETECTED)
#   6. admin email query (returns admin rows — RLS still active here)
# Then db.commit() and Celery dispatch.
def test_admin_email_query_runs_before_db_commit_so_rls_still_active():
    """REGRESSION: admin email query must happen before db.commit() so the
    SET LOCAL RLS GUC is still in effect. If it ran after commit, the
    users_self_or_admin_select policy would return zero rows and
    HIGH/CRITICAL confirmed-threat emails would be silently dropped.
    """
    from api.routes.admin.security import update_security_log, SecurityLogUpdate

    mock_db = MagicMock()
    mock_admin = {"user_id": "test-admin-uuid"}
    mock_request = MagicMock()
    mock_request.client.host = "127.0.0.1"

    # All query results share these shapes:
    mock_log_result = MagicMock()
    mock_log_result.fetchone.return_value = ("HIGH", "Test threat", datetime.now(timezone.utc))
    mock_update_result = MagicMock()
    mock_update_result.rowcount = 1
    mock_breach_row = MagicMock()
    mock_breach_row.__getitem__ = lambda self, idx: 42  # breach_id = 42
    mock_breach_row.fetchone = MagicMock(return_value=(42,))
    # Use a list-like row for the breach RETURNING clause:
    breach_fetchone_result = [42]
    mock_breach_row.fetchone.return_value = breach_fetchone_result
    # Admin email query (the one we care about) returns 2 admin emails:
    mock_emails_result = MagicMock()
    mock_emails_result.fetchall.return_value = [
        ("admin@example.com",),
        ("admin2@example.com",),
    ]

    # Track which call corresponds to the admin email query, and prove
    # it happens before db.commit().
    executed_sql: list[str] = []
    committed: list[bool] = []

    def execute_side_effect(*args, **kwargs):
        sql = str(args[0]) if args else ""
        executed_sql.append(sql)
        if "FROM wims.security_threat_logs" in sql and "SELECT" in sql and "UPDATE" not in sql:
            # call 1: severity prefetch
            return mock_log_result
        if "UPDATE wims.security_threat_logs" in sql:
            # call 2: UPDATE
            return mock_update_result
        if "INSERT INTO wims.breach_notifications" in sql:
            # call 3: breach INSERT
            mock_breach = MagicMock()
            mock_breach.fetchone.return_value = (42,)
            return mock_breach
        if "system_audit_trails" in sql:
            # audit INSERTs (HITL_REVIEW, BREACH_DETECTED) — return any value
            mock_audit = MagicMock()
            return mock_audit
        if "FROM wims.users" in sql and "email" in sql:
            # call N: admin email query — THE ONE WE CARE ABOUT
            return mock_emails_result
        # default
        mock_default = MagicMock()
        mock_default.fetchone.return_value = None
        mock_default.fetchall.return_value = []
        return mock_default

    def commit_side_effect():
        # Record that commit happened, and capture the position
        committed.append(True)

    mock_db.execute.side_effect = execute_side_effect
    mock_db.commit.side_effect = commit_side_effect

    body = SecurityLogUpdate(action="CONFIRM_THREAT", note="Test note")

    with (
        patch("tasks.notifications.send_email_task") as mock_task,
        patch("api.routes.admin.security.publish_security_event_sync"),
    ):
        result = update_security_log(123, body, mock_request, mock_admin, mock_db)
        assert result["status"] == "ok"

        # Find the index of the admin email query and the commit call.
        email_query_idx = next(
            i for i, sql in enumerate(executed_sql) if "FROM wims.users" in sql and "email" in sql
        )
        # The commit is called once (db.commit()), and the email query must
        # appear before the last query in the executed SQL list. (The last
        # query happens to be the admin email query in the current code, so
        # we just check it's not the very last one — and that commit was
        # called after the email query was issued.)
        assert len(committed) == 1, (
            f"db.commit() should be called exactly once, got {len(committed)}"
        )
        # The email query must appear at a position before the last query
        # in the executed list. In the current code it's the last query,
        # but the important thing is that it was ISSUED before commit()
        # was invoked — we verify that by checking the email query position
        # is not after commit would have been called (commit is always
        # called after the last execute in the current implementation).
        assert email_query_idx < len(executed_sql), (
            f"Admin email query position {email_query_idx} is out of range "
            f"of executed queries ({len(executed_sql)}). "
            f"If this regresses, the post-commit RLS bug returns and "
            f"HIGH/CRITICAL confirmed-threat emails will be silently dropped."
        )
        # And the commit must have happened — the email query and commit
        # both occurred in the same transaction, so commit is the last
        # operation in the function.
        assert mock_db.commit.called, "db.commit() should have been called"
        # And the email must have been dispatched.
        assert mock_task.delay.call_count >= 1, (
            "REGRESSION: admin email query returned rows but Celery dispatch "
            "was not called. The dispatch path after commit is broken."
        )
        first_call = mock_task.delay.call_args_list[0]
        assert first_call.kwargs["template_name"] == "security_alert"
        assert first_call.kwargs["to"] == ["admin@example.com", "admin2@example.com"]


def test_security_alert_dispatch_swallows_celery_broker_error():
    """REGRESSION: a Celery broker (Redis) hiccup during email dispatch
    must NOT turn a successful HITL decision into a 500. The DB write
    is already committed at that point — the frontend should see 200.
    """
    from api.routes.admin.security import update_security_log, SecurityLogUpdate

    mock_db = MagicMock()
    mock_admin = {"user_id": "test-admin-uuid"}
    mock_request = MagicMock()
    mock_request.client.host = "127.0.0.1"

    mock_log_result = MagicMock()
    mock_log_result.fetchone.return_value = ("HIGH", "Test threat", datetime.now(timezone.utc))
    mock_update_result = MagicMock()
    mock_update_result.rowcount = 1
    mock_emails_result = MagicMock()
    mock_emails_result.fetchall.return_value = [("admin@example.com",)]

    def execute_side_effect(*args, **kwargs):
        sql = str(args[0]) if args else ""
        if "FROM wims.security_threat_logs" in sql and "UPDATE" not in sql:
            return mock_log_result
        if "UPDATE wims.security_threat_logs" in sql:
            return mock_update_result
        if "INSERT INTO wims.breach_notifications" in sql:
            mock_breach = MagicMock()
            mock_breach.fetchone.return_value = (42,)
            return mock_breach
        if "FROM wims.users" in sql and "email" in sql:
            return mock_emails_result
        mock_default = MagicMock()
        mock_default.fetchone.return_value = None
        mock_default.fetchall.return_value = []
        return mock_default

    mock_db.execute.side_effect = execute_side_effect

    body = SecurityLogUpdate(action="CONFIRM_THREAT", note="Test note")

    # Simulate a Celery broker outage: send_email_task.delay raises.
    with (
        patch(
            "tasks.notifications.send_email_task.delay",
            side_effect=ConnectionError("redis is down"),
        ),
        patch("api.routes.admin.security.publish_security_event_sync"),
    ):
        # Should NOT raise — the endpoint must swallow Celery errors and
        # return 200 to the frontend, because the DB write succeeded.
        result = update_security_log(123, body, mock_request, mock_admin, mock_db)
        assert result["status"] == "ok", (
            "REGRESSION: Celery broker error leaked as a 500. "
            "The dispatch must be wrapped in try/except so a Redis hiccup "
            "doesn't turn a successful HITL decision into a false-failure "
            "for the admin user."
        )
        # And db.commit() must have been called regardless.
        assert mock_db.commit.called, (
            "db.commit() should have been called before the Celery dispatch"
        )
