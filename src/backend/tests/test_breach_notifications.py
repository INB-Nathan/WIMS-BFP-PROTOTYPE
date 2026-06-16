"""
TDD: M10d breach notifications — automated breach detection + NPC 72h tracking.

Tests cover:
- Breach record created on CONFIRM_THREAT for HIGH/CRITICAL severity
- Breach NOT created on FALSE_POSITIVE or low-severity CONFIRM_THREAT
- NPC deadline is exactly 72 hours from detected_at
- breach_alert email dispatched on HIGH/CRITICAL CONFIRM_THREAT
- BREACH_DETECTED audit log written
- GET /admin/breach — 200 for SYSTEM_ADMIN, 403 for REGIONAL_ENCODER
- PATCH /admin/breach/{id} status transitions
- PATCH /admin/breach/{id} invalid status → 422 (Pydantic enum rejection)
- npc_submitted_at set when status transitions to NPC_SUBMITTED
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def mock_admin():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-admin",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


def mock_encoder():
    return {
        "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-encoder",
        "username": "encoder",
        "role": "REGIONAL_ENCODER",
    }


def _make_log_meta(severity="HIGH", narrative="Port scan detected", ts=None):
    """Return a tuple matching (severity_level, xai_narrative, timestamp)."""
    return (severity, narrative, ts or datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc))


def _mock_db_confirm_high(breach_id=1):
    """
    Mock db for a CONFIRM_THREAT HIGH call.
    Execute order (with log_system_audit patched out):
      1. SELECT security_threat_logs metadata
      2. UPDATE security_threat_logs
      3. INSERT breach_notifications RETURNING breach_id
      4. SELECT admin_emails (post-commit)
    """
    mock_db = MagicMock()

    meta_result = MagicMock()
    meta_result.fetchone.return_value = _make_log_meta("HIGH")

    update_result = MagicMock()
    update_result.rowcount = 1

    breach_insert_result = MagicMock()
    breach_insert_result.fetchone.return_value = (breach_id,)

    email_result = MagicMock()
    email_result.fetchall.return_value = [("admin@bfp.gov.ph",)]

    mock_db.execute.side_effect = [
        meta_result,
        update_result,
        breach_insert_result,
        email_result,
    ]
    return mock_db


# ─────────────────────────────────────────────────────────────────────────────
# admin/security.py — CONFIRM_THREAT hook
# ─────────────────────────────────────────────────────────────────────────────


class TestBreachCreatedOnConfirmThreat:
    def test_high_severity_creates_breach(self, client: TestClient):
        """CONFIRM_THREAT on HIGH severity → breach INSERT executed."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin
        mock_db = _mock_db_confirm_high(breach_id=42)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.log_system_audit"),
            patch("tasks.notifications.send_email_task") as mock_task,
        ):
            mock_task.delay = MagicMock()
            response = client.patch(
                "/api/admin/security-logs/99", json={"action": "CONFIRM_THREAT"}
            )

        assert response.status_code == 200
        # call_args_list[2] is the breach INSERT; arg[0] is the TextClause
        insert_sql = mock_db.execute.call_args_list[2][0][0].text
        assert "breach_notifications" in insert_sql

    def test_critical_severity_creates_breach(self, client: TestClient):
        """CONFIRM_THREAT on CRITICAL severity → breach INSERT executed."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        meta_result = MagicMock()
        meta_result.fetchone.return_value = _make_log_meta("CRITICAL")
        update_result = MagicMock()
        update_result.rowcount = 1
        breach_insert_result = MagicMock()
        breach_insert_result.fetchone.return_value = (7,)
        email_result = MagicMock()
        email_result.fetchall.return_value = []
        mock_db.execute.side_effect = [
            meta_result,
            update_result,
            breach_insert_result,
            email_result,
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.log_system_audit"),
            patch("tasks.notifications.send_email_task"),
        ):
            response = client.patch(
                "/api/admin/security-logs/55", json={"action": "CONFIRM_THREAT"}
            )

        assert response.status_code == 200
        insert_sql = mock_db.execute.call_args_list[2][0][0].text
        assert "breach_notifications" in insert_sql

    def test_low_severity_does_not_create_breach(self, client: TestClient):
        """CONFIRM_THREAT on MEDIUM severity → no breach INSERT (only 2 execute calls)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        meta_result = MagicMock()
        meta_result.fetchone.return_value = _make_log_meta("MEDIUM")
        update_result = MagicMock()
        update_result.rowcount = 1
        mock_db.execute.side_effect = [meta_result, update_result]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.log_system_audit"),
            patch("tasks.notifications.send_email_task"),
        ):
            response = client.patch(
                "/api/admin/security-logs/10", json={"action": "CONFIRM_THREAT"}
            )

        assert response.status_code == 200
        # Only 2 execute calls: SELECT metadata + UPDATE (no breach INSERT, no email query)
        assert mock_db.execute.call_count == 2

    def test_false_positive_does_not_create_breach(self, client: TestClient):
        """FALSE_POSITIVE → no breach INSERT at all."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        update_result = MagicMock()
        update_result.rowcount = 1
        mock_db.execute.return_value = update_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.security.log_system_audit"):
            response = client.patch(
                "/api/admin/security-logs/20", json={"action": "FALSE_POSITIVE"}
            )

        assert response.status_code == 200
        for c in mock_db.execute.call_args_list:
            assert "breach_notifications" not in str(c)


class TestBreachDeadline:
    def test_npc_deadline_is_72h(self, client: TestClient):
        """The npc_deadline_at passed to INSERT is detected_at + 72 hours."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin
        mock_db = _mock_db_confirm_high(breach_id=5)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.log_system_audit"),
            patch("tasks.notifications.send_email_task"),
        ):
            client.patch("/api/admin/security-logs/1", json={"action": "CONFIRM_THREAT"})

        insert_call = mock_db.execute.call_args_list[2]
        # call_args_list[2] is the breach INSERT; params are positional arg [1]
        params = insert_call[0][1] if insert_call[0] else insert_call[1]
        detected = params["detected_at"]
        deadline = params["npc_deadline_at"]
        assert deadline - detected == timedelta(hours=72)


