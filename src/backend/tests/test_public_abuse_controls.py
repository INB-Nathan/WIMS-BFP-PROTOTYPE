"""Tests for public abuse controls — throttles, neutral responses, audit logging.

Issue #392 — val-hardening(#13)

Coverage:
  - POST /api/auth/consent: sliding-window throttle (5/IP/hr, fail-closed)
  - GET/PATCH/POST /api/civilian/reports/{id}/*: neutral 404 for missing/wrong-owner
  - POST /api/civilian/reports/{id}/notify: per-IP token-reg cap, max FCM tokens/report
  - POST /api/auth/consent: privacy-preserving audit logging
  - POST /api/civilian/reports: DB-based rate limit (5/IP/hr)
  - POST /api/v1/public/report: Redis-based rate limit (3/IP/hr)

Run: cd src/backend && python -m pytest tests/test_public_abuse_controls.py -v
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import pytest

import redis
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _mock_turnstile():
    """Stub verify_turnstile for all tests in this module.

    Individual CAPTCHA tests in test_captcha.py exercise the real
    verification logic; these integration tests should not make
    outbound HTTP calls to Cloudflare.
    """
    with patch("api.routes.civilian.verify_turnstile", return_value=True):
        yield


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

    def test_consent_tracer_bullet_6th_request_returns_429(self):
        """6th request (limit=5) within the hour from same IP → 429 + Retry-After.

        Verifies the Redis sliding-window throttle. The loop fires 5 successful
        requests, then asserts the 6th hits the limit and is rejected with 429
        + Retry-After.
        """
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

        mock_db = _MockDB(
            mappings=[("consent_log", _CONSENT_ROW)],
        )

        payload = {
            "subject_type": "USER",
            "subject_id": f"test-user-{time.time()}",
            "consent_type": "notifications",
            "action": "GRANTED",
        }

        clear = _override_db_with(mock_db)
        try:
            # First 5 requests should succeed (201)
            for i in range(5):
                resp = client.post(
                    "/api/auth/consent",
                    json=payload,
                    headers={"x-real-ip": ip},
                )
                assert resp.status_code == 201, (
                    f"Request {i + 1} should succeed: {resp.status_code} {resp.text}"
                )

            # 6th request should be rate-limited (429)
            sixth = client.post(
                "/api/auth/consent",
                json=payload,
                headers={"x-real-ip": ip},
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
            clear()

        _clean_redis_keys(r, f"wims:rl:public_consent:{ip}*")

    def test_consent_different_ips_independent(self):
        """Two different IPs each have their own 5-request limit."""
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

        mock_db = _MockDB(
            mappings=[("consent_log", _CONSENT_ROW)],
        )

        payload = {
            "subject_type": "USER",
            "subject_id": f"test-user-{time.time()}",
            "consent_type": "notifications",
            "action": "GRANTED",
        }

        clear = _override_db_with(mock_db)
        try:
            # IP-A: 5 requests succeed
            for i in range(5):
                resp = client.post(
                    "/api/auth/consent",
                    json=payload,
                    headers={"x-real-ip": ip_a},
                )
                assert resp.status_code == 201, f"IP-A request {i + 1} failed: {resp.text}"

            # IP-A: 6th fails
            resp_a6 = client.post(
                "/api/auth/consent",
                json=payload,
                headers={"x-real-ip": ip_a},
            )
            assert resp_a6.status_code == 429, f"IP-A 6th should be 429: {resp_a6.text}"

            # IP-B: still has its full quota
            for i in range(5):
                resp = client.post(
                    "/api/auth/consent",
                    json=payload,
                    headers={"x-real-ip": ip_b},
                )
                assert resp.status_code == 201, f"IP-B request {i + 1} failed: {resp.text}"
        finally:
            clear()

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


class _MockDB:
    """Reusable SQLAlchemy Session mock for the public abuse control tests.

    Configure with a list of (sql_substring, row) mappings. Returns the first
    matching row, or `default_row` (None) when no substring matches.
    Set `record_sql=True` to capture every executed statement for assertions.
    SQL is normalized (newlines collapsed, multi-space run collapsed) before
    matching, so `text("SELECT 1\\n  FROM table")` and the literal substring
    `"SELECT 1 FROM table"` will match.
    """

    def __init__(
        self,
        mappings: list[tuple[str, "_FakeRow | None"]] | None = None,
        *,
        default_row: "_FakeRow | None" = None,
        record_sql: bool = False,
    ):
        import re

        self.commits = 0
        self._mappings = mappings or []
        self._default_row = default_row
        self._record_sql = record_sql
        self.all_sql: list[tuple[str, dict | None]] = []
        # Compile substring patterns with whitespace-flexible matching
        # (e.g. "SELECT 1 FROM t" matches "SELECT 1  FROM t" or
        # "SELECT 1\nFROM t").
        self._patterns: list[tuple[re.Pattern, "_FakeRow | None"]] = [
            (re.compile(re.escape(sub).replace(r"\ ", r"\s+")), row) for sub, row in self._mappings
        ]

    def execute(self, statement, params=None):
        sql = str(statement).replace("\n", " ")
        if self._record_sql:
            self.all_sql.append((sql, params))
        for pattern, row in self._patterns:
            if pattern.search(sql):
                return _FakeResult(row=row)
        return _FakeResult(row=self._default_row)

    def commit(self):
        self.commits += 1


def _override_db_with(mock_db: _MockDB):
    """Wire `mock_db` into FastAPI's `get_db` dependency and return a teardown callable."""
    from database import get_db

    def override_get_db():
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db
    return lambda: app.dependency_overrides.clear()


