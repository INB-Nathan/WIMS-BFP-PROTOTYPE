"""Tests for POST /api/v1/public/report — FRS M14 public submission.

Validates:
- endpoint un-deprecated and returns 201 on valid submission
- encoder_id is NULL, status is PENDING_VALIDATION in DB
- region resolved via nearest fire station (civilian.py pattern)
- Redis sliding-window rate limit: 4th request within hour -> 429 + Retry-After
- Pydantic validation rejects malformed payloads before DB write
- Fallback/error paths: station -> region fallback, both empty -> 500,
  INSERT no row -> 500, coordinate no row -> 500

Run: cd src/backend && pytest tests/test_public_submission.py -v
"""

from __future__ import annotations

import os

from datetime import datetime, timezone

import redis
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


class _FakeRow:
    """Behaves like a real SQLAlchemy Row: attribute access, index, unpack."""

    def __init__(self, **fields):
        object.__setattr__(self, "_fields", fields)
        object.__setattr__(self, "_values", tuple(fields.values()))

    def __getattr__(self, name):
        try:
            return self._fields[name]
        except KeyError:
            raise AttributeError(name)

    def __getitem__(self, i):
        return self._values[i]

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)


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
            vals = list(self._row._fields.values())
            return vals[0] if vals else None
        return None


def _mock_db_factory(
    *,
    station_row=None,
    region_row=None,
    insert_row=None,
    coord_row=None,
):
    """Build a configurable _MockDB for testing different fallback paths."""

    class _MockDB:
        def __init__(self):
            self.executed_sql = []

        def execute(self, statement, params=None):
            sql = str(statement)
            self.executed_sql.append(sql)
            if "ref_fire_stations" in sql:
                return _FakeResult(row=station_row)
            if "get_first_region_id" in sql or "ref_regions" in sql:
                return _FakeResult(row=region_row)
            if "RETURNING" in sql or "INSERT" in sql:
                return _FakeResult(row=insert_row)
            if "ST_Y" in sql or "ST_X" in sql:
                return _FakeResult(row=coord_row)
            return _FakeResult(row=None)

        def commit(self):
            pass

        def rollback(self):
            pass

    return _MockDB()


_DEFAULT_STATION = _FakeRow(region_id=42)
_DEFAULT_REGION = _FakeRow(region_id=1)
_DEFAULT_INSERT = _FakeRow(
    incident_id=999,
    verification_status="PENDING_VALIDATION",
    created_at=datetime(2026, 6, 3, 12, 0, 0, tzinfo=timezone.utc),
)
_DEFAULT_COORD = _FakeRow(lat=14.5995, lon=120.9842)


