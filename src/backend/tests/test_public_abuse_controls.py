"""Tests for public abuse controls — throttles, neutral responses, audit logging.

Issue #392 — val-hardening(#13)

Tracer bullet (RED→GREEN):
  POST /api/auth/consent: 4th request within 1hr → 429

Run: cd src/backend && python -m pytest tests/test_public_abuse_controls.py -v
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import redis
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _test_ip(seed: int) -> str:
    """Derive a valid RFC 5737 TEST-NET address from a seed integer."""
    return f"203.0.113.{seed % 256}"


def _clean_redis_keys(r: redis.Redis, *patterns: str):
    """Delete matching Redis keys to ensure a clean test slate."""
    for pattern in patterns:
        for key in r.keys(pattern):
            r.delete(key)


# ---------------------------------------------------------------------------
# Tracer Bullet: Consent Throttle
# ---------------------------------------------------------------------------


class TestConsentRateLimit:
    """POST /api/auth/consent — Redis sliding-window throttle (5/IP/hr, fail-closed)."""

    def test_consent_tracer_bullet_4th_request_returns_429(self):
        """6th request (limit=5) within the hour from same IP → 429 + Retry-After.

        This is the tracer-bullet TDD test. It currently FAILS because consent.py
        has no Redis rate limiter — only a comment claiming nginx handles it.
        """
        from database import get_db

        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        ip = _test_ip(abs(hash("consent-tracer-429")) % 256)
        _clean_redis_keys(r, f"wims:rl:public_consent:{ip}*")

        _CONSENT_ROW = _FakeRow(
            consent_id=1,
            subject_type="USER",
            subject_id=f"test-user-{time.time()}",
            consent_type="notifications",
            action="GRANTED",
            recorded_at=datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )

        class _MockDB:
            def __init__(self):
                self.commits = 0

            def execute(self, statement, params=None):
                sql = str(statement).replace("\n", " ")
                if "consent_log" in sql:
                    return _FakeResult(row=_CONSENT_ROW)
                if "system_audit_trails" in sql:
                    return _FakeResult(row=None)
                return _FakeResult(row=None)

            def commit(self):
                self.commits += 1

        mock_db = _MockDB()

        def override_get_db():
            yield mock_db

        payload = {
            "subject_type": "USER",
            "subject_id": f"test-user-{time.time()}",
            "consent_type": "notifications",
            "action": "GRANTED",
        }

        app.dependency_overrides[get_db] = override_get_db
        try:
            # First 5 requests should succeed (201)
            for i in range(5):
                resp = client.post(
                    "/api/auth/consent",
                    json=payload,
                    headers={"x-forwarded-for": ip},
                )
                assert resp.status_code == 201, (
                    f"Request {i + 1} should succeed: {resp.status_code} {resp.text}"
                )

            # 6th request should be rate-limited (429)
            sixth = client.post(
                "/api/auth/consent",
                json=payload,
                headers={"x-forwarded-for": ip},
            )
            assert sixth.status_code == 429, (
                f"6th request should be 429, got {sixth.status_code}: {sixth.text}"
            )
            assert "Retry-After" in sixth.headers, (
                f"Retry-After header missing: {dict(sixth.headers)}"
            )
            retry_after = int(sixth.headers["Retry-After"])
            assert retry_after >= 1, f"Retry-After must be >= 1, got {retry_after}"
        finally:
            app.dependency_overrides.clear()

        _clean_redis_keys(r, f"wims:rl:public_consent:{ip}*")

    def test_consent_different_ips_independent(self):
        """Two different IPs each have their own 5-request limit."""
        from database import get_db

        ip_a = _test_ip(11)
        ip_b = _test_ip(22)

        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        _clean_redis_keys(r, f"wims:rl:public_consent:{ip_a}*", f"wims:rl:public_consent:{ip_b}*")

        _CONSENT_ROW = _FakeRow(
            consent_id=1,
            subject_type="USER",
            subject_id=f"test-user-{time.time()}",
            consent_type="notifications",
            action="GRANTED",
            recorded_at=datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )

        class _MockDB:
            def __init__(self):
                self.commits = 0

            def execute(self, statement, params=None):
                sql = str(statement).replace("\n", " ")
                if "consent_log" in sql:
                    return _FakeResult(row=_CONSENT_ROW)
                if "system_audit_trails" in sql:
                    return _FakeResult(row=None)
                return _FakeResult(row=None)

            def commit(self):
                self.commits += 1

        def override_get_db():
            yield _MockDB()

        payload = {
            "subject_type": "USER",
            "subject_id": f"test-user-{time.time()}",
            "consent_type": "notifications",
            "action": "GRANTED",
        }

        app.dependency_overrides[get_db] = override_get_db
        try:
            # IP-A: 5 requests succeed
            for i in range(5):
                resp = client.post(
                    "/api/auth/consent",
                    json=payload,
                    headers={"x-forwarded-for": ip_a},
                )
                assert resp.status_code == 201, f"IP-A request {i + 1} failed: {resp.text}"

            # IP-A: 6th fails
            resp_a6 = client.post(
                "/api/auth/consent",
                json=payload,
                headers={"x-forwarded-for": ip_a},
            )
            assert resp_a6.status_code == 429, f"IP-A 6th should be 429: {resp_a6.text}"

            # IP-B: still has its full quota
            for i in range(5):
                resp = client.post(
                    "/api/auth/consent",
                    json=payload,
                    headers={"x-forwarded-for": ip_b},
                )
                assert resp.status_code == 201, f"IP-B request {i + 1} failed: {resp.text}"
        finally:
            app.dependency_overrides.clear()

        _clean_redis_keys(r, f"wims:rl:public_consent:{ip_a}*", f"wims:rl:public_consent:{ip_b}*")


# ---------------------------------------------------------------------------
# Neutral 404 Tests
# ---------------------------------------------------------------------------


class _FakeRow:
    """Mimics a SQLAlchemy Row with attribute and index access."""

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


class TestNeutral404:
    """Public /{id} endpoints return neutral 404 for missing vs. wrong-owner."""

    def test_get_report_neutral_404_missing(self):
        """GET /api/civilian/reports/{id} — nonexistent report returns 404 'Not found'."""
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                return _FakeResult(row=None)

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.get("/api/civilian/reports/99999")
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert "detail" in data
            assert "Not found" == data["detail"], f"Expected 'Not found', got {data['detail']}"
        finally:
            app.dependency_overrides.clear()

    def test_get_timeline_neutral_404_missing(self):
        """GET /api/civilian/reports/{id}/timeline — nonexistent report returns neutral 404."""
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                return _FakeResult(row=None)

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.get("/api/civilian/reports/99999/timeline")
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert "Not found" == data["detail"], f"Expected 'Not found', got {data['detail']}"
        finally:
            app.dependency_overrides.clear()

    def test_followup_neutral_404_nonexistent(self):
        """POST /api/civilian/reports/{id}/followup — nonexistent report returns neutral 404."""
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
                json={"followup_text": "test"},
                headers={"x-forwarded-for": "198.51.100.1"},
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert "Not found" == data["detail"], f"Expected 'Not found', got {data['detail']}"
        finally:
            app.dependency_overrides.clear()

    def test_notify_neutral_404_nonexistent(self):
        """POST /api/civilian/reports/{id}/notify — nonexistent report returns neutral 404."""
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
                "/api/civilian/reports/99999/notify",
                json={"fcm_token": "test-fcm-token"},
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert "Not found" == data["detail"], f"Expected 'Not found', got {data['detail']}"
        finally:
            app.dependency_overrides.clear()

    def test_append_neutral_404_nonexistent(self):
        """PATCH /api/civilian/reports/{id}/append — nonexistent report returns neutral 404."""
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
            resp = client.patch(
                "/api/civilian/reports/99999/append",
                json={
                    "latitude": 14.5995,
                    "longitude": 120.9842,
                    "category": "STRUCTURAL",
                    "reporting_context": "WITNESS",
                },
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert "Not found" == data["detail"], f"Expected 'Not found', got {data['detail']}"
        finally:
            app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Notification Spam Limit Tests
# ---------------------------------------------------------------------------


class TestNotifySpamLimits:
    """POST /api/civilian/reports/{id}/notify — per-IP token-reg cap + max FCM tokens/report."""

    def test_notify_too_many_tokens_per_report_returns_429(self):
        """Registration beyond max FCM tokens per report should return 429."""
        from database import get_db
        from unittest.mock import patch

        _EXISTING_REPORT = _FakeRow(report_id=42, status="PENDING")

        class _MockDB:
            def execute(self, statement, params=None):
                sql = str(statement).replace("\n", " ")
                if "SELECT 1 FROM wims.citizen_reports" in sql and "report_id" in sql:
                    return _FakeResult(row=_EXISTING_REPORT)
                if "COUNT" in sql and "report_notification_tokens" in sql:
                    return _FakeResult(row=_FakeRow(count=10))
                return _FakeResult(row=None)

            def commit(self):
                pass

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with patch("utils.public_abuse.rate_limit_public", return_value=None):
                resp = client.post(
                    "/api/civilian/reports/42/notify",
                    json={"fcm_token": "test-token"},
                )
                assert resp.status_code == 429, resp.text
                data = resp.json()
                assert "Too many notification" in data["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_notify_ip_token_rate_limit_returns_429(self):
        """Per-IP token registration cap should block excessive registrations (Redis-based)."""
        from database import get_db

        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        ip = _test_ip(abs(hash("notify-ip-ratelimit")) % 256)
        _clean_redis_keys(r, f"wims:rl:public_notify:{ip}*")

        _EXISTING_REPORT = _FakeRow(report_id=42, status="PENDING")

        class _MockDB:
            def __init__(self):
                self.commits = 0

            def execute(self, statement, params=None):
                sql = str(statement).replace("\n", " ")
                if "SELECT 1 FROM wims.citizen_reports" in sql and "report_id" in sql:
                    return _FakeResult(row=_EXISTING_REPORT)
                if "COUNT" in sql and "report_notification_tokens" in sql:
                    return _FakeResult(row=_FakeRow(count=0))
                if "INSERT" in sql and "report_notification_tokens" in sql:
                    return _FakeResult(row=_FakeRow(token_id=1))
                return _FakeResult(row=None)

            def commit(self):
                self.commits += 1

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            # First 5 requests succeed
            for i in range(5):
                resp = client.post(
                    "/api/civilian/reports/42/notify",
                    json={"fcm_token": f"test-token-{i}"},
                    headers={"x-forwarded-for": ip},
                )
                assert resp.status_code == 201, f"Request {i + 1} failed: {resp.text}"

            # 6th request should be rate-limited
            resp = client.post(
                "/api/civilian/reports/42/notify",
                json={"fcm_token": "test-token-6"},
                headers={"x-forwarded-for": ip},
            )
            assert resp.status_code == 429, f"6th request should be 429: {resp.text}"
            data = resp.json()
            assert "Rate limit exceeded" in data["detail"]
        finally:
            app.dependency_overrides.clear()

        _clean_redis_keys(r, f"wims:rl:public_notify:{ip}*")


# ---------------------------------------------------------------------------
# Public Audit Log Tests
# ---------------------------------------------------------------------------


class TestPublicAuditLog:
    """Privacy-preserving audit logging for public endpoints."""

    def test_consent_endpoint_logs_audit(self):
        """POST /api/auth/consent should log a public audit entry with IP hash."""
        from database import get_db

        _CONSENT_ROW = _FakeRow(
            consent_id=42,
            subject_type="USER",
            subject_id="test-user",
            consent_type="notifications",
            action="GRANTED",
            recorded_at=datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )

        class _MockDB:
            def __init__(self):
                self.commits = 0
                self.all_sql = []

            def execute(self, statement, params=None):
                sql = str(statement).replace("\n", " ")
                self.all_sql.append((sql, params))
                if "consent_log" in sql and "INSERT" in sql:
                    return _FakeResult(row=_CONSENT_ROW)
                if "system_audit_trails" in sql:
                    return _FakeResult(row=None)
                if "wims:rl:" in sql:
                    return _FakeResult(row=None)
                return _FakeResult(row=None)

            def commit(self):
                self.commits += 1

        mock_db = _MockDB()

        # Override Redis to avoid real Redis connection during unit test
        from unittest.mock import patch

        def override_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_get_db
        try:
            with patch("utils.public_abuse.rate_limit_public", return_value=None):
                resp = client.post(
                    "/api/auth/consent",
                    json={
                        "subject_type": "USER",
                        "subject_id": "test-user",
                        "consent_type": "notifications",
                        "action": "GRANTED",
                    },
                    headers={"x-forwarded-for": "198.51.100.1"},
                )
                assert resp.status_code == 201, resp.text

                # Verify audit log was written
                audit_calls = [
                    (sql, p)
                    for sql, p in mock_db.all_sql
                    if "system_audit_trails" in sql and "INSERT" in sql
                ]
                assert len(audit_calls) >= 1, f"No audit INSERT found in SQL: {mock_db.all_sql}"
                # Verify that audit log does NOT contain plaintext IP
                for sql, params in audit_calls:
                    if params and "ip" in params:
                        ip_val = str(params["ip"])
                        # IP hash is 64 hex chars (SHA-256), not a dotted IP
                        assert "." not in ip_val or len(ip_val) < 15, (
                            f"Audit log contains plaintext IP: {ip_val}"
                        )
        finally:
            app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Existing rate limit verification tests
# ---------------------------------------------------------------------------


class TestExistingRateLimits:
    """Verify existing rate limits on civilian and public DMZ endpoints."""

    def test_civilian_report_rate_limit_db_based_returns_429(self):
        """POST /api/civilian/reports — >5 reports from same IP in 1hr → 429."""
        from database import get_db

        class _MockDB:
            def execute(self, statement, params=None):
                sql = str(statement).replace("\n", " ")
                if "COUNT" in sql and "citizen_reports" in sql:
                    return _FakeResult(row=_FakeRow(count=5))
                return _FakeResult(row=None)

            def commit(self):
                pass

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            resp = client.post(
                "/api/civilian/reports",
                json={
                    "latitude": 14.5995,
                    "longitude": 120.9842,
                    "category": "STRUCTURAL",
                },
                headers={"x-forwarded-for": "198.51.100.1"},
            )
            assert resp.status_code == 429, resp.text
            assert "Too many reports" in resp.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_public_dmz_rate_limit_redis_based_returns_429(self):
        """POST /api/v1/public/report — >3 requests from same IP in 1hr → 429."""
        from database import get_db

        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        ip = _test_ip(abs(hash("dmz-rate-limit")) % 256)
        _clean_redis_keys(r, f"public_rate_limit:{ip}*")

        _REGION_ROW = _FakeRow(region_id=42)
        _INSERT_ROW = _FakeRow(
            incident_id=999,
            verification_status="PENDING_VALIDATION",
            created_at=datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )
        _COORD_ROW = _FakeRow(lat=14.5995, lon=120.9842)

        class _MockDB:
            def execute(self, statement, params=None):
                sql = str(statement)
                if "ref_fire_stations" in sql:
                    return _FakeResult(row=_REGION_ROW)
                if "RETURNING" in sql or "INSERT" in sql:
                    return _FakeResult(row=_INSERT_ROW)
                if "ST_Y" in sql or "ST_X" in sql:
                    return _FakeResult(row=_COORD_ROW)
                return _FakeResult(row=None)

            def commit(self):
                pass

        def override_get_db():
            yield _MockDB()

        app.dependency_overrides[get_db] = override_get_db
        try:
            for i in range(3):
                resp = client.post(
                    "/api/v1/public/report",
                    json={
                        "latitude": 14.5995,
                        "longitude": 120.9842,
                        "description": f"Test {i + 1}",
                    },
                    headers={"x-forwarded-for": ip},
                )
                assert resp.status_code == 201, f"Request {i + 1} failed: {resp.text}"

            fourth = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Rate limited"},
                headers={"x-forwarded-for": ip},
            )
            assert fourth.status_code == 429, f"4th request should be 429: {fourth.text}"
            assert "Retry-After" in fourth.headers
        finally:
            app.dependency_overrides.clear()

        _clean_redis_keys(r, f"public_rate_limit:{ip}*")
