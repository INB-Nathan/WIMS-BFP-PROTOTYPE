"""Tests for analytics filters/export validation + CSV formula injection escaping.

Issue #396 — val-hardening(#9)

Run: cd src/backend && python -m pytest tests/test_analytics_validation.py -v
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

from main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Shared helpers — unit tests
# ---------------------------------------------------------------------------


class TestEscapeCsvCell:
    """Unit tests for _escape_csv_cell in utils/analytics_validation.py."""

    def test_normal_text_passes_through(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("hello") == "hello"
        assert escape_csv_cell("123 Main St") == "123 Main St"

    def test_equals_prefix_escaped(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("=cmd|' /C calc'!A0") == "'=cmd|' /C calc'!A0"
        assert escape_csv_cell("=1+2") == "'=1+2"

    def test_plus_prefix_escaped(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("+1+2") == "'+1+2"

    def test_minus_prefix_escaped(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("-1+2") == "'-1+2"

    def test_at_prefix_escaped(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("@SUM(A1:A10)") == "'@SUM(A1:A10)"

    def test_tab_stripped(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("hello\tworld") == "helloworld"

    def test_cr_stripped(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("hello\rworld") == "helloworld"

    def test_newline_stripped(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("hello\nworld") == "helloworld"

    def test_empty_string_unchanged(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("") == ""

    def test_nested_formula_chars_not_escaped(self):
        """Only first character matters for formula injection."""
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("abc=sum") == "abc=sum"
        assert escape_csv_cell("abc+sum") == "abc+sum"

    def test_literal_number_unchanged(self):
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("42") == "42"
        assert escape_csv_cell("0") == "0"


class TestValidateIsoDate:
    """Unit tests for validate_iso_date."""

    def test_valid_iso_date_passes(self):
        from utils.analytics_validation import validate_iso_date

        validate_iso_date("2024-01-15", "start_date")  # should not raise

    def test_none_passes(self):
        from utils.analytics_validation import validate_iso_date

        validate_iso_date(None, "start_date")  # should not raise

    def test_non_iso_format_raises_422(self):
        from utils.analytics_validation import validate_iso_date

        with pytest.raises(Exception) as exc:
            validate_iso_date("not-a-date", "start_date")
        assert "422" in str(exc.value) or "ISO 8601" in str(exc.value)

    def test_invalid_calendar_date_raises_422(self):
        from utils.analytics_validation import validate_iso_date

        with pytest.raises(Exception) as exc:
            validate_iso_date("2024-02-30", "end_date")
        assert "422" in str(exc.value) or "not a valid calendar date" in str(exc.value)

    def test_partial_date_raises_422(self):
        from utils.analytics_validation import validate_iso_date

        with pytest.raises(Exception) as exc:
            validate_iso_date("2024-01", "start_date")
        assert "422" in str(exc.value) or "ISO 8601" in str(exc.value)


class TestValidateDateRange:
    """Unit tests for validate_date_range."""

    def test_valid_range_passes(self):
        from utils.analytics_validation import validate_date_range

        validate_date_range("2024-01-01", "2024-01-15")  # should not raise

    def test_equal_dates_passes(self):
        from utils.analytics_validation import validate_date_range

        validate_date_range("2024-01-15", "2024-01-15")  # should not raise

    def test_inverted_range_raises_422(self):
        from utils.analytics_validation import validate_date_range

        with pytest.raises(Exception) as exc:
            validate_date_range("2024-12-31", "2024-01-01")
        assert "422" in str(exc.value) or "must be before" in str(exc.value)

    def test_none_values_pass(self):
        from utils.analytics_validation import validate_date_range

        validate_date_range(None, "2024-01-15")  # should not raise
        validate_date_range("2024-01-15", None)  # should not raise
        validate_date_range(None, None)  # should not raise


# ---------------------------------------------------------------------------
# Integration tests — analytics endpoint validation
# ---------------------------------------------------------------------------


class _FakeRow:
    def __init__(self, **fields):
        object.__setattr__(self, "_fields", fields)

    def __getattr__(self, name):
        try:
            return self._fields[name]
        except KeyError:
            raise AttributeError(name)

    def __getitem__(self, i):
        return list(self._fields.values())[i]

    def __len__(self):
        return len(self._fields)


class _FakeResult:
    def __init__(self, row=None, rows=None):
        self._row = row
        self._rows = rows or []

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows

    def scalar(self):
        if self._row and hasattr(self._row, "_fields"):
            return list(self._row._fields.values())[0] if self._row._fields else None
        return None

    def mappings(self):
        return self


class TestAnalyticsDateValidation:
    """GET /api/analytics/* — ISO date validation on query params."""

    def test_heatmap_invalid_start_date_returns_422(self):
        """Tracer bullet: GET /api/analytics/heatmap?start_date=not-a-date → 422."""
        from auth import get_analyst_or_admin, get_db_with_rls

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        def override_db():
            yield None

        app.dependency_overrides[get_analyst_or_admin] = override_user
        app.dependency_overrides[get_db_with_rls] = override_db
        try:
            resp = client.get("/api/analytics/heatmap?start_date=not-a-date")
            assert resp.status_code == 422, (
                f"Expected 422 for invalid date, got {resp.status_code}: {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()

    def test_heatmap_valid_iso_date_passes_validation(self):
        """Valid ISO date should pass validation (may fail on actual DB query)."""
        from auth import get_analyst_or_admin, get_db_with_rls

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        def override_db():
            yield None

        app.dependency_overrides[get_analyst_or_admin] = override_user
        app.dependency_overrides[get_db_with_rls] = override_db
        try:
            with patch("api.routes.analytics.get_heatmap_points", return_value=[]):
                resp = client.get("/api/analytics/heatmap?start_date=2024-01-15")
            # Should NOT be 422 — the date format is valid
            assert resp.status_code != 422, (
                f"Valid date should not return 422: {resp.status_code} {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()

    def test_trends_invalid_start_date_returns_422(self):
        """GET /api/analytics/trends?start_date=bad-date → 422."""
        from auth import get_analyst_or_admin, get_db_with_rls

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        def override_db():
            yield None

        app.dependency_overrides[get_analyst_or_admin] = override_user
        app.dependency_overrides[get_db_with_rls] = override_db
        try:
            resp = client.get("/api/analytics/trends?start_date=not-iso")
            assert resp.status_code == 422, resp.text
        finally:
            app.dependency_overrides.clear()

    def test_comparative_invalid_dates_returns_422(self):
        """GET /api/analytics/comparative with required date params → 422 for invalid."""
        from auth import get_analyst_or_admin, get_db_with_rls

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        def override_db():
            yield None

        app.dependency_overrides[get_analyst_or_admin] = override_user
        app.dependency_overrides[get_db_with_rls] = override_db
        try:
            resp = client.get(
                "/api/analytics/comparative"
                "?range_a_start=bad&range_a_end=2024-01-01"
                "&range_b_start=2024-01-01&range_b_end=2024-01-01"
            )
            assert resp.status_code == 422, resp.text
        finally:
            app.dependency_overrides.clear()

    def test_inverted_date_range_returns_422(self):
        """start_date > end_date → 422."""
        from auth import get_analyst_or_admin, get_db_with_rls

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        def override_db():
            yield None

        app.dependency_overrides[get_analyst_or_admin] = override_user
        app.dependency_overrides[get_db_with_rls] = override_db
        try:
            resp = client.get("/api/analytics/heatmap?start_date=2024-12-31&end_date=2024-01-01")
            assert resp.status_code == 422, (
                f"Expected 422 for inverted range, got {resp.status_code}: {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()


class TestExportColumnValidation:
    """POST /api/analytics/export/* — column allowlist validation."""

    def test_export_csv_with_invalid_column_returns_422(self):
        """POST /api/analytics/export/csv with non-allowed column → 422."""
        from auth import get_analyst_or_admin

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        app.dependency_overrides[get_analyst_or_admin] = override_user
        try:
            resp = client.post(
                "/api/analytics/export/csv",
                json={
                    "filters": {},
                    "columns": ["incident_id", "malicious_column"],
                },
            )
            assert resp.status_code == 422, (
                f"Expected 422 for invalid column, got {resp.status_code}: {resp.text}"
            )
            assert "column" in resp.text.lower() or "allow" in resp.text.lower(), (
                f"Error should mention column validation: {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()

    def test_export_csv_with_all_allowed_columns_passes(self):
        """All columns in ALLOWED_EXPORT_COLUMNS should pass validation."""
        from auth import get_analyst_or_admin
        from tasks.exports import ALLOWED_EXPORT_COLUMNS

        _USER = {"user_id": "test-analyst-uuid"}
        allowed = list(ALLOWED_EXPORT_COLUMNS)[:5]

        def override_user():
            return _USER

        app.dependency_overrides[get_analyst_or_admin] = override_user
        try:
            mock_task = MagicMock()
            mock_task.delay.return_value = MagicMock(id="mock-task-id-123")
            with patch("api.routes.analytics.export_incidents_csv_task", mock_task):
                resp = client.post(
                    "/api/analytics/export/csv",
                    json={"filters": {}, "columns": allowed},
                )
            # Should not be 422 — may be 200/202 depending on queue stub
            assert resp.status_code != 422, (
                f"Allowed columns should not return 422: {resp.status_code} {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()
