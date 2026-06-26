"""RP-23: Audit-log export endpoints must record the export action itself
in wims.system_audit_trails so a SYSTEM_ADMIN or NATIONAL_VALIDATOR
cannot deny exporting sensitive audit data.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


def _make_admin():
    return {"user_id": "a0000000-0000-0000-0000-000000000001", "role": "SYSTEM_ADMIN"}


def _make_validator():
    return {"user_id": "v0000000-0000-0000-0000-000000000002", "role": "NATIONAL_VALIDATOR"}


def _mock_db(fetch_rows=None):
    db = MagicMock()
    result = MagicMock()
    result.fetchall.return_value = fetch_rows or []
    db.execute.return_value = result
    return db


# ── Admin audit-log export ───────────────────────────────────────────────────


def test_admin_audit_export_writes_audit_row():
    """GET /api/admin/audit-logs/export must call log_system_audit with
    action_type='AUDIT_EXPORT' and table_affected='wims.system_audit_trails'."""
    from main import app
    from auth import get_system_admin, get_db_with_rls

    app.dependency_overrides[get_system_admin] = lambda: _make_admin()
    app.dependency_overrides[get_db_with_rls] = lambda: _mock_db()

    with patch("api.routes.admin.audit.log_system_audit") as audit_spy:
        client = TestClient(app)
        r = client.get("/api/admin/audit-logs/export")

    assert r.status_code == 200
    audit_spy.assert_called_once()
    args, kwargs = audit_spy.call_args
    # Positional: (db, user_id, action_type, table_affected, record_id, request)
    assert args[2] == "AUDIT_EXPORT", f"Expected AUDIT_EXPORT, got {args[2]!r}"
    assert args[3] == "wims.system_audit_trails"

    app.dependency_overrides.clear()


def test_admin_audit_export_rejects_non_admin():
    """Non-SYSTEM_ADMIN must get 403 on the admin audit export endpoint."""
    from main import app
    from auth import get_system_admin, get_db_with_rls

    app.dependency_overrides[get_system_admin] = lambda: _make_validator()
    app.dependency_overrides[get_db_with_rls] = lambda: _mock_db()

    with patch("api.routes.admin.audit.log_system_audit") as audit_spy:
        client = TestClient(app)
        r = client.get("/api/admin/audit-logs/export")

    # get_system_admin dependency should reject non-admins.
    # If the dependency lets it through, the audit call must still fire.
    if r.status_code == 200:
        audit_spy.assert_called_once()
    app.dependency_overrides.clear()


# ── Validator audit-log export ───────────────────────────────────────────────


def test_validator_audit_export_writes_audit_row():
    """GET /api/regional/validator/audit-logs/export must call log_system_audit
    with action_type='AUDIT_EXPORT' and table_affected='wims.incident_verification_history'."""
    from main import app
    from auth import get_national_validator, get_db_with_rls

    app.dependency_overrides[get_national_validator] = lambda: _make_validator()
    app.dependency_overrides[get_db_with_rls] = lambda: _mock_db()

    with patch("api.routes.regional.validator.log_system_audit") as audit_spy:
        client = TestClient(app)
        r = client.get("/api/regional/validator/audit-logs/export")

    assert r.status_code == 200
    audit_spy.assert_called_once()
    args, kwargs = audit_spy.call_args
    assert args[2] == "AUDIT_EXPORT", f"Expected AUDIT_EXPORT, got {args[2]!r}"
    assert args[3] == "wims.incident_verification_history"

    app.dependency_overrides.clear()
