"""Tests for scheduled reports task — Issue #88."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from tasks.scheduled_reports import execute_due_reports


class TestExecuteDueReports:
    """Test the Celery task that finds and executes due scheduled reports."""

    def test_no_enabled_reports_returns_ok(self) -> None:
        """When no enabled reports exist, the task returns ok with zero counts."""
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                result = execute_due_reports()
                assert result["status"] == "ok"
                assert result["due"] == 0
                assert result["executed"] == 0
                assert result["skipped"] == 0

    def test_report_never_run_is_due(self) -> None:
        """A report that has never run (last_run_at is NULL) should be due."""
        mock_db = MagicMock()
        # First query: list enabled reports
        # mock the return so first call is the list, second is the scalar for last_run_at
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Weekly PDF",
                            "0 7 * * 1",  # Every Monday 07:00 UTC
                            "pdf",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),  # last_run_at is None
        ]

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    return_value="/tmp/test.pdf",
                ):
                    with patch("tasks.scheduled_reports.send_email_task") as mock_send:
                        result = execute_due_reports()
                        assert result["status"] == "ok"
                        assert result["due"] == 1
                        assert result["executed"] == 1
                        assert result["skipped"] == 0
                        mock_send.delay.assert_called_once()

    def test_report_already_run_not_due(self) -> None:
        """A report whose last_run_at is after the most recent cron trigger should not be due."""
        now = datetime.now(timezone.utc)
        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Weekly PDF",
                            "0 7 * * 1",  # Every Monday 07:00
                            "pdf",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=now)),  # last_run_at is now
        ]

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                result = execute_due_reports()
                assert result["due"] == 0
                assert result["executed"] == 0

    def test_report_late_last_run_is_due(self) -> None:
        """A report whose last_run_at is days ago should be due."""
        three_days_ago = datetime.now(timezone.utc) - timedelta(days=3)

        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Daily CSV",
                            "0 6 * * *",  # Every day 06:00 UTC
                            "csv",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=three_days_ago)),
        ]

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    return_value="/tmp/test.csv",
                ):
                    result = execute_due_reports()
                    assert result["due"] == 1
                    assert result["executed"] == 1

    def test_invalid_cron_skips_report(self) -> None:
        """A report with an invalid cron expression is skipped (not due)."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Bad Cron",
                            "invalid cron expr",
                            "pdf",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                result = execute_due_reports()
                assert result["due"] == 0
                assert result["executed"] == 0

    def test_no_recipients_still_executes(self) -> None:
        """A report with no recipients should still generate the export."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "No Recipients",
                            "0 8 * * *",
                            "csv",
                            {},
                            [],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    return_value="/tmp/test.csv",
                ):
                    result = execute_due_reports()
                    assert result["executed"] == 1

    def test_export_failure_is_skipped(self) -> None:
        """If export generation fails, the report is skipped in the count."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Failing Export",
                            "0 9 * * *",
                            "pdf",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    side_effect=RuntimeError("Export failed"),
                ):
                    result = execute_due_reports()
                    assert result["skipped"] == 1
                    assert result["executed"] == 0

    def test_last_run_at_updated_after_execution(self) -> None:
        """After successful execution, last_run_at should be updated."""
        # We need two separate DB sessions: one for listing + checking, one for updating
        list_db = MagicMock()
        list_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Test Report",
                            "0 10 * * *",
                            "csv",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]

        update_db = MagicMock()

        with patch("tasks.scheduled_reports.get_session", side_effect=[list_db, update_db]):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    return_value="/tmp/test.csv",
                ):
                    result = execute_due_reports()
                    assert result["executed"] == 1
                    # Verify update_db.execute was called to update last_run_at
                    update_db.execute.assert_called()
                    update_db.commit.assert_called()


class TestGenerateReportExport:
    """Test the export generation helper via execute_due_reports integration."""

    def test_export_failure_is_tolerated(self) -> None:
        """When export generation fails, the report is counted as skipped and execution continues."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Failing Export",
                            "0 9 * * *",
                            "pdf",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]

        with patch("tasks.scheduled_reports.get_session", return_value=mock_db):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    side_effect=RuntimeError("Export failed"),
                ):
                    result = execute_due_reports()
                    assert result["skipped"] == 1
                    assert result["executed"] == 0

    def test_export_success_counts_as_executed(self) -> None:
        """When export generation succeeds, the report is counted as executed."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Test Export",
                            "0 10 * * *",
                            "csv",
                            {},
                            ["admin@test.com"],
                        )
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]

        update_db = MagicMock()

        with patch("tasks.scheduled_reports.get_session", side_effect=[mock_db, update_db]):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    return_value="/tmp/test.csv",
                ):
                    result = execute_due_reports()
                    assert result["executed"] == 1

    def test_multiple_due_reports_all_executed(self) -> None:
        """When multiple reports are due, all are executed."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (
                            1,
                            "Report A",
                            "0 7 * * 1",
                            "pdf",
                            {},
                            ["a@test.com"],
                        ),
                        (
                            2,
                            "Report B",
                            "0 8 * * 1",
                            "csv",
                            {},
                            ["b@test.com"],
                        ),
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),  # report 1 last_run_at
            MagicMock(scalar=MagicMock(return_value=None)),  # report 2 last_run_at
        ]

        update_db1 = MagicMock()
        update_db2 = MagicMock()

        with patch(
            "tasks.scheduled_reports.get_session",
            side_effect=[mock_db, update_db1, update_db2],
        ):
            with patch("tasks.scheduled_reports.set_rls_context"):
                with patch(
                    "tasks.scheduled_reports._generate_report_export",
                    return_value="/tmp/test.pdf",
                ):
                    result = execute_due_reports()
                    assert result["due"] == 2
                    assert result["executed"] == 2
                    assert result["skipped"] == 0
