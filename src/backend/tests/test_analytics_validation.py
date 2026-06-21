"""Tests for analytics filters/export validation + CSV formula injection escaping.

Issue #396 — val-hardening(#9)

Run: cd src/backend && python -m pytest tests/test_analytics_validation.py -v
"""

from __future__ import annotations

import csv
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

    # --- B1: numeric / non-string input (type contract) ---

    def test_int_input_coerced_no_crash(self):
        """B1: escape_csv_cell(42) must not crash; coerces via str()."""
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell(42) == "42"
        assert escape_csv_cell(0) == "0"
        # -5 starts with '-' (a formula trigger) → escaped with leading quote
        assert escape_csv_cell(-5) == "'-5"

    def test_float_input_coerced_no_crash(self):
        """B1: escape_csv_cell(3.14) must not crash; coerces via str()."""
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell(3.14) == "3.14"
        assert escape_csv_cell(0.0) == "0.0"

    def test_none_input_coerced_no_crash(self):
        """B1: escape_csv_cell(None) must not crash; str(None) → 'None'."""
        from utils.analytics_validation import escape_csv_cell

        result = escape_csv_cell(None)
        # str(None) == "None" — not a formula trigger, passes through
        assert result == "None"

    # --- B2: leading whitespace bypass ---

    def test_leading_whitespace_equals_escaped(self):
        """B2: ' =CMD' with leading space must be escaped."""
        from utils.analytics_validation import escape_csv_cell

        # Leading space preserved; quote at position 0 neutralizes formula
        assert escape_csv_cell(" =cmd") == "' =cmd"

    def test_leading_whitespace_plus_escaped(self):
        """B2: '  +1+2' with leading spaces must be escaped."""
        from utils.analytics_validation import escape_csv_cell

        # Leading spaces preserved; quote at position 0 neutralizes formula
        assert escape_csv_cell("  +1+2") == "'  +1+2"

    def test_leading_whitespace_minus_escaped(self):
        """B2: '\t-1+2' with leading tab must be escaped."""
        from utils.analytics_validation import escape_csv_cell

        assert escape_csv_cell("\t-1+2") == "'-1+2"

    def test_leading_whitespace_at_escaped(self):
        """B2: leading spaces before @ function call must be escaped."""
        from utils.analytics_validation import escape_csv_cell

        # Leading spaces preserved; quote at position 0 neutralizes formula
        assert escape_csv_cell("   @SUM(A1:A10)") == "'   @SUM(A1:A10)"


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
# _write_afor_csv — end-to-end CSV writer used by the AFOR export task
# ---------------------------------------------------------------------------


class TestWriteAforCsv:
    """Tests for the AFOR CSV writer in tasks/exports.py.

    Covers B1 (numeric dict values must not crash) and the escaped-value
    contract applied at the cell level.
    """

    def test_write_afor_csv_with_numeric_data_does_not_crash_and_contains_escaped_values(
        self, tmp_path
    ):
        """B1: numeric dict values must not crash _write_afor_csv and escape rules apply."""
        from tasks.exports import _write_afor_csv

        csv_path = tmp_path / "afor.csv"
        data = {
            "bfp_fire_trucks": 5,  # numeric — must not crash
            "region_name": "=NCR",  # formula trigger — must be escaped to "'=NCR"
        }

        # Must not raise — numeric values get coerced via str() in escape_csv_cell
        _write_afor_csv(str(csv_path), data)

        assert csv_path.exists(), "CSV file should be created"
        assert csv_path.stat().st_size > 0, "CSV file should be non-empty"

        with open(csv_path, "r", encoding="utf-8", newline="") as f:
            rows = list(csv.reader(f))

        # Locate the "BFP Fire Trucks" row and assert numeric value rendered as "5"
        bfp_row = next(
            (r for r in rows if len(r) == 2 and r[0] == "BFP Fire Trucks"),
            None,
        )
        assert bfp_row is not None, "BFP Fire Trucks row should be present"
        assert bfp_row[1] == "5", f"Expected '5' as value, got {bfp_row[1]!r}"

        # Locate the "Region" row and assert the formula trigger was escaped
        region_row = next(
            (r for r in rows if len(r) == 2 and r[0] == "Region"),
            None,
        )
        assert region_row is not None, "Region row should be present"
        assert region_row[1] == "'=NCR", (
            f"Expected formula trigger to be escaped to ''=NCR', got {region_row[1]!r}"
        )