class TestNeutral404:
    """Public /{id} endpoints return neutral 404 for missing vs. wrong-owner."""

    def test_get_report_neutral_404_missing(self):
        """GET /api/civilian/reports/{id} — nonexistent report returns neutral 404.

        The route runs `_require_device_ownership` which returns 'Report not found'
        for missing reports — that is the established neutral 404 message for
        the civilian report routes (also asserted in test_public_submission.py
        test_get_report_wrong_device_returns_neutral_404).
        """
        clear = _override_db_with(_MockDB())
        try:
            resp = client.get(
                "/api/civilian/reports/99999",
                params={"device_id": "test-device"},
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert "detail" in data
            assert data["detail"] == "Report not found", (
                f"Expected 'Report not found', got {data['detail']}"
            )
        finally:
            clear()

    def test_get_timeline_neutral_404_missing(self):
        """GET /api/civilian/reports/{id}/timeline — nonexistent report returns neutral 404.

        The route runs `_require_device_ownership` which returns 'Report not found'
        for missing reports — see test_public_submission.py::test_get_report_wrong_device.
        """
        clear = _override_db_with(_MockDB())
        try:
            resp = client.get(
                "/api/civilian/reports/99999/timeline",
                params={"device_id": "test-device"},
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert data["detail"] == "Report not found", (
                f"Expected 'Report not found', got {data['detail']}"
            )
        finally:
            clear()

    def test_followup_neutral_404_nonexistent(self):
        """POST /api/civilian/reports/{id}/followup — nonexistent report returns neutral 404.

        The route runs `_require_device_ownership` first which returns 'Report not found'.
        `CivilianFollowupCreate.device_id` is required (Field(..., min_length=1)) so
        we must pass it in the body to avoid a 422 before the route runs.
        """
        clear = _override_db_with(_MockDB())
        try:
            resp = client.post(
                "/api/civilian/reports/99999/followup",
                json={
                    "device_id": "test-device",
                    "followup_text": "test",
                },
                headers={"x-real-ip": "198.51.100.1"},
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert data["detail"] == "Report not found", (
                f"Expected 'Report not found', got {data['detail']}"
            )
        finally:
            clear()

    def test_notify_neutral_404_nonexistent(self):
        """POST /api/civilian/reports/{id}/notify — nonexistent report returns neutral 404.

        The route runs `_require_device_ownership` first which returns 'Report not found'.
        `NotifyRegisterRequest.device_id` is required so we must pass it.
        """
        clear = _override_db_with(_MockDB())
        try:
            resp = client.post(
                "/api/civilian/reports/99999/notify",
                json={
                    "device_id": "test-device",
                    "fcm_token": "test-fcm-token",
                },
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert data["detail"] == "Report not found", (
                f"Expected 'Report not found', got {data['detail']}"
            )
        finally:
            clear()

    def test_append_neutral_404_nonexistent(self):
        """PATCH /api/civilian/reports/{id}/append — nonexistent report returns neutral 404.

        The route runs `_require_device_ownership` first which returns 'Report not found'.
        `CivilianReportAppend.device_id` is optional, so we pass it to make the route
        take the ownership-check path (otherwise the `if not device_id` branch raises
        the same 'Report not found' message).
        """
        clear = _override_db_with(_MockDB())
        try:
            resp = client.patch(
                "/api/civilian/reports/99999/append",
                json={
                    "device_id": "test-device",
                    "latitude": 14.5995,
                    "longitude": 120.9842,
                    "category": "STRUCTURAL",
                    "reporting_context": "WITNESS",
                },
            )
            assert resp.status_code == 404, resp.text
            data = resp.json()
            assert data["detail"] == "Report not found", (
                f"Expected 'Report not found', got {data['detail']}"
            )
        finally:
            clear()


# ---------------------------------------------------------------------------
# Notification Spam Limit Tests
# ---------------------------------------------------------------------------


class TestNotifySpamLimits:
    """POST /api/civilian/reports/{id}/notify — per-IP token-reg cap + max FCM tokens/report."""

    def test_notify_too_many_tokens_per_report_returns_429(self):
        """Registration beyond max FCM tokens per report should return 429."""
        from unittest.mock import patch

        _EXISTING_REPORT = _FakeRow(report_id=42, status="PENDING")

        mock_db = _MockDB(
            mappings=[
                ("SELECT 1 FROM wims.citizen_reports", _EXISTING_REPORT),
                ("COUNT(*) FROM wims.report_notification_tokens", _FakeRow(count=10)),
            ],
        )

        clear = _override_db_with(mock_db)
        try:
            with patch("utils.public_abuse.rate_limit_public", return_value=None):
                resp = client.post(
                    "/api/civilian/reports/42/notify",
                    json={"device_id": "test-device", "fcm_token": "test-token"},
                )
                assert resp.status_code == 429, resp.text
                data = resp.json()
                assert "Too many notification" in data["detail"]
        finally:
            clear()

    def test_notify_ip_token_rate_limit_returns_429(self):
        """Per-IP token registration cap should block excessive registrations (Redis-based)."""
        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        ip = _test_ip(abs(hash("notify-ip-ratelimit")) % 256)
        _clean_redis_keys(r, f"wims:rl:public_notify:{ip}*")

        _EXISTING_REPORT = _FakeRow(report_id=42, status="PENDING")

        mock_db = _MockDB(
            mappings=[
                ("SELECT 1 FROM wims.citizen_reports", _EXISTING_REPORT),
                ("COUNT(*) FROM wims.report_notification_tokens", _FakeRow(count=0)),
                ("INSERT INTO wims.report_notification_tokens", _FakeRow(token_id=1)),
            ],
        )

        clear = _override_db_with(mock_db)
        try:
            # First 5 requests succeed
            for i in range(5):
                resp = client.post(
                    "/api/civilian/reports/42/notify",
                    json={"device_id": "test-device", "fcm_token": f"test-token-{i}"},
                    headers={"x-real-ip": ip},
                )
                assert resp.status_code == 201, f"Request {i + 1} failed: {resp.text}"

            # 6th request should be rate-limited
            resp = client.post(
                "/api/civilian/reports/42/notify",
                json={"device_id": "test-device", "fcm_token": "test-token-6"},
                headers={"x-real-ip": ip},
            )
            assert resp.status_code == 429, f"6th request should be 429: {resp.text}"
            data = resp.json()
            assert "Rate limit exceeded" in data["detail"]
        finally:
            clear()

        _clean_redis_keys(r, f"wims:rl:public_notify:{ip}*")


# ---------------------------------------------------------------------------
# Public Audit Log Tests
# ---------------------------------------------------------------------------


class TestPublicAuditLog:
    """Privacy-preserving audit logging for public endpoints."""

    def test_consent_endpoint_logs_audit(self):
        """POST /api/auth/consent should log a public audit entry with IP hash."""
        _CONSENT_ROW = _FakeRow(
            consent_id=42,
            subject_type="USER",
            subject_id="test-user",
            consent_type="notifications",
            action="GRANTED",
            recorded_at=datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )

        mock_db = _MockDB(
            mappings=[("INSERT INTO wims.consent_log", _CONSENT_ROW)],
            record_sql=True,
        )

        # Override Redis to avoid real Redis connection during unit test.
        # Patch the import site (``api.routes.consent.rate_limit_public``)
        # — the route binds the name into its own module namespace via
        # ``from utils.public_abuse import rate_limit_public``, so patching
        # the source module would not intercept the call.
        from unittest.mock import patch

        clear = _override_db_with(mock_db)
        try:
            with patch("api.routes.consent.rate_limit_public", return_value=None):
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
                # Verify that audit log stores only IP hashes, not plaintext IPs.
                # `log_system_audit` binds the hash to `:ip_hash`, not `:ip`.
                for sql, params in audit_calls:
                    if not params:
                        continue
                    if "ip_hash" in params:
                        ip_hash = str(params["ip_hash"])
                        assert "." not in ip_hash, (
                            f"Audit log contains dotted IP in ip_hash: {ip_hash}"
                        )
                        assert len(ip_hash) == 64, (
                            f"Audit log ip_hash should be 64 hex chars (SHA-256), got {len(ip_hash)}: {ip_hash}"
                        )
        finally:
            clear()


# ---------------------------------------------------------------------------
# Existing rate limit verification tests
# ---------------------------------------------------------------------------


class TestExistingRateLimits:
    """Verify existing rate limits on civilian and public DMZ endpoints."""

    def test_civilian_report_rate_limit_db_based_returns_429(self):
        """POST /api/civilian/reports — >3 reports from same IP in 1hr → 429."""
        mock_db = _MockDB(
            mappings=[
                (
                    "COUNT(*) AS rate_count",
                    _FakeRow(
                        rate_count=3,
                        oldest_created_at=datetime(2026, 6, 22, 9, 30, 0, tzinfo=timezone.utc),
                    ),
                )
            ],
        )

        clear = _override_db_with(mock_db)
        try:
            resp = client.post(
                "/api/civilian/reports",
                json={
                    "latitude": 14.5995,
                    "longitude": 120.9842,
                    "category": "STRUCTURAL",
                },
                headers={"x-real-ip": "198.51.100.1"},
            )
            assert resp.status_code == 429, resp.text
            assert "Too many reports" in resp.json()["detail"]
            assert "Retry-After" in resp.headers
        finally:
            clear()

    def test_public_dmz_rate_limit_redis_based_returns_429(self):
        """POST /api/v1/public/report — >3 requests from same IP in 1hr → 429.

        Uses x-real-ip (which nginx sets to $realip_remote_addr) to supply the
        rate-limit key.  x-forwarded-for is no longer used for rate limiting
        because it is client-controlled after Docker NAT — see gap #14 / DS-07.
        """
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

        mock_db = _MockDB(
            mappings=[
                ("ref_fire_stations", _REGION_ROW),
                ("ST_Y", _COORD_ROW),  # checked before generic INSERT match below
                ("INSERT", _INSERT_ROW),
            ],
        )

        clear = _override_db_with(mock_db)
        try:
            for i in range(3):
                resp = client.post(
                    "/api/v1/public/report",
                    json={
                        "latitude": 14.5995,
                        "longitude": 120.9842,
                        "description": f"Test {i + 1}",
                    },
                    headers={"x-real-ip": ip},
                )
                assert resp.status_code == 201, f"Request {i + 1} failed: {resp.text}"

            fourth = client.post(
                "/api/v1/public/report",
                json={"latitude": 14.5995, "longitude": 120.9842, "description": "Rate limited"},
                headers={"x-real-ip": ip},
            )
            assert fourth.status_code == 429, f"4th request should be 429: {fourth.text}"
            assert "Retry-After" in fourth.headers
        finally:
            clear()

        _clean_redis_keys(r, f"public_rate_limit:{ip}*")


# ---------------------------------------------------------------------------
# Civilian report DB-based rate limit — Retry-After header
# ---------------------------------------------------------------------------


class TestCivilianReportRateLimit:
    """POST /api/civilian/reports — DB-based 3/hr limit now returns Retry-After."""

    _PAYLOAD = {"latitude": 14.5995, "longitude": 120.9842, "category": "STRUCTURAL"}
    _IP = "198.51.100.77"
    _OLDEST = datetime(2026, 6, 22, 9, 30, 0, tzinfo=timezone.utc)

    def _blocked_mock(self):
        return _MockDB(
            mappings=[
                (
                    "COUNT(*) AS rate_count",
                    _FakeRow(rate_count=3, oldest_created_at=self._OLDEST),
                )
            ]
        )

    def test_request_at_cap_returns_429(self):
        """Request that finds the IP at the cap (count >= 3) must return 429.

        P1-7: the prior ``test_sixth_report_returns_429`` mock had count=3
        and the test fired 1 request — so it actually exercised the
        "4th report" path, not the "6th report" path. Renamed and the
        assertion is tightened to "exactly the 4th request is blocked
        when count was already at the cap".
        """
        clear = _override_db_with(self._blocked_mock())
        try:
            resp = client.post(
                "/api/civilian/reports",
                json=self._PAYLOAD,
                headers={"x-real-ip": self._IP},
            )
            assert resp.status_code == 429, resp.text
            assert "Too many reports" in resp.json()["detail"]
        finally:
            clear()

    def test_retry_after_value_is_pinned_to_window_remaining(self):
        """The Retry-After header is the exact window-remaining-seconds.

        P1-7: the prior ``test_sixth_report_has_retry_after_header`` only
        asserted ``>= 1``; it would pass for any implementation. We pin
        ``now()`` with freezegun and the test owns both ends of the
        formula: oldest = 09:30:00, now = 10:00:00 → 30 min = 1800 s.
        """
        from freezegun import freeze_time

        with freeze_time("2026-06-22 10:00:00", tz_offset=0):
            clear = _override_db_with(self._blocked_mock())
            try:
                resp = client.post(
                    "/api/civilian/reports",
                    json=self._PAYLOAD,
                    headers={"x-real-ip": self._IP},
                )
                assert resp.status_code == 429, resp.text
                assert "Retry-After" in resp.headers, (
                    f"Retry-After header missing from 429: {dict(resp.headers)}"
                )
                # oldest = 09:30 UTC, now = 10:00 UTC → remaining = 1800 s
                assert int(resp.headers["Retry-After"]) == 1800, (
                    f"Retry-After must be exactly 1800 (30 min) when oldest=09:30 "
                    f"and now=10:00, got {resp.headers['Retry-After']}"
                )
            finally:
                clear()

    def test_retry_after_caps_at_window_seconds(self):
        """If the DB clock is ahead of the app clock (oldest is in the
        future from the app's perspective), Retry-After must cap at the
        window length (3600) — not advise the client to wait longer than
        the rate-limit window actually is (P1-6)."""
        from freezegun import freeze_time

        # oldest = 10:30 UTC, app now = 10:00 UTC → remaining = 1h + 30m =
        # 5400s. Without the cap the header would be 5400; with the cap at
        # RETRY_AFTER_CEILING_SECONDS (3600) it must be exactly 3600.
        skewed_oldest = datetime(2026, 6, 22, 10, 30, 0, tzinfo=timezone.utc)
        skewed_mock = _MockDB(
            mappings=[
                (
                    "COUNT(*) AS rate_count",
                    _FakeRow(rate_count=3, oldest_created_at=skewed_oldest),
                )
            ]
        )
        with freeze_time("2026-06-22 10:00:00", tz_offset=0):
            clear = _override_db_with(skewed_mock)
            try:
                resp = client.post(
                    "/api/civilian/reports",
                    json=self._PAYLOAD,
                    headers={"x-real-ip": self._IP},
                )
                assert resp.status_code == 429, resp.text
                assert int(resp.headers["Retry-After"]) == 3600, (
                    f"Retry-After must cap at the 1h window (3600 s) when "
                    f"DB clock is ahead, got {resp.headers['Retry-After']}"
                )
            finally:
                clear()

    def test_different_ips_have_independent_quotas(self):
        """Two different IPs at different rate-limit states must behave
        independently — one rate-limited, the other allowed.

        P1-7: the prior ``test_different_ips_have_independent_quotas`` used
        the same mock (count=0) for both IPs and only proved that "an
        under-limit IP is not blocked". It never proved that the quota
        is per-IP, which is the actual claim. Now: 198.51.100.11 is at the
        cap (must 429), 198.51.100.22 is under the cap (must not 429).
        """
        from freezegun import freeze_time

        class _PerIPMock(_MockDB):
            """_MockDB that returns a different COUNT(*) row per IP.

            The route uses trusted_client_ip(request) which returns the
            x-real-ip header verbatim, so the mock can key on
            params['ip_hash'] to choose the right response.
            """

            def __init__(self, blocked_ip, allowed_ip, oldest):
                super().__init__(mappings=[])  # we'll dispatch in execute()
                self._blocked_ip = blocked_ip
                self._allowed_ip = allowed_ip
                self._oldest = oldest
                from utils.audit import hash_client_ip

                self._blocked_hash = hash_client_ip(blocked_ip)
                self._allowed_hash = hash_client_ip(allowed_ip)

            def execute(self, statement, params=None):
                sql = str(statement).replace("\n", " ")
                if "pg_advisory_xact_lock" in sql:
                    return _FakeResult(row=None)
                if "COUNT(*) AS rate_count" in sql:
                    if params and params.get("ip_hash") == self._blocked_hash:
                        return _FakeResult(
                            row=_FakeRow(rate_count=3, oldest_created_at=self._oldest)
                        )
                    if params and params.get("ip_hash") == self._allowed_hash:
                        return _FakeResult(row=_FakeRow(rate_count=0, oldest_created_at=None))
                return _FakeResult(row=None)

        with freeze_time("2026-06-22 10:00:00", tz_offset=0):
            clear = _override_db_with(_PerIPMock("198.51.100.11", "198.51.100.22", self._OLDEST))
            try:
                # Blocked IP -> 429
                blocked = client.post(
                    "/api/civilian/reports",
                    json=self._PAYLOAD,
                    headers={"x-real-ip": "198.51.100.11"},
                )
                assert blocked.status_code == 429, (
                    f"IP 198.51.100.11 (count=3) must be 429, got "
                    f"{blocked.status_code}: {blocked.text}"
                )
                # Allowed IP -> NOT 429 (the test only cares about the
                # rate-limit gate; downstream mocks are absent so the
                # handler may 500, but it must not be 429).
                allowed = client.post(
                    "/api/civilian/reports",
                    json=self._PAYLOAD,
                    headers={"x-real-ip": "198.51.100.22"},
                )
                assert allowed.status_code != 429, (
                    f"IP 198.51.100.22 (count=0) must not be 429, got "
                    f"{allowed.status_code}: {allowed.text}"
                )
            finally:
                clear()

    def test_rate_limit_blocks_concurrent_burst(self):
        """PR #446 gap #14 followup: the DB rate-limit must take a Postgres
        advisory transaction lock BEFORE the COUNT(*) query so N concurrent
        requests at the boundary cannot all observe count<3 and all INSERT.

        This is the real test that the concurrent-burst race is closed: it
        captures the SQL the route executes and asserts that the
        `pg_advisory_xact_lock` call appears in the captured stream BEFORE
        the `COUNT(*) AS rate_count` rate-limit query. The lock is keyed on
        the per-IP hash so different IPs do not contend, and
        `pg_advisory_xact_lock` is transaction-scoped — it auto-releases on
        commit/rollback, no explicit unlock needed.
        """
        clear = _override_db_with(self._blocked_mock_with_sql_capture())
        try:
            resp = client.post(
                "/api/civilian/reports",
                json=self._PAYLOAD,
                headers={"x-real-ip": self._IP},
            )
            assert resp.status_code == 429, resp.text
        finally:
            clear()
        # Inspect the executed SQL — the advisory lock MUST appear before
        # the COUNT(*) rate-limit query.
        all_sql = " ".join(s for s, _ in self._captured_sql)
        lock_idx = all_sql.find("pg_advisory_xact_lock")
        count_idx = all_sql.find("COUNT(*) AS rate_count")
        assert lock_idx != -1, f"pg_advisory_xact_lock not present in executed SQL: {all_sql!r}"
        assert count_idx != -1, f"COUNT(*) rate-count query not present: {all_sql!r}"
        assert lock_idx < count_idx, (
            f"pg_advisory_xact_lock must execute BEFORE the COUNT(*) rate-limit "
            f"query to close the TOCTOU race window. Got lock_idx={lock_idx} "
            f"count_idx={count_idx}"
        )

    def _blocked_mock_with_sql_capture(self):
        """Helper for the advisory-lock test — same as _blocked_mock() but
        records every executed SQL statement for inspection after the test."""
        captured = _MockDB(
            mappings=[
                (
                    "COUNT(*) AS rate_count",
                    _FakeRow(rate_count=3, oldest_created_at=self._OLDEST),
                )
            ],
            record_sql=True,
        )
        self._captured_sql = captured.all_sql  # type: ignore[attr-defined]
        return captured