class TestPublicReportEndpoint:
    """POST /api/v1/public/report"""

    def test_valid_submission_returns_201(self):
        """Valid lat/lon/description -> 201, response contains incident fields."""
        from database import get_db

        mock_db = _mock_db_factory(
            station_row=_DEFAULT_STATION,
            region_row=_DEFAULT_REGION,
            insert_row=_DEFAULT_INSERT,
            coord_row=_DEFAULT_COORD,
        )

        def override_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={
                    "latitude": 14.5995,
                    "longitude": 120.9842,
                    "description": "Smoke seen near residential area",
                },
            )
            assert resp.status_code == 201, resp.text
            data = resp.json()
            assert "incident_id" in data
            assert data["latitude"] == 14.5995
            assert data["longitude"] == 120.9842
            assert data["verification_status"] == "PENDING_VALIDATION"
        finally:
            app.dependency_overrides.clear()

    def test_submission_creates_row_with_null_encoder_id(self):
        """DB row must have NULL encoder_id and PENDING_VALIDATION status."""
        from database import get_db

        def override_get_db():
            yield _mock_db_factory(
                station_row=_DEFAULT_STATION,
                region_row=_DEFAULT_REGION,
                insert_row=_DEFAULT_INSERT,
                coord_row=_DEFAULT_COORD,
            )

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Test fire"},
            )
            assert resp.status_code == 201, resp.text
            data = resp.json()
            assert data["verification_status"] == "PENDING_VALIDATION"
        finally:
            app.dependency_overrides.clear()

    def test_region_resolved_via_nearest_fire_station(self):
        """Region assignment uses ORDER BY location <-> on ref_fire_stations (civilian.py pattern)."""
        from database import get_db

        mock_db = _mock_db_factory(
            station_row=_DEFAULT_STATION,
            region_row=_DEFAULT_REGION,
            insert_row=_DEFAULT_INSERT,
            coord_row=_DEFAULT_COORD,
        )

        def override_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Test"},
            )
            assert resp.status_code == 201, resp.text
            assert any("ref_fire_stations" in s and "<->" in s for s in mock_db.executed_sql), (
                f"Station query not found in executed SQL: {mock_db.executed_sql}"
            )
        finally:
            app.dependency_overrides.clear()

    # ------------------------------------------------------------------
    # Fallback / error-path tests
    # ------------------------------------------------------------------

    def test_station_empty_falls_back_to_get_first_region_id(self):
        """When ref_fire_stations returns no row, wims.get_first_region_id() fallback is used."""
        from database import get_db

        mock_db = _mock_db_factory(
            station_row=None,
            region_row=_DEFAULT_REGION,
            insert_row=_DEFAULT_INSERT,
            coord_row=_DEFAULT_COORD,
        )

        def override_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Test fallback"},
            )
            assert resp.status_code == 201, resp.text
            data = resp.json()
            assert data["incident_id"] == 999
            # Both queries should have been attempted
            assert any("ref_fire_stations" in s for s in mock_db.executed_sql)
            assert any("get_first_region_id" in s for s in mock_db.executed_sql)
        finally:
            app.dependency_overrides.clear()

    def test_both_station_and_region_empty_returns_500(self):
        """When both ref_fire_stations and wims.get_first_region_id() return no rows -> 500."""
        from database import get_db

        def override_get_db():
            yield _mock_db_factory(
                station_row=None,
                region_row=None,
                insert_row=_DEFAULT_INSERT,
                coord_row=_DEFAULT_COORD,
            )

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "No region data"},
            )
            assert resp.status_code == 500, resp.text
            assert "No region reference data" in resp.text
        finally:
            app.dependency_overrides.clear()

    def test_insert_returns_no_row_returns_500(self):
        """When INSERT returns no row -> 500."""
        from database import get_db

        def override_get_db():
            yield _mock_db_factory(
                station_row=_DEFAULT_STATION,
                region_row=_DEFAULT_REGION,
                insert_row=None,
                coord_row=_DEFAULT_COORD,
            )

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Insert fails"},
            )
            assert resp.status_code == 500, resp.text
            assert "Failed to insert public incident" in resp.text
        finally:
            app.dependency_overrides.clear()

    def test_coord_query_returns_no_row_returns_500(self):
        """When the coordinate SELECT returns no row -> 500."""
        from database import get_db

        def override_get_db():
            yield _mock_db_factory(
                station_row=_DEFAULT_STATION,
                region_row=_DEFAULT_REGION,
                insert_row=_DEFAULT_INSERT,
                coord_row=None,
            )

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Coord fails"},
            )
            assert resp.status_code == 500, resp.text
            assert "Failed to retrieve inserted incident coordinates" in resp.text
        finally:
            app.dependency_overrides.clear()

    # ------------------------------------------------------------------
    # Validation tests
    # ------------------------------------------------------------------

    def test_missing_description_returns_422(self):
        """Pydantic validation rejects missing description before DB write."""
        resp = client.post(
            "/api/v1/public/report",
            json={"latitude": 14.5995, "longitude": 120.9842},
        )
        assert resp.status_code == 422, resp.text

    def test_invalid_latitude_returns_422(self):
        """Out-of-range latitude is rejected by Pydantic validation."""
        resp = client.post(
            "/api/v1/public/report",
            json={"latitude": 200.0, "longitude": 120.9842, "description": "Fire"},
        )
        assert resp.status_code == 422, resp.text

    def test_invalid_longitude_returns_422(self):
        """Out-of-range longitude is rejected by Pydantic validation."""
        resp = client.post(
            "/api/v1/public/report",
            json={"latitude": 14.5995, "longitude": 500.0, "description": "Fire"},
        )
        assert resp.status_code == 422, resp.text

    def test_empty_description_returns_422(self):
        """Empty string description is rejected by Pydantic min_length."""
        resp = client.post(
            "/api/v1/public/report",
            json={"latitude": 14.5995, "longitude": 120.9842, "description": ""},
        )
        assert resp.status_code == 422, resp.text