# ---------------------------------------------------------------------------
# Integration tests — analytics endpoint validation
# ---------------------------------------------------------------------------


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
            # Strengthened: assert exact 200 + task_id in JSON response
            assert resp.status_code == 200, (
                f"Allowed columns should return 200, got {resp.status_code}: {resp.text}"
            )
            body = resp.json()
            assert "task_id" in body, f"Response JSON should include task_id, got: {body}"
            assert body["task_id"] == "mock-task-id-123", (
                f"Expected task_id 'mock-task-id-123', got {body['task_id']!r}"
            )
        finally:
            app.dependency_overrides.clear()


class TestExportDateValidation:
    """POST /api/analytics/export/* — date validation on filters dict (PR #429 blocker B3)."""

    @pytest.mark.parametrize(
        "route",
        ["/api/analytics/export/csv", "/api/analytics/export/pdf", "/api/analytics/export/excel"],
    )
    def test_export_invalid_start_date_returns_422(self, route):
        """Non-ISO start_date in filters → 422 on all three export routes."""
        from auth import get_analyst_or_admin

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        app.dependency_overrides[get_analyst_or_admin] = override_user
        try:
            resp = client.post(
                route,
                json={
                    "filters": {"start_date": "not-a-date"},
                    "columns": ["incident_id"],
                },
            )
            assert resp.status_code == 422, (
                f"Expected 422 for invalid start_date on {route}, got {resp.status_code}: {resp.text}"
            )
            assert "ISO 8601" in resp.text or "start_date" in resp.text, (
                f"Error should mention date format: {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.parametrize(
        "route",
        ["/api/analytics/export/csv", "/api/analytics/export/pdf", "/api/analytics/export/excel"],
    )
    def test_export_inverted_date_range_returns_422(self, route):
        """start_date > end_date in filters → 422 on all three export routes."""
        from auth import get_analyst_or_admin

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        app.dependency_overrides[get_analyst_or_admin] = override_user
        try:
            resp = client.post(
                route,
                json={
                    "filters": {"start_date": "2024-12-31", "end_date": "2024-01-01"},
                    "columns": ["incident_id"],
                },
            )
            assert resp.status_code == 422, (
                f"Expected 422 for inverted range on {route}, got {resp.status_code}: {resp.text}"
            )
            assert "must be before" in resp.text or "start_date" in resp.text, (
                f"Error should mention date range: {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.parametrize(
        "route",
        ["/api/analytics/export/csv", "/api/analytics/export/pdf", "/api/analytics/export/excel"],
    )
    def test_export_valid_dates_pass_validation(self, route):
        """Valid ISO dates (or absent) in filters should pass validation (not 422)."""
        from auth import get_analyst_or_admin

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        app.dependency_overrides[get_analyst_or_admin] = override_user
        try:
            mock_task = MagicMock()
            mock_task.delay.return_value = MagicMock(id="mock-task-id-123")
            task_patch_path = {
                "/api/analytics/export/csv": "api.routes.analytics.export_incidents_csv_task",
                "/api/analytics/export/pdf": "api.routes.analytics.export_incidents_pdf_task",
                "/api/analytics/export/excel": "api.routes.analytics.export_incidents_excel_task",
            }[route]
            with patch(task_patch_path, mock_task):
                resp = client.post(
                    route,
                    json={
                        "filters": {"start_date": "2024-01-01", "end_date": "2024-06-30"},
                        "columns": ["incident_id"],
                    },
                )
            assert resp.status_code != 422, (
                f"Valid dates should not return 422 on {route}: {resp.status_code} {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()

    def test_export_no_dates_in_filters_passes(self):
        """Empty filters dict (no dates) should pass validation."""
        from auth import get_analyst_or_admin

        _USER = {"user_id": "test-analyst-uuid"}

        def override_user():
            return _USER

        app.dependency_overrides[get_analyst_or_admin] = override_user
        try:
            mock_task = MagicMock()
            mock_task.delay.return_value = MagicMock(id="mock-task-id-123")
            with patch("api.routes.analytics.export_incidents_csv_task", mock_task):
                resp = client.post(
                    "/api/analytics/export/csv",
                    json={"filters": {}, "columns": ["incident_id"]},
                )
            assert resp.status_code != 422, (
                f"Empty filters should not return 422: {resp.status_code} {resp.text}"
            )
        finally:
            app.dependency_overrides.clear()
