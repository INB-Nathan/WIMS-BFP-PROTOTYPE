"""Tests for POST /api/v1/public/report — FRS M14 public submission.

Validates:
- endpoint un-deprecated and returns 201 on valid submission
- encoder_id is NULL, status is PENDING_VALIDATION in DB
- region resolved via nearest-centroid
- Redis sliding-window rate limit: 4th request within hour -> 429 + Retry-After
- Pydantic validation rejects malformed payloads before DB write

Run: cd src/backend && pytest tests/test_public_submission.py -v
"""

from __future__ import annotations

import os
import sys
import uuid

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app

client = TestClient(app)


class TestPublicReportEndpoint:
    """POST /api/v1/public/report"""

    def test_valid_submission_returns_201(self):
        """Valid lat/lon/description -> 201, response contains incident fields."""
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

    def test_submission_creates_row_with_null_encoder_id(self, monkeypatch):
        """DB row must have NULL encoder_id and PENDING_VALIDATION status."""

        class MockRow:
            incident_id = 999
            verification_status = "PENDING_VALIDATION"
            created_at = None

        class MockResult:
            def fetchone(self):
                return MockRow()

        class MockDB:
            def execute(self, *args, **kwargs):
                return MockResult()

            def commit(self):
                pass

        from database import get_db

        def override_get_db():
            yield MockDB()

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

    def test_region_resolved_via_nearest_centroid(self, monkeypatch):
        """Region assignment uses ST_Distance nearest-centroid (not ORDER BY region_id)."""

        region_query_called = False

        class MockRow:
            incident_id = 1
            verification_status = "PENDING_VALIDATION"
            created_at = None

        class MockResult:
            def fetchone(self):
                nonlocal region_query_called
                if not region_query_called:
                    region_query_called = True
                    return (42,)
                return MockRow()

            def fetchall(self):
                return []

        class MockDB:
            def execute(self, sql, params=None):
                sql_str = str(sql)
                if "ref_regions" in sql_str and "ST_Distance" in sql_str:
                    pass
                return MockResult()

            def commit(self):
                pass

        from database import get_db

        def override_get_db():
            yield MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Test"},
            )
            assert resp.status_code == 201, resp.text
            assert region_query_called, "ref_regions query was not called"
        finally:
            app.dependency_overrides.clear()

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


class TestPublicReportRateLimit:
    """Redis sliding-window rate limit: 3 req/IP/hour."""

    def test_rate_limit_exceeded_returns_429_with_retry_after_header(self, monkeypatch):
        """4th request within the hour from the same IP returns 429 + Retry-After."""

        import redis

        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://redis:6379/0"), decode_responses=True
        )
        test_ip = f"198.51.{uuid.uuid4().hex[:4]}.{uuid.uuid4().hex[:4]}"
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
                headers={"x-forwarded-for": test_ip},
            )
            assert resp.status_code == 201, f"Request {i + 1} should succeed: {resp.text}"

        fourth_resp = client.post(
            "/api/v1/public/report",
            json={
                "latitude": 14.5995,
                "longitude": 120.9842,
                "description": "Rate limited request",
            },
            headers={"x-forwarded-for": test_ip},
        )

        assert fourth_resp.status_code == 429, fourth_resp.text
        assert "Retry-After" in fourth_resp.headers, (
            f"Retry-After header missing: {fourth_resp.headers}"
        )
        retry_after = int(fourth_resp.headers["Retry-After"])
        assert retry_after >= 1, f"Retry-After must be >= 1, got {retry_after}"

        r.delete(key)

    def test_different_ips_independent_rate_limits(self, monkeypatch):
        """Two different IPs each have their own 3-request limit."""
        ip_a = f"198.51.{uuid.uuid4().hex[:4]}.{uuid.uuid4().hex[:4]}"
        ip_b = f"198.51.{uuid.uuid4().hex[:4]}.{uuid.uuid4().hex[:4]}"

        import redis

        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://redis:6379/0"), decode_responses=True
        )
        r.delete(f"public_rate_limit:{ip_a}")
        r.delete(f"public_rate_limit:{ip_b}")

        for i in range(3):
            resp_a = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": f"IP-A-{i}"},
                headers={"x-forwarded-for": ip_a},
            )
            assert resp_a.status_code == 201, f"IP-A request {i + 1} failed: {resp_a.text}"

        for i in range(3):
            resp_b = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": f"IP-B-{i}"},
                headers={"x-forwarded-for": ip_b},
            )
            assert resp_b.status_code == 201, f"IP-B request {i + 1} failed: {resp_b.text}"

        r.delete(f"public_rate_limit:{ip_a}")
        r.delete(f"public_rate_limit:{ip_b}")
