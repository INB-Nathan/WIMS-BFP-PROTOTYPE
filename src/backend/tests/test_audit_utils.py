"""Tests for system audit metadata capture."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from utils.audit import (
    _legacy_get_client_ip_from_xff,
    get_client_ip,
    log_system_audit,
    trusted_client_ip,
)


class _Request:
    def __init__(self, headers: dict[str, str], host: str = "172.18.0.4") -> None:
        self.headers = headers
        self.client = SimpleNamespace(host=host)


def test_legacy_get_client_ip_prefers_first_x_forwarded_for_hop():
    request = _Request({"x-forwarded-for": "198.51.100.10, 172.18.0.2", "user-agent": "pytest"})

    assert _legacy_get_client_ip_from_xff(request) == "198.51.100.10"


def test_legacy_get_client_ip_uses_x_real_ip_before_socket_peer():
    request = _Request({"x-real-ip": "203.0.113.8"})

    assert _legacy_get_client_ip_from_xff(request) == "203.0.113.8"


def test_trusted_client_ip_ignores_xff():
    """trusted_client_ip MUST NOT read X-Forwarded-For (client-controlled)."""
    request = _Request(
        {
            "x-forwarded-for": "1.2.3.4",
            "x-real-ip": "8.8.8.8",
        },
        host="10.0.0.1",
    )
    assert trusted_client_ip(request) == "8.8.8.8"


def test_trusted_client_ip_prefers_x_real_ip_over_socket_peer():
    """When X-Real-IP is missing, fall back to the ASGI socket peer."""
    request = _Request({}, host="10.0.0.1")
    assert trusted_client_ip(request) == "10.0.0.1"


def test_trusted_client_ip_fallback_is_per_request():
    """When both X-Real-IP and request.client are missing, return a per-request
    synthetic key so that two requests do not co-bucket (gap #14 followup)."""
    req1 = _Request({}, host="")
    req1.client = None  # simulate a synthetic request with no socket peer
    req2 = _Request({}, host="")
    req2.client = None

    fallback1 = trusted_client_ip(req1)
    fallback2 = trusted_client_ip(req2)
    assert fallback1 != fallback2, (
        "Falling back to a single global bucket is a DoS amplifier (gap #14 followup, P0-5)"
    )
    assert fallback1.startswith("unknown:")


def test_trusted_client_ip_uses_x_request_id_in_fallback():
    """Per-request fallback includes x-request-id so operators can correlate."""
    req = _Request({"x-request-id": "req-abc-123"}, host="")
    req.client = None
    fallback = trusted_client_ip(req)
    assert fallback.startswith("unknown:req-abc-123")


def test_get_client_ip_alias_still_works():
    """The public get_client_ip name must remain importable for the 16 other
    call sites; it is now the legacy XFF-first path but is no longer the
    default for rate-limit / audit consumers."""
    request = _Request({"x-forwarded-for": "198.51.100.10", "x-real-ip": "8.8.8.8"})
    # Backward-compat: legacy helper still prefers XFF first.
    assert get_client_ip(request) == "198.51.100.10"


def test_log_system_audit_anchors_ip_to_socket_peer_not_xff():
    """PR #446 gap #14: audit log MUST store the trusted socket IP, not XFF.

    The pre-fix behavior was to read the first XFF hop, which is
    client-controlled and was used to bypass rate limits. The audit row's
    ip_address column is now anchored to the trusted client IP — which is
    the ASGI socket peer (172.18.0.9) when no X-Real-IP is set.
    """
    db = MagicMock()
    request = _Request(
        {"x-forwarded-for": "198.51.100.77", "user-agent": "Mozilla/5.0"},
        host="172.18.0.9",
    )

    log_system_audit(db, "00000000-0000-0000-0000-000000000001", "TEST", "wims.test", 1, request)

    params = db.execute.call_args[0][1]
    # The XFF-controlled value MUST NOT be stored in the audit row.
    assert params["ip"] != "198.51.100.77", (
        "Audit log must not store the client-controlled XFF hop (PR #446 gap #14)"
    )
    # The trusted socket peer IS stored.
    assert params["ip"] == "172.18.0.9"
    assert params["ua"] == "Mozilla/5.0"