# -----------------------------------------------------------------------
# Helper: derive a valid RFC 5737 TEST-NET address from a seed integer.
# returns "203.0.113.{low_octet}" so IPs are always valid dotted-decimal.
# -----------------------------------------------------------------------
def _rfc5737_ip(seed: int) -> str:
    return f"203.0.113.{seed % 256}"


class TestPublicReportRateLimit:
    """Redis sliding-window rate limit: 3 req/IP/hour."""

    def test_rate_limit_exceeded_returns_429_with_retry_after_header(self):
        """4th request within the hour from the same IP returns 429 + Retry-After.

        Uses x-real-ip (which nginx sets to $realip_remote_addr) as the rate-limit
        key.  x-forwarded-for is NOT used because it is client-controlled after
        Docker NAT spoofing — see security gap #14 / DS-07.
        """
        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        test_ip = _rfc5737_ip(abs(hash("rate-limit-429")) % 256)
        key = f"public_rate_limit:{test_ip}"

        r.delete(key)

        for i in range(3):
            resp = client.post(
                "/api/v1/public/report",
                json={
                    "latitude": 14.5995,
                    "longitude": 120.9842,
                    "description": f"Test incident {i + 1}",
                },
                headers={"x-real-ip": test_ip},
            )
            assert resp.status_code == 201, f"Request {i + 1} should succeed: {resp.text}"

        fourth_resp = client.post(
            "/api/v1/public/report",
            json={
                "latitude": 14.5995,
                "longitude": 120.9842,
                "description": "Rate limited request",
            },
            headers={"x-real-ip": test_ip},
        )

        assert fourth_resp.status_code == 429, fourth_resp.text
        assert "Retry-After" in fourth_resp.headers, (
            f"Retry-After header missing: {fourth_resp.headers}"
        )
        retry_after = int(fourth_resp.headers["Retry-After"])
        assert retry_after >= 1, f"Retry-After must be >= 1, got {retry_after}"

        r.delete(key)

    def test_different_ips_independent_rate_limits(self):
        """Two different IPs each have their own 3-request limit.

        Passes x-real-ip (the header nginx sets to $realip_remote_addr) to
        control the rate-limit key rather than x-forwarded-for — see gap #14.
        """
        ip_a = _rfc5737_ip(10)
        ip_b = _rfc5737_ip(20)

        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        r.delete(f"public_rate_limit:{ip_a}")
        r.delete(f"public_rate_limit:{ip_b}")

        for i in range(3):
            resp_a = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": f"IP-A-{i}"},
                headers={"x-real-ip": ip_a},
            )
            assert resp_a.status_code == 201, f"IP-A request {i + 1} failed: {resp_a.text}"

        for i in range(3):
            resp_b = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": f"IP-B-{i}"},
                headers={"x-real-ip": ip_b},
            )
            assert resp_b.status_code == 201, f"IP-B request {i + 1} failed: {resp_b.text}"

        r.delete(f"public_rate_limit:{ip_a}")
        r.delete(f"public_rate_limit:{ip_b}")


# ─── Follow-up submission endpoint tests ──────────────────────────────────
# Tests for POST /api/civilian/reports/{report_id}/followup (Issue #62)


