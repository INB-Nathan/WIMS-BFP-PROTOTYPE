"""Tests for system audit metadata capture."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from utils.audit import get_client_ip, log_system_audit


class _Request:
    def __init__(self, headers: dict[str, str], host: str = "172.18.0.4") -> None:
        self.headers = headers
        self.client = SimpleNamespace(host=host)


def test_get_client_ip_prefers_first_x_forwarded_for_hop():
    request = _Request({"x-forwarded-for": "198.51.100.10, 172.18.0.2", "user-agent": "pytest"})

    assert get_client_ip(request) == "198.51.100.10"


def test_get_client_ip_uses_x_real_ip_before_socket_peer():
    request = _Request({"x-real-ip": "203.0.113.8"})

    assert get_client_ip(request) == "203.0.113.8"


def test_log_system_audit_stores_forwarded_ip_not_nginx_container_ip():
    db = MagicMock()
    request = _Request(
        {"x-forwarded-for": "198.51.100.77", "user-agent": "Mozilla/5.0"},
        host="172.18.0.9",
    )

    log_system_audit(db, "00000000-0000-0000-0000-000000000001", "TEST", "wims.test", 1, request)

    params = db.execute.call_args[0][1]
    assert params["ip"] == "198.51.100.77"
    assert params["ua"] == "Mozilla/5.0"
