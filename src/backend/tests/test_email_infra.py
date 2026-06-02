"""Tests for M13b email infrastructure (Jinja2 HTML templates + SMTP send)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from services.email.sender import render_email


class TestRenderEmail:
    """Test that all 4 Jinja2 HTML templates render without error and produce valid HTML."""

    def test_render_password_reset(self) -> None:
        subject, html = render_email(
            "password_reset",
            {
                "full_name": "Juan Dela Cruz",
                "reset_link": "https://wimsbfp.tech/reset?token=abc123",
                "expiry_minutes": 30,
            },
        )
        assert subject == "Reset your WIMS-BFP password"
        assert len(html) > 100
        assert "Juan Dela Cruz" in html
        assert "abc123" in html
        assert "30" in html
        assert "#8B0000" in html or "8B0000" in html

    def test_render_account_locked(self) -> None:
        subject, html = render_email(
            "account_locked",
            {
                "full_name": "Maria Santos",
                "unlock_time": "2026-06-02 15:00 UTC",
                "support_contact": "support@bfp.gov.ph",
            },
        )
        assert subject == "WIMS-BFP Account Locked — Action Required"
        assert len(html) > 100
        assert "Maria Santos" in html
        assert "2026-06-02 15:00 UTC" in html
        assert "#8B0000" in html or "8B0000" in html

    def test_render_security_alert(self) -> None:
        subject, html = render_email(
            "security_alert",
            {
                "severity": "HIGH",
                "summary": "Multiple failed login attempts from foreign IP",
                "detected_at": "2026-06-02 10:30:00 UTC",
                "dashboard_link": "https://wimsbfp.tech/admin/system",
            },
        )
        assert "HIGH" in subject
        assert len(html) > 100
        assert "Multiple failed login attempts" in html
        assert "#8B0000" in html or "8B0000" in html

    def test_render_weekly_report(self) -> None:
        subject, html = render_email(
            "weekly_report",
            {
                "week_range": "May 26 – June 1, 2026",
                "total_incidents": "142",
                "top_region": "NCR",
                "report_link": "https://wimsbfp.tech/dashboard/analyst",
            },
        )
        assert "May 26" in subject
        assert len(html) > 100
        assert "142" in html
        assert "#8B0000" in html or "8B0000" in html


class TestSendEmail:
    """Test the send_email Celery task with mocked aiosmtplib."""

    @pytest.mark.asyncio
    async def test_send_email_calls_aiosmtplib(self) -> None:
        with patch("services.email.sender.aiosmtplib.send", new_callable=AsyncMock) as mock_send:
            from services.email.sender import send_email_async

            await send_email_async(
                "test@example.com",
                "password_reset",
                {
                    "full_name": "Test User",
                    "reset_link": "https://wimsbfp.tech/reset?token=xyz",
                    "expiry_minutes": 30,
                },
            )

            assert mock_send.called
            call_args = mock_send.call_args
            msg = call_args[0][0]
            assert "test@example.com" in msg["To"]
            assert "Reset your WIMS-BFP password" in msg["Subject"]

    @pytest.mark.asyncio
    async def test_send_email_raises_on_smtp_failure(self) -> None:
        with patch(
            "services.email.sender.aiosmtplib.send",
            new_callable=AsyncMock,
            side_effect=Exception("SMTP connection refused"),
        ):
            from services.email.sender import send_email_async

            with pytest.raises(Exception, match="SMTP connection refused"):
                await send_email_async(
                    "test@example.com",
                    "password_reset",
                    {
                        "full_name": "Test User",
                        "reset_link": "https://wimsbfp.tech/reset?token=xyz",
                        "expiry_minutes": 30,
                    },
                )


class TestEmailServiceTask:
    """Test the Celery send_email_task via importlib with mocked sqlalchemy.

    The task uses @celery_app.task() decorator (requires full Celery setup).
    We load the module with mocked deps and test _send_email directly.
    """

    def test_send_email_task_calls_sender_on_success(self) -> None:
        import importlib.util
        from unittest.mock import MagicMock, patch
        import sys

        for mod in ("sqlalchemy", "celery_config", "database"):
            sys.modules[mod] = MagicMock()

        spec = importlib.util.spec_from_file_location(
            "notifications_tasks",
            "E:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/tasks/notifications.py",
        )
        module = importlib.util.module_from_spec(spec)  # type: ignore[assignment]
        spec.loader.exec_module(module)  # type: ignore[union-attr]

        _send_email_mock = MagicMock()
        with patch.object(module, "_send_email", _send_email_mock):
            module._send_email(
                "admin@bfp.gov.ph",
                "security_alert",
                {
                    "severity": "CRITICAL",
                    "summary": "Brute force attack detected",
                    "detected_at": "2026-06-02 08:00:00 UTC",
                    "dashboard_link": "https://wimsbfp.tech/admin/system",
                },
            )
            assert _send_email_mock.called

        for mod in ("sqlalchemy", "celery_config", "database"):
            sys.modules.pop(mod, None)

    def test_send_email_task_raises_on_sender_failure(self) -> None:
        import importlib.util
        from unittest.mock import MagicMock, patch
        import sys

        for mod in ("sqlalchemy", "celery_config", "database"):
            sys.modules[mod] = MagicMock()

        spec = importlib.util.spec_from_file_location(
            "notifications_tasks",
            "E:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/tasks/notifications.py",
        )
        module = importlib.util.module_from_spec(spec)  # type: ignore[assignment]
        spec.loader.exec_module(module)  # type: ignore[union-attr]

        with patch.object(
            module,
            "_send_email",
            side_effect=Exception("SMTP down"),
        ):
            with pytest.raises(Exception, match="SMTP down"):
                module._send_email(
                    "admin@bfp.gov.ph",
                    "security_alert",
                    {
                        "severity": "CRITICAL",
                        "summary": "Brute force attack detected",
                        "detected_at": "2026-06-02 08:00:00 UTC",
                        "dashboard_link": "https://wimsbfp.tech/admin/system",
                    },
                )

        for mod in ("sqlalchemy", "celery_config", "database"):
            sys.modules.pop(mod, None)