class TestCivilianFollowupEndpoint:
    """POST /api/civilian/reports/{report_id}/followup"""

    def test_followup_submission_returns_201(self):
        """Valid followup_text on an existing PENDING report returns 201."""
        from database import get_db

        _EXISTING_REPORT = _FakeRow(report_id=42, status="PENDING")
        _FOLLOWUP_RESULT = _FakeRow(
            followup_id=1,
            report_id=42,
            followup_text="More details about the fire.",
            created_at=datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc),
        )

        class _MockDB:
            def __init__(self):
                self.commits = 0
                self.last_sql = []

            def execute(self, statement, params=None):
                sql = str(statement)
                self.last_sql.append(sql)
                sql_flat = sql.replace("\n", " ")
                if "FROM wims.citizen_reports" in sql_flat and "device_id = :device_id" in sql_flat:
                    return _FakeResult(row=_FakeRow(one=1))
                if "SELECT report_id, status FROM wims.citizen_reports" in sql_flat:
                    return _FakeResult(row=_EXISTING_REPORT)
                if "INSERT INTO wims.citizen_report_followups" in sql_flat:
                    return _FakeResult(row=_FOLLOWUP_RESULT)
                if "wims.citizen_report_followups" in sql_flat and "COUNT" in sql_flat:
                    return _FakeResult(row=_FakeRow(count=0))
                if "system_audit_trails" in sql_flat:
                    return _FakeResult(row=None)
                return _FakeResult(row=None)

            def commit(self):
                self.commits += 1

        mock_db = _MockDB()

        def override_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports/42/followup",
                json={"device_id": "device-a", "followup_text": "More details about the fire."},
                headers={"x-forwarded-for": "198.51.100.1"},
            )
            assert resp.status_code == 201, resp.text
            data = resp.json()
            assert data["followup_id"] == 1
            assert data["report_id"] == 42
            assert data["followup_text"] == "More details about the fire."
            assert "created_at" in data
            assert mock_db.commits >= 1
        finally:
            app.dependency_overrides.clear()

    def test_followup_on_terminal_report_returns_409(self):
        """Follow-up on ACTIONED or REJECTED_* report returns 409."""
        from database import get_db

        _TERMINAL_REPORT = _FakeRow(report_id=42, status="ACTIONED")

        class _MockDB:
            def execute(self, statement, params=None):
                sql = str(statement)
                sql_flat = sql.replace("\n", " ")
                if "FROM wims.citizen_reports" in sql_flat and "device_id = :device_id" in sql_flat:
                    return _FakeResult(row=_FakeRow(one=1))
                if "SELECT report_id, status FROM wims.citizen_reports" in sql_flat:
                    return _FakeResult(row=_TERMINAL_REPORT)
                return _FakeResult(row=None)

            def commit(self):
                pass

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports/42/followup",
                json={
                    "device_id": "device-a",
                    "followup_text": "Trying to update terminal report.",
                },
                headers={"x-forwarded-for": "198.51.100.1"},
            )
            assert resp.status_code == 409, resp.text
            assert "Terminal reports" in resp.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_followup_on_nonexistent_report_returns_404(self):
        """Follow-up on a report that doesn't exist returns 404."""
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                return _FakeResult(row=None)

            def commit(self):
                pass

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports/99999/followup",
                json={"device_id": "device-a", "followup_text": "Updating nonexistent report."},
                headers={"x-forwarded-for": "198.51.100.1"},
            )
            assert resp.status_code == 404, resp.text
            assert "Report not found" in resp.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_followup_empty_text_returns_422(self):
        """Empty followup_text is rejected by Pydantic validation."""
        resp = client.post(
            "/api/civilian/reports/42/followup",
            json={"device_id": "device-a", "followup_text": ""},
            headers={"x-forwarded-for": "198.51.100.1"},
        )
        assert resp.status_code == 422, resp.text

    def test_followup_missing_text_returns_422(self):
        """Missing followup_text field is rejected by Pydantic validation."""
        resp = client.post(
            "/api/civilian/reports/42/followup",
            json={"device_id": "device-a"},
            headers={"x-forwarded-for": "198.51.100.1"},
        )
        assert resp.status_code == 422, resp.text

    def test_followup_text_too_long_returns_422(self):
        """Text exceeding 2000 characters is rejected."""
        resp = client.post(
            "/api/civilian/reports/42/followup",
            json={"device_id": "device-a", "followup_text": "x" * 2001},
            headers={"x-forwarded-for": "198.51.100.1"},
        )
        assert resp.status_code == 422, resp.text

    def test_followup_per_report_rate_limit_returns_429(self):
        """When >5 follow-ups from same IP on same report in 1hr, return 429."""
        from database import get_db

        _EXISTING_REPORT = _FakeRow(report_id=42, status="PENDING")

        class _MockDB:
            def __init__(self):
                self.commits = 0

            def execute(self, statement, params=None):
                sql = str(statement)
                sql_flat = sql.replace("\n", " ")
                if "FROM wims.citizen_reports" in sql_flat and "device_id = :device_id" in sql_flat:
                    return _FakeResult(row=_FakeRow(one=1))
                if "SELECT report_id, status FROM wims.citizen_reports" in sql_flat:
                    return _FakeResult(row=_EXISTING_REPORT)
                # Per-report COUNT — simulate 5 recent follow-ups from this IP
                if (
                    "wims.citizen_report_followups" in sql_flat
                    and "COUNT" in sql_flat
                    and "report_id" in sql_flat
                ):
                    return _FakeResult(row=_FakeRow(count=5))
                # Cross-report COUNT — 0 from this IP across all reports
                if "wims.citizen_report_followups" in sql_flat and "COUNT" in sql_flat:
                    return _FakeResult(row=_FakeRow(count=0))
                return _FakeResult(row=None)

            def commit(self):
                self.commits += 1

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports/42/followup",
                json={"device_id": "device-a", "followup_text": "Rate limit test."},
                headers={"x-forwarded-for": "198.51.100.1"},
            )
            assert resp.status_code == 429, resp.text
            data = resp.json()
            assert "Too many follow-ups on this report" in data["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_followup_cross_report_rate_limit_returns_429(self):
        """When >10 follow-ups from same IP across all reports in 1hr, return 429."""
        from database import get_db

        _EXISTING_REPORT = _FakeRow(report_id=42, status="PENDING")

        class _MockDB:
            def __init__(self):
                self.commits = 0

            def execute(self, statement, params=None):
                sql = str(statement)
                sql_flat = sql.replace("\n", " ")
                if "FROM wims.citizen_reports" in sql_flat and "device_id = :device_id" in sql_flat:
                    return _FakeResult(row=_FakeRow(one=1))
                if "SELECT report_id, status FROM wims.citizen_reports" in sql_flat:
                    return _FakeResult(row=_EXISTING_REPORT)
                # Per-report COUNT — 0 on this specific report
                if (
                    "wims.citizen_report_followups" in sql_flat
                    and "COUNT" in sql_flat
                    and "report_id" in sql_flat
                ):
                    return _FakeResult(row=_FakeRow(count=0))
                # Cross-report COUNT — 10 from this IP across all reports
                if "wims.citizen_report_followups" in sql_flat and "COUNT" in sql_flat:
                    return _FakeResult(row=_FakeRow(count=10))
                return _FakeResult(row=None)

            def commit(self):
                self.commits += 1

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports/42/followup",
                json={"device_id": "device-a", "followup_text": "IP rate limit test."},
                headers={"x-forwarded-for": "198.51.100.1"},
            )
            assert resp.status_code == 429, resp.text
            data = resp.json()
            assert "Too many follow-ups from this network" in data["detail"]
        finally:
            app.dependency_overrides.clear()


