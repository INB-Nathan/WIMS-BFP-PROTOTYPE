"""Tests for scheduled reports task — Issue #88."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from database import SYSTEM_TASK_USER_ID
from tasks.exports import export_scheduled_report
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


class TestScheduledExportSeam:
    """Issue #729 — scheduled exports route through the canonical export seam."""

    def test_due_report_records_file_export_log_and_audit_mirror(
        self, tmp_path, monkeypatch
    ) -> None:
        """One due report: file output, exactly one analytics_export_log row,
        exactly one BULK_EXPORT audit event, under the system-task identity."""
        list_db = MagicMock()
        list_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (1, "Daily CSV", "0 6 * * *", "csv", {}, ["admin@test.com"]),
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]
        update_db = MagicMock()
        export_db = MagicMock()
        send_email = MagicMock()
        set_rls = MagicMock()

        monkeypatch.setattr(
            "tasks.scheduled_reports.get_session",
            MagicMock(side_effect=[list_db, update_db]),
        )
        monkeypatch.setattr("tasks.scheduled_reports.set_rls_context", MagicMock())
        monkeypatch.setattr("tasks.scheduled_reports.send_email_task", send_email)
        monkeypatch.setattr("tasks.exports.get_session", lambda: export_db)
        monkeypatch.setattr("tasks.exports.set_rls_context", set_rls)
        monkeypatch.setattr(
            "tasks.exports.get_export_rows",
            MagicMock(return_value=[{"incident_id": 1}, {"incident_id": 2}]),
        )
        monkeypatch.setattr("tasks.exports.EXPORT_DIR", str(tmp_path))

        result = execute_due_reports()

        assert result["status"] == "ok"
        assert result["due"] == 1
        assert result["executed"] == 1
        assert result["skipped"] == 0

        # File output with the scheduled filename prefix.
        files = sorted(tmp_path.glob("scheduled_1_*.csv"))
        assert len(files) == 1
        assert "incident_id" in files[0].read_text(encoding="utf-8").splitlines()[0]

        # Exactly one analytics_export_log row under the system-task identity.
        calls = export_db.execute.call_args_list
        export_log_calls = [c for c in calls if "analytics_export_log" in str(c.args[0])]
        assert len(export_log_calls) == 1
        params = export_log_calls[0].args[1]
        assert params["user_id"] == str(SYSTEM_TASK_USER_ID)
        assert params["export_type"] == "analytics"
        assert params["row_count"] == 2
        assert "task_id" in params

        # Exactly one BULK_EXPORT audit event.
        audit_calls = [
            c
            for c in calls
            if "system_audit_trails" in str(c.args[0]) and c.args[1].get("action") == "BULK_EXPORT"
        ]
        assert len(audit_calls) == 1

        # RLS identity: the export session ran as the system task user.
        assert set_rls.call_args.args[0] is export_db
        assert set_rls.call_args.args[1] == SYSTEM_TASK_USER_ID

        # Orchestration preserved: email dispatched, last_run_at advanced.
        send_email.delay.assert_called_once()
        update_db.execute.assert_called()
        update_db.commit.assert_called()

    def test_failed_export_creates_no_success_records(self, tmp_path, monkeypatch) -> None:
        """A failed export writes no export-log/audit rows, sends no email,
        does not advance last_run_at, and counts as skipped."""
        list_db = MagicMock()
        list_db.execute.side_effect = [
            MagicMock(
                fetchall=MagicMock(
                    return_value=[
                        (1, "Failing CSV", "0 6 * * *", "csv", {}, ["admin@test.com"]),
                    ]
                )
            ),
            MagicMock(scalar=MagicMock(return_value=None)),
        ]
        update_db = MagicMock()
        export_db = MagicMock()
        send_email = MagicMock()

        monkeypatch.setattr(
            "tasks.scheduled_reports.get_session",
            MagicMock(side_effect=[list_db, update_db]),
        )
        monkeypatch.setattr("tasks.scheduled_reports.set_rls_context", MagicMock())
        monkeypatch.setattr("tasks.scheduled_reports.send_email_task", send_email)
        monkeypatch.setattr("tasks.exports.get_session", lambda: export_db)
        monkeypatch.setattr("tasks.exports.set_rls_context", MagicMock())
        monkeypatch.setattr(
            "tasks.exports.get_export_rows",
            MagicMock(side_effect=RuntimeError("read model unavailable")),
        )
        monkeypatch.setattr("tasks.exports.EXPORT_DIR", str(tmp_path))

        result = execute_due_reports()

        assert result["executed"] == 0
        assert result["skipped"] == 1

        # No misleading success records, email, or last_run_at advance.
        calls = export_db.execute.call_args_list
        assert not any("analytics_export_log" in str(c.args[0]) for c in calls)
        assert not any("system_audit_trails" in str(c.args[0]) for c in calls)
        send_email.delay.assert_not_called()
        update_db.execute.assert_not_called()
        update_db.commit.assert_not_called()
        assert not list(tmp_path.glob("scheduled_1_*.csv"))

    @pytest.mark.parametrize(
        ("export_format", "extension", "content_type"),
        [
            ("csv", ".csv", "text/csv"),
            (
                "excel",
                ".xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
            ("pdf", ".pdf", "application/pdf"),
        ],
    )
    def test_export_scheduled_report_prefixes_filename_and_logs(
        self, tmp_path, monkeypatch, export_format, extension, content_type
    ) -> None:
        """export_scheduled_report maps csv/excel/pdf to the shared bulk
        writer, keeps the scheduled_<report_id>_ prefix, and records the
        export with the caller's task id and system identity."""
        export_db = MagicMock()
        monkeypatch.setattr("tasks.exports.EXPORT_DIR", str(tmp_path))
        monkeypatch.setattr("tasks.exports.get_session", lambda: export_db)
        monkeypatch.setattr("tasks.exports.set_rls_context", MagicMock())
        monkeypatch.setattr(
            "tasks.exports.get_export_rows",
            MagicMock(return_value=[{"incident_id": 42}]),
        )

        path = export_scheduled_report(
            task_id="task-sched-1",
            user_id=str(SYSTEM_TASK_USER_ID),
            report_id=7,
            export_format=export_format,
            filters={"region_id": 1},
            columns=["incident_id"],
        )

        assert path.startswith(str(tmp_path))
        assert path.endswith(extension)
        assert Path(path).name.startswith("scheduled_7_")
        assert Path(path).is_file()

        calls = export_db.execute.call_args_list
        export_log_calls = [c for c in calls if "analytics_export_log" in str(c.args[0])]
        assert len(export_log_calls) == 1
        params = export_log_calls[0].args[1]
        assert params["task_id"] == "task-sched-1"
        assert params["user_id"] == str(SYSTEM_TASK_USER_ID)
        assert params["export_type"] == "analytics"
        assert params["row_count"] == 1
        assert params["format"] == export_format
        assert params["content_type"] == content_type

    def test_export_scheduled_report_rejects_unknown_format(self) -> None:
        """Unknown formats raise instead of silently writing a CSV."""
        with pytest.raises(ValueError):
            export_scheduled_report(
                task_id=None,
                user_id=str(SYSTEM_TASK_USER_ID),
                report_id=1,
                export_format="html",
                filters={},
                columns=["incident_id"],
            )