class TestBreachEmailDispatch:
    def test_breach_alert_email_dispatched_on_high_confirm(self, client: TestClient):
        """send_email_task.delay called with template_name='breach_alert' on HIGH CONFIRM_THREAT."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin
        mock_db = _mock_db_confirm_high(breach_id=3)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        # send_email_task is lazily imported inside the function body, so patch the source module
        with (
            patch("api.routes.admin.security.log_system_audit"),
            patch("tasks.notifications.send_email_task") as mock_task,
        ):
            mock_task.delay = MagicMock()
            client.patch("/api/admin/security-logs/1", json={"action": "CONFIRM_THREAT"})

        template_names = [c.kwargs.get("template_name") for c in mock_task.delay.call_args_list]
        assert "breach_alert" in template_names

    def test_breach_alert_not_dispatched_on_false_positive(self, client: TestClient):
        """FALSE_POSITIVE → breach_alert email NOT dispatched."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        update_result = MagicMock()
        update_result.rowcount = 1
        mock_db.execute.return_value = update_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.log_system_audit"),
            patch("tasks.notifications.send_email_task") as mock_task,
        ):
            mock_task.delay = MagicMock()
            client.patch("/api/admin/security-logs/2", json={"action": "FALSE_POSITIVE"})

        template_names = [c.kwargs.get("template_name") for c in mock_task.delay.call_args_list]
        assert "breach_alert" not in template_names

    def test_breach_alert_context_includes_npc_deadline(self, client: TestClient):
        """breach_alert email context contains breach_id and npc_deadline keys."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin
        mock_db = _mock_db_confirm_high(breach_id=9)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.log_system_audit"),
            patch("tasks.notifications.send_email_task") as mock_task,
        ):
            mock_task.delay = MagicMock()
            client.patch("/api/admin/security-logs/5", json={"action": "CONFIRM_THREAT"})

        breach_call = next(
            (
                c
                for c in mock_task.delay.call_args_list
                if c.kwargs.get("template_name") == "breach_alert"
            ),
            None,
        )
        assert breach_call is not None
        ctx = breach_call.kwargs["context"]
        assert "breach_id" in ctx
        assert "npc_deadline" in ctx
        assert ctx["breach_id"] == 9


class TestBreachAuditLog:
    def test_breach_detected_audit_written(self, client: TestClient):
        """log_system_audit called with action_type='BREACH_DETECTED' on HIGH CONFIRM_THREAT."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin
        mock_db = _mock_db_confirm_high(breach_id=11)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with (
            patch("api.routes.admin.security.log_system_audit") as mock_audit,
            patch("tasks.notifications.send_email_task"),
        ):
            client.patch("/api/admin/security-logs/8", json={"action": "CONFIRM_THREAT"})

        audit_actions = [c.args[2] for c in mock_audit.call_args_list]
        assert "BREACH_DETECTED" in audit_actions


