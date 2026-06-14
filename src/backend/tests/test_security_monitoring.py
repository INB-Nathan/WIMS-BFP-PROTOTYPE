"""
Tests for M8 security monitoring dashboard extensions:
  - multi-value severity filter on GET /api/admin/security-logs
  - GET /api/admin/security-logs/summary shape + counts
All tests are unit tests (mock DB); no running stack required.
"""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from main import app

_ADMIN = {
    "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "keycloak_id": "kid-admin",
    "username": "admin",
    "role": "SYSTEM_ADMIN",
}

_HIGH_ROW = (
    1,
    None,
    "10.0.0.1",
    "10.0.0.2",
    1001,
    "HIGH",
    "{}",
    "narrative",
    0.9,
    None,
    None,
    None,
    None,
)
_CRITICAL_ROW = (
    2,
    None,
    "10.0.0.3",
    "10.0.0.4",
    1002,
    "CRITICAL",
    "{}",
    None,
    None,
    None,
    None,
    None,
    None,
)
_LOW_ROW = (3, None, "10.0.0.5", "10.0.0.6", 1003, "LOW", "{}", None, None, None, None, None, None)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def _make_list_db(rows, total):
    """Mock DB for the 2-execute pattern used by GET /security-logs."""
    mock_rows = MagicMock()
    mock_rows.fetchall.return_value = rows
    mock_count = MagicMock()
    mock_count.scalar.return_value = total

    mock_db = MagicMock()
    mock_db.execute.side_effect = [mock_rows, mock_count]

    def _get_db():
        yield mock_db

    return mock_db, _get_db


def _make_summary_db(sev_rows, unreviewed, total, narrative_rows):
    """Mock DB for the 4-execute pattern used by GET /security-logs/summary."""
    mock_sev = MagicMock()
    mock_sev.fetchall.return_value = sev_rows

    mock_unreviewed = MagicMock()
    mock_unreviewed.scalar.return_value = unreviewed

    mock_total = MagicMock()
    mock_total.scalar.return_value = total

    mock_narratives = MagicMock()
    mock_narratives.fetchall.return_value = narrative_rows

    mock_db = MagicMock()
    mock_db.execute.side_effect = [mock_sev, mock_unreviewed, mock_total, mock_narratives]

    def _get_db():
        yield mock_db

    return mock_db, _get_db


# ---------------------------------------------------------------------------
# Multi-value severity filter
# ---------------------------------------------------------------------------


class TestSeverityFilter:
    def test_multi_severity_returns_matching_rows(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_HIGH_ROW, _CRITICAL_ROW], total=2)
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs?severity=HIGH,CRITICAL")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        levels = {item["severity_level"] for item in data["items"]}
        assert levels == {"HIGH", "CRITICAL"}

    def test_multi_severity_uses_in_clause(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_HIGH_ROW, _CRITICAL_ROW], total=2)
        app.dependency_overrides[get_db_with_rls] = _get_db

        client.get("/api/admin/security-logs?severity=HIGH,CRITICAL")

        sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("IN" in sql for sql in sqls), "Expected IN clause for multi-severity filter"

    def test_multi_severity_binds_individual_params(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_HIGH_ROW, _CRITICAL_ROW], total=2)
        app.dependency_overrides[get_db_with_rls] = _get_db

        client.get("/api/admin/security-logs?severity=HIGH,CRITICAL")

        bound_params_list = [c[0][1] for c in mock_db.execute.call_args_list if len(c[0]) > 1]
        all_values = set()
        for params in bound_params_list:
            all_values.update(params.values())
        assert "HIGH" in all_values
        assert "CRITICAL" in all_values

    def test_single_severity_still_works(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_HIGH_ROW], total=1)
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs?severity=HIGH")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["severity_level"] == "HIGH"

    def test_invalid_severity_ignored_returns_all(self, client: TestClient):
        """Entirely invalid severity values are silently ignored → no WHERE clause added."""
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_HIGH_ROW, _LOW_ROW], total=2)
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs?severity=BOGUS,INVALID")

        assert resp.status_code == 200
        # No severity filter added → returns whatever the mock returns
        assert resp.json()["total"] == 2

    def test_mixed_valid_invalid_severity_filters_valid_only(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_HIGH_ROW], total=1)
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs?severity=HIGH,BOGUS")

        assert resp.status_code == 200
        # "HIGH" is valid, "BOGUS" stripped → single-value path (= not IN)
        bound_params_list = [c[0][1] for c in mock_db.execute.call_args_list if len(c[0]) > 1]
        all_values = set()
        for params in bound_params_list:
            all_values.update(params.values())
        assert "HIGH" in all_values
        assert "BOGUS" not in all_values