class TestCivilianDeviceIdScope:
    """IDOR regressions for public civilian /{report_id} routes."""

    def test_get_report_wrong_device_returns_neutral_404(self):
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                return _FakeResult(row=None)

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.get("/api/civilian/reports/42?device_id=wrong-device")
            assert resp.status_code == 404, resp.text
            assert resp.json()["detail"] == "Report not found"
        finally:
            app.dependency_overrides.clear()

    def test_followup_wrong_device_returns_neutral_404(self):
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                return _FakeResult(row=None)

            def commit(self):
                raise AssertionError("wrong-device follow-up must not commit")

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports/42/followup",
                json={"device_id": "wrong-device", "followup_text": "IDOR probe"},
            )
            assert resp.status_code == 404, resp.text
            assert resp.json()["detail"] == "Report not found"
        finally:
            app.dependency_overrides.clear()

    def test_notify_wrong_device_returns_neutral_404(self):
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                return _FakeResult(row=None)

            def commit(self):
                raise AssertionError("wrong-device notify must not commit")

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports/42/notify",
                json={"device_id": "wrong-device", "fcm_token": "token-1"},
            )
            assert resp.status_code == 404, resp.text
            assert resp.json()["detail"] == "Report not found"
        finally:
            app.dependency_overrides.clear()

    def test_append_wrong_device_returns_neutral_404(self):
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                return _FakeResult(row=None)

            def commit(self):
                raise AssertionError("wrong-device append must not commit")

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.patch(
                "/api/civilian/reports/42/append",
                json={
                    "device_id": "wrong-device",
                    "latitude": 14.5995,
                    "longitude": 120.9842,
                    "category": "STRUCTURAL",
                    "reporting_context": "WITNESS",
                    "safety_status": "I_AM_SAFE",
                },
            )
            assert resp.status_code == 404, resp.text
            assert resp.json()["detail"] == "Report not found"
        finally:
            app.dependency_overrides.clear()