# ─────────────────────────────────────────────────────────────────────────────
# GET /admin/breach
# ─────────────────────────────────────────────────────────────────────────────


class TestBreachList:
    def _make_breach_row(self, breach_id=1):
        now = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
        return (
            breach_id,
            42,
            now,
            now + timedelta(hours=72),
            "DETECTED",
            None,
            None,
            None,
            None,
            None,
            now,
            now,
        )

    def test_list_returns_200_for_admin(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        result = MagicMock()
        result.fetchall.return_value = [self._make_breach_row(1), self._make_breach_row(2)]
        mock_db.execute.return_value = result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/breach")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["breach_id"] == 1

    def test_list_returns_403_for_encoder(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder
        response = client.get("/api/admin/breach")
        assert response.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /admin/breach/{id}
# ─────────────────────────────────────────────────────────────────────────────


class TestBreachPatch:
    def _make_updated_row(self, status="DPO_NOTIFIED"):
        now = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
        return (
            1,
            42,
            now,
            now + timedelta(hours=72),
            status,
            None,
            None,
            None,
            None,
            None,
            now,
            now,
        )

    def _make_old_row(self, status="DETECTED"):
        now = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
        return (
            1,
            42,
            now,
            now + timedelta(hours=72),
            status,
            None,
            None,
            None,
            None,
            None,
            now,
            now,
        )

    def test_patch_status_transition(self, client: TestClient):
        """PATCH with valid status returns 200 and updated breach."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        old_select_result = MagicMock()
        old_select_result.fetchone.return_value = self._make_old_row("DETECTED")
        update_result = MagicMock()
        update_result.rowcount = 1
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = self._make_updated_row("DPO_NOTIFIED")
        mock_db.execute.side_effect = [old_select_result, update_result, fetch_result]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.breach.log_system_audit") as mock_audit:
            response = client.patch("/api/admin/breach/1", json={"status": "DPO_NOTIFIED"})

        assert response.status_code == 200
        assert response.json()["status"] == "DPO_NOTIFIED"
        # Verify enriched audit call
        assert mock_audit.call_count == 1
        _, kwargs = mock_audit.call_args_list[0] if mock_audit.call_args_list else ((), {})
        # Check positional args
        args = mock_audit.call_args_list[0][0] if mock_audit.call_args_list else []
        kwargs = mock_audit.call_args_list[0][1] if mock_audit.call_args_list else {}
        # action_type is arg[2]
        if len(args) >= 3:
            assert args[2] == "BREACH_STATUS_UPDATE"
        else:
            assert kwargs.get("action_type") == "BREACH_STATUS_UPDATE"

    def test_patch_invalid_status_returns_422(self, client: TestClient):
        """PATCH with an invalid status value → 422 (Pydantic enum validation)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin
        mock_db = MagicMock()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/breach/1", json={"status": "BANANA"})
        assert response.status_code == 422

    def test_patch_no_fields_returns_400(self, client: TestClient):
        """PATCH with empty body → 400."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        old_select_result = MagicMock()
        old_select_result.fetchone.return_value = self._make_old_row("DETECTED")
        mock_db.execute.return_value = old_select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/breach/1", json={})
        assert response.status_code == 400

    def test_patch_npc_submitted_sets_timestamp(self, client: TestClient):
        """PATCH to NPC_SUBMITTED → SQL includes npc_submitted_at = now()."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        old_select_result = MagicMock()
        old_select_result.fetchone.return_value = self._make_old_row("DPO_NOTIFIED")
        update_result = MagicMock()
        update_result.rowcount = 1
        now = datetime(2026, 6, 10, 14, 0, 0, tzinfo=timezone.utc)
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = (
            1,
            42,
            now,
            now + timedelta(hours=72),
            "NPC_SUBMITTED",
            None,
            None,
            None,
            None,
            now,
            now,
            now,
        )
        mock_db.execute.side_effect = [old_select_result, update_result, fetch_result]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.breach.log_system_audit"):
            response = client.patch("/api/admin/breach/1", json={"status": "NPC_SUBMITTED"})

        assert response.status_code == 200
        update_sql = mock_db.execute.call_args_list[1][0][0].text
        assert "npc_submitted_at" in update_sql

    def test_patch_404_for_missing_breach(self, client: TestClient):
        """PATCH on a non-existent breach_id → 404 (caught at old-row SELECT)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        old_select_result = MagicMock()
        old_select_result.fetchone.return_value = None
        mock_db.execute.return_value = old_select_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.breach.log_system_audit"):
            response = client.patch("/api/admin/breach/9999", json={"status": "CLOSED"})

        assert response.status_code == 404

    def test_patch_includes_audit_old_new_values(self, client: TestClient):
        """PATCH audit call carries old_values and new_values for forensic comparison."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        old_select_result = MagicMock()
        old_select_result.fetchone.return_value = self._make_old_row("DETECTED")
        update_result = MagicMock()
        update_result.rowcount = 1
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = self._make_updated_row("DPO_NOTIFIED")
        mock_db.execute.side_effect = [old_select_result, update_result, fetch_result]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.breach.log_system_audit") as mock_audit:
            response = client.patch("/api/admin/breach/1", json={"status": "DPO_NOTIFIED"})

        assert response.status_code == 200
        assert mock_audit.call_count == 1
        kwargs = mock_audit.call_args[1]
        assert kwargs["old_values"] is not None
        assert kwargs["old_values"]["status"] == "DETECTED"
        assert kwargs["new_values"] is not None
        assert kwargs["new_values"]["status"] == "DPO_NOTIFIED"

    def test_patch_includes_request_metadata(self, client: TestClient):
        """PATCH audit call includes request param for client IP/UA capture (#360 pattern)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        old_select_result = MagicMock()
        old_select_result.fetchone.return_value = self._make_old_row("DETECTED")
        update_result = MagicMock()
        update_result.rowcount = 1
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = self._make_updated_row("DPO_NOTIFIED")
        mock_db.execute.side_effect = [old_select_result, update_result, fetch_result]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.breach.log_system_audit") as mock_audit:
            response = client.patch(
                "/api/admin/breach/1",
                json={"status": "DPO_NOTIFIED"},
                headers={"X-Forwarded-For": "192.168.1.100"},
            )

        assert response.status_code == 200
        assert mock_audit.call_count == 1
        kwargs = mock_audit.call_args[1]
        # request should be a non-None Request object
        assert kwargs["request"] is not None

    def test_patch_notes_included_in_audit(self, client: TestClient):
        """PATCH with notes passes notes through to audit new_values."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin

        mock_db = MagicMock()
        old_row = self._make_old_row("DETECTED")
        old_select_result = MagicMock()
        old_select_result.fetchone.return_value = old_row
        update_result = MagicMock()
        update_result.rowcount = 1
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = self._make_updated_row("DPO_NOTIFIED")
        mock_db.execute.side_effect = [old_select_result, update_result, fetch_result]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.breach.log_system_audit") as mock_audit:
            response = client.patch(
                "/api/admin/breach/1",
                json={"status": "DPO_NOTIFIED", "notes": "advancing with evidence"},
            )

        assert response.status_code == 200
        kwargs = mock_audit.call_args[1]
        assert kwargs["new_values"]["notes"] == "advancing with evidence"