# ---------------------------------------------------------------------------
# Combined severity + source_ip filter
# ---------------------------------------------------------------------------


class TestCombinedSeveritySourceIpFilter:
    """Combined filter test for severity + source_ip on GET /api/admin/security-logs."""

    # Rows with varying severity/IP combos for combined filter coverage.
    # Row 6: HIGH severity, source_ip=10.0.0.1 -> matches both filters
    _HIGH_MATCH = (
        6,
        None,
        "10.0.0.1",
        "10.0.0.2",
        1006,
        "HIGH",
        "{}",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    # Row 7: CRITICAL severity, source_ip=10.0.0.1 -> matches both filters
    _CRITICAL_MATCH = (
        7,
        None,
        "10.0.0.1",
        "10.0.0.4",
        1007,
        "CRITICAL",
        "{}",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    # Row 8: HIGH severity but source_ip=10.0.0.99 -> excluded by source_ip filter
    _HIGH_WRONG_IP = (
        8,
        None,
        "10.0.0.99",
        "10.0.0.2",
        1008,
        "HIGH",
        "{}",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    # Row 9: LOW severity but source_ip=10.0.0.1 -> excluded by severity filter
    _LOW_MATCH_IP = (
        9,
        None,
        "10.0.0.1",
        "10.0.0.2",
        1009,
        "LOW",
        "{}",
        None,
        None,
        None,
        None,
        None,
        None,
    )

    def test_severity_and_source_ip_combined_filter(self, client: TestClient):
        """Combined ?severity=HIGH,CRITICAL&source_ip=10.0.0.1 returns only
        rows matching both criteria; excludes mismatched rows."""
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        # Mock returns only the two rows that satisfy both filters
        mock_db, _get_db = _make_list_db([self._HIGH_MATCH, self._CRITICAL_MATCH], total=2)
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs?severity=HIGH,CRITICAL&source_ip=10.0.0.1")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        # Every returned item must satisfy both criteria
        for item in data["items"]:
            assert item["severity_level"] in {"HIGH", "CRITICAL"}
            assert item["source_ip"] == "10.0.0.1"

    def test_combined_filter_sql_contains_both_conditions(self, client: TestClient):
        """Verify the generated SQL includes both severity IN and source_ip equality."""
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([self._HIGH_MATCH, self._CRITICAL_MATCH], total=2)
        app.dependency_overrides[get_db_with_rls] = _get_db

        client.get("/api/admin/security-logs?severity=HIGH,CRITICAL&source_ip=10.0.0.1")

        sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        # Check data query (first call) for both conditions
        data_sql = sqls[0]
        assert "source_ip = :source_ip" in data_sql
        assert "severity_level IN" in data_sql
        # Verify count query (second call) also includes both conditions
        count_sql = sqls[1]
        assert "source_ip = :source_ip" in count_sql
        assert "severity_level IN" in count_sql

    def test_combined_filter_binds_correct_params(self, client: TestClient):
        """Verify bound parameters include both severity values and source_ip."""
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([self._HIGH_MATCH, self._CRITICAL_MATCH], total=2)
        app.dependency_overrides[get_db_with_rls] = _get_db

        client.get("/api/admin/security-logs?severity=HIGH,CRITICAL&source_ip=10.0.0.1")

        bound_params_list = [c[0][1] for c in mock_db.execute.call_args_list if len(c[0]) > 1]
        all_values = set()
        for params in bound_params_list:
            all_values.update(params.values())
        assert "HIGH" in all_values
        assert "CRITICAL" in all_values
        assert "10.0.0.1" in all_values


# ---------------------------------------------------------------------------
# Summary endpoint
# ---------------------------------------------------------------------------


class TestSecurityLogsSummary:
    def test_summary_returns_expected_shape(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        _, _get_db = _make_summary_db(
            sev_rows=[("HIGH", 5), ("CRITICAL", 2), ("LOW", 10), ("MEDIUM", 3)],
            unreviewed=4,
            total=20,
            narrative_rows=[],
        )
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs/summary")

        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"by_severity", "unreviewed_count", "total", "recent_narratives"}

    def test_summary_by_severity_counts(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        _, _get_db = _make_summary_db(
            sev_rows=[("HIGH", 5), ("CRITICAL", 2)],
            unreviewed=4,
            total=7,
            narrative_rows=[],
        )
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs/summary")

        data = resp.json()
        assert data["by_severity"]["HIGH"] == 5
        assert data["by_severity"]["CRITICAL"] == 2
        assert data["by_severity"]["LOW"] == 0
        assert data["by_severity"]["MEDIUM"] == 0

    def test_summary_unreviewed_and_total(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        _, _get_db = _make_summary_db(
            sev_rows=[],
            unreviewed=7,
            total=15,
            narrative_rows=[],
        )
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs/summary")

        data = resp.json()
        assert data["unreviewed_count"] == 7
        assert data["total"] == 15

    def test_summary_recent_narratives_shape(self, client: TestClient):
        import datetime

        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        ts = datetime.datetime(2026, 6, 12, 10, 0, 0, tzinfo=datetime.timezone.utc)
        _, _get_db = _make_summary_db(
            sev_rows=[],
            unreviewed=0,
            total=1,
            narrative_rows=[(42, "HIGH", "A port scan was detected", ts)],
        )
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs/summary")

        data = resp.json()
        assert len(data["recent_narratives"]) == 1
        n = data["recent_narratives"][0]
        assert set(n.keys()) == {"log_id", "severity_level", "xai_narrative", "timestamp"}
        assert n["log_id"] == 42
        assert n["severity_level"] == "HIGH"
        assert n["xai_narrative"] == "A port scan was detected"

    def test_summary_empty_db(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        _, _get_db = _make_summary_db(
            sev_rows=[],
            unreviewed=0,
            total=0,
            narrative_rows=[],
        )
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs/summary")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["unreviewed_count"] == 0
        assert data["recent_narratives"] == []
        assert all(v == 0 for v in data["by_severity"].values())

    def test_summary_requires_admin(self, client: TestClient):
        resp = client.get("/api/admin/security-logs/summary")
        assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Security alert email — PR #263 S1 fix: verify dashboard_link is /admin/monitoring
# ---------------------------------------------------------------------------


class TestSecurityAlertEmail:
    def test_confirm_high_threat_emails_dashboard_link_to_monitoring(self, client: TestClient):
        """S1: When a HIGH threat is confirmed, the security_alert email context
        must use /admin/monitoring as the dashboard_link — not a dead route."""
        from unittest.mock import patch, MagicMock
        import datetime

        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN

        ts = datetime.datetime(2026, 6, 12, 10, 0, 0, tzinfo=datetime.timezone.utc)
        # 3-column metadata row matching: severity_level, xai_narrative, timestamp
        _META_ROW = ("HIGH", "Suspicious port scan detected from external IP", ts)

        mock_db = MagicMock()

        # Track call order to match the exact sequence in update_security_log
        call_seq = [0]

        def _mock_execute(*args, **kwargs):
            sql_text = str(args[0]) if args else ""
            idx = call_seq[0]
            call_seq[0] += 1

            # Call 0: metadata fetch
            # SELECT severity_level, xai_narrative, timestamp FROM wims.security_threat_logs WHERE log_id = :log_id
            if idx == 0:
                mock_result = MagicMock()
                mock_result.fetchone.return_value = _META_ROW
                return mock_result

            # Call 1: UPDATE wims.security_threat_logs
            if idx == 1:
                mock_result = MagicMock()
                mock_result.rowcount = 1
                return mock_result

            # Call 2: INSERT INTO wims.breach_notifications
            if idx == 2:
                mock_result = MagicMock()
                mock_result.fetchone.return_value = [99]
                return mock_result

            # Call 3: log_system_audit INSERT (BREACH_DETECTED)
            # Call 4: COMMIT (no-op on mock)
            # Call 5: admin emails query: SELECT email FROM wims.users WHERE ...
            if "FROM wims.users" in sql_text:
                mock_result = MagicMock()
                mock_result.fetchall.return_value = [("admin@test.local",)]
                return mock_result

            mock_result = MagicMock()
            return mock_result

        mock_db.execute.side_effect = _mock_execute

        def _get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = _get_db

        with (
            patch("tasks.notifications.send_email_task.delay") as mock_send_email_delay,
            patch("api.routes.admin.security.log_system_audit"),
            patch("api.routes.admin.security.publish_security_event_sync"),
            patch("api.routes.admin.security._create_security_incident"),
        ):
            resp = client.patch(
                "/api/admin/security-logs/1",
                json={"action": "CONFIRM_THREAT"},
            )

            assert resp.status_code == 200

            # Verify send_email_task.delay was called with security_alert template
            delay_calls = mock_send_email_delay.call_args_list
            security_alert_calls = [
                c for c in delay_calls if c.kwargs.get("template_name") == "security_alert"
            ]
            assert len(security_alert_calls) == 1, (
                f"Expected 1 security_alert email call, got {len(security_alert_calls)}"
            )

            context = security_alert_calls[0].kwargs["context"]
            assert "dashboard_link" in context, "security_alert context must include dashboard_link"
            assert context["dashboard_link"].endswith("/admin/monitoring"), (
                f"dashboard_link must point to /admin/monitoring, got {context['dashboard_link']}"
            )
