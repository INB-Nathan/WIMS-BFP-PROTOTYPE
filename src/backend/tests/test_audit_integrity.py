"""Tests for D20 audit integrity (issue #394).

Covers:
  - hash_client_ip: salted SHA-256, empty/None handling, salt rotation
  - X-Request-ID middleware: generation, propagation, invalid input rejection
  - log_system_audit extended signature: correlation_id, result, ip_hash
  - Fail-CLOSED for sensitive=True (AuditInsertFailed raised)
  - Fail-OPEN for sensitive=False (logged, not raised)
  - record_audit_failure / check_audit_abuse: Redis counter, threshold
  - _normalize_request_id: input validation
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app, _normalize_request_id
from utils.audit import (
    AuditInsertFailed,
    check_audit_abuse,
    hash_client_ip,
    log_system_audit,
    record_audit_failure,
)


# ── helpers ──────────────────────────────────────────────────────────────────


class _Request:
    def __init__(
        self,
        headers: dict[str, str] | None = None,
        host: str = "172.18.0.4",
        correlation_id: str | None = None,
    ) -> None:
        self.headers = headers or {}
        self.client = SimpleNamespace(host=host)
        if correlation_id is not None:
            self.state = SimpleNamespace(correlation_id=correlation_id)


def _mock_db_with_failure() -> MagicMock:
    """Mock DB whose .execute() raises an exception."""
    db = MagicMock()
    db.execute.side_effect = Exception("simulated audit INSERT failure")
    return db


def _mock_db_ok() -> MagicMock:
    """Mock DB whose .execute() returns a simple cursor."""
    db = MagicMock()
    db.execute.return_value = MagicMock()
    return db


# =============================================================================
# Tests: hash_client_ip
# =============================================================================


class TestHashClientIp:
    def test_returns_64_char_hex(self):
        result = hash_client_ip("192.168.1.1", salt="salt-A")
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)

    def test_different_salts_produce_different_hashes(self):
        a = hash_client_ip("192.168.1.1", salt="salt-A")
        b = hash_client_ip("192.168.1.1", salt="salt-B")
        assert a != b

    def test_same_input_same_salt_produces_same_hash(self):
        a = hash_client_ip("10.0.0.1", salt="static")
        b = hash_client_ip("10.0.0.1", salt="static")
        assert a == b

    def test_empty_string_returns_placeholder(self):
        # Empty/None IPs are replaced with "<unknown>" so the column is never null
        result = hash_client_ip("", salt="s")
        expected = hash_client_ip("<unknown>", salt="s")
        assert result == expected

    def test_none_ip_returns_placeholder(self):
        result = hash_client_ip(None, salt="s")  # type: ignore[arg-type]
        expected = hash_client_ip("<unknown>", salt="s")
        assert result == expected

    def test_unsalted_produces_valid_hash_with_warning(self):
        # When salt is empty, the function still produces a hash; the warning
        # is logged but does not break the function.
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WIMS_AUDIT_IP_SALT", None)
            result = hash_client_ip("8.8.8.8")
            assert len(result) == 64


# =============================================================================
# Tests: X-Request-ID middleware
# =============================================================================


class TestCorrelationMiddleware:
    def test_generates_uuid_when_header_absent(self):
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        # Response must always carry an X-Request-ID
        assert "x-request-id" in resp.headers
        assert len(resp.headers["x-request-id"]) > 0

    def test_propagates_incoming_header(self):
        client = TestClient(app)
        custom_id = "my-trace-abc-123"
        resp = client.get("/health", headers={"X-Request-ID": custom_id})
        assert resp.headers["x-request-id"] == custom_id

    def test_rejects_injection_attempt(self):
        client = TestClient(app)
        # CRLF injection attempt — middleware must sanitize
        bad = "abc\r\nSet-Cookie: malicious=1"
        resp = client.get("/health", headers={"X-Request-ID": bad})
        # Resulting id should be a generated UUID, NOT the malicious string
        assert "Set-Cookie" not in resp.headers
        assert resp.headers["x-request-id"] != bad
        # The generated fallback should match the UUID format
        import uuid as _uuid

        try:
            _uuid.UUID(resp.headers["x-request-id"])
        except ValueError:
            pytest.fail("Expected generated UUID as fallback for malicious input")

    def test_too_long_id_falls_back_to_uuid(self):
        client = TestClient(app)
        long_id = "a" * 200
        resp = client.get("/health", headers={"X-Request-ID": long_id})
        assert resp.headers["x-request-id"] != long_id


class TestNormalizeRequestId:
    def test_valid_uuid_passes(self):
        import uuid as _uuid

        valid = str(_uuid.uuid4())
        assert _normalize_request_id(valid) == valid

    def test_alphanumeric_token_passes(self):
        assert _normalize_request_id("abc-123_XYZ") == "abc-123_XYZ"

    def test_empty_returns_generated(self):
        result = _normalize_request_id("")
        assert len(result) > 0  # UUID generated

    def test_none_returns_generated(self):
        result = _normalize_request_id(None)  # type: ignore[arg-type]
        assert len(result) > 0

    def test_special_chars_rejected(self):
        # Anything not in [A-Za-z0-9_-] is rejected
        result = _normalize_request_id("has spaces")
        assert " " not in result
        result2 = _normalize_request_id("has!special")
        assert "!" not in result2


# =============================================================================
# Tests: log_system_audit extended signature
# =============================================================================


class TestLogSystemAuditExtended:
    def test_correlation_id_from_request_state(self):
        db = _mock_db_ok()
        request = _Request(correlation_id="trace-abc")
        log_system_audit(db, "user-1", "TEST", "wims.test", 1, request)
        params = db.execute.call_args[0][1]
        assert params["corr"] == "trace-abc"

    def test_explicit_correlation_id_overrides_state(self):
        db = _mock_db_ok()
        request = _Request(correlation_id="state-id")
        log_system_audit(
            db,
            "user-1",
            "TEST",
            "wims.test",
            1,
            request,
            correlation_id="explicit-id",
        )
        params = db.execute.call_args[0][1]
        assert params["corr"] == "explicit-id"

    def test_default_result_is_success(self):
        db = _mock_db_ok()
        log_system_audit(db, "user-1", "TEST", "wims.test", 1, None)
        params = db.execute.call_args[0][1]
        assert params["result"] == "success"

    def test_explicit_result_passes(self):
        db = _mock_db_ok()
        log_system_audit(db, "user-1", "TEST", "wims.test", 1, None, result="failure")
        params = db.execute.call_args[0][1]
        assert params["result"] == "failure"

    def test_ip_hash_set_from_request(self):
        db = _mock_db_ok()
        request = _Request({"x-forwarded-for": "1.2.3.4"}, host="172.18.0.4")
        log_system_audit(db, "user-1", "TEST", "wims.test", 1, request)
        params = db.execute.call_args[0][1]
        # ip_hash should be a 64-char hex digest
        assert isinstance(params["ip_hash"], str)
        assert len(params["ip_hash"]) == 64

    def test_explicit_ip_hash_overrides_request(self):
        db = _mock_db_ok()
        request = _Request()
        log_system_audit(
            db,
            "user-1",
            "TEST",
            "wims.test",
            1,
            request,
            ip_hash="deadbeef" * 8,  # 64 hex chars
        )
        params = db.execute.call_args[0][1]
        assert params["ip_hash"] == "deadbeef" * 8

    def test_no_request_yields_no_ip_hash(self):
        db = _mock_db_ok()
        log_system_audit(db, "user-1", "TEST", "wims.test", 1, None)
        params = db.execute.call_args[0][1]
        assert params["ip_hash"] is None

    def test_legacy_call_signature_still_works(self):
        """Backward compat: callers passing only the legacy positional/keyword
        arguments must still get their INSERT executed."""
        db = _mock_db_ok()
        # No correlation_id, result, ip_hash, sensitive → all default
        log_system_audit(db, "user-1", "TEST", "wims.test", 1, None)
        assert db.execute.called


# =============================================================================
# Tests: Fail-CLOSED for sensitive mutations
# =============================================================================


class TestSensitiveFailClosed:
    def test_sensitive_true_raises_on_failure(self):
        """When sensitive=True and the audit INSERT fails, AuditInsertFailed is raised."""
        db = _mock_db_with_failure()
        with pytest.raises(AuditInsertFailed):
            log_system_audit(
                db,
                "user-1",
                "SENSITIVE_ACTION",
                "wims.test",
                1,
                None,
                sensitive=True,
            )

    def test_sensitive_false_swallows_failure(self):
        """When sensitive=False (default), failures are logged but not raised."""
        db = _mock_db_with_failure()
        # Should NOT raise
        log_system_audit(
            db,
            "user-1",
            "READ_ACTION",
            "wims.test",
            1,
            None,
        )

    def test_audit_insert_failed_carries_metadata(self):
        db = _mock_db_with_failure()
        try:
            log_system_audit(
                db,
                "user-1",
                "TEST_ACTION",
                "wims.test",
                42,
                None,
                sensitive=True,
            )
        except AuditInsertFailed as exc:
            assert exc.action_type == "TEST_ACTION"
            assert exc.table_affected == "wims.test"


# =============================================================================
# Tests: abuse-spike alerting
# =============================================================================


class TestAuditAbuseCounters:
    def test_record_failure_uses_redis(self):
        """record_audit_failure increments a Redis counter; falls back to no-op
        when Redis is unavailable (no exception leaks)."""
        # No Redis → no-op path; should not raise
        with patch.dict(os.environ, {"REDIS_URL": "redis://nonexistent:0"}):
            record_audit_failure(reason="test")

    def test_check_abuse_no_redis_returns_false(self):
        """When Redis is unavailable, check_audit_abuse returns False (no false alarms)."""
        with patch.dict(os.environ, {"REDIS_URL": "redis://nonexistent:0"}):
            assert check_audit_abuse() is False

    def test_check_abuse_low_threshold_with_fake_redis(self):
        """With a fake Redis and a low threshold, abuse is detected after enough failures."""

        class _FakePipeline:
            def __init__(self, parent):
                self.parent = parent

            def incr(self, key: str) -> "_FakePipeline":
                self.parent.store[key] = self.parent.store.get(key, 0) + 1
                return self

            def expire(self, key: str, ttl: int) -> "_FakePipeline":
                return self

            def execute(self) -> list:
                return []

        class _FakeRedis:
            def __init__(self):
                self.store: dict[str, int] = {}

            def pipeline(self) -> _FakePipeline:
                return _FakePipeline(self)

            def incr(self, key: str) -> int:
                self.store[key] = self.store.get(key, 0) + 1
                return self.store[key]

            def expire(self, key: str, ttl: int) -> None:
                pass

            def get(self, key: str) -> str | int | None:
                v = self.store.get(key)
                return v if v is None else str(v)

            def close(self) -> None:
                pass

            def ping(self) -> bool:
                return True

        fake = _FakeRedis()
        with (
            patch("redis.from_url", return_value=fake),
            patch.dict(os.environ, {"WIMS_AUDIT_ABUSE_THRESHOLD": "2"}),
        ):
            record_audit_failure()
            record_audit_failure()
            assert check_audit_abuse() is True
