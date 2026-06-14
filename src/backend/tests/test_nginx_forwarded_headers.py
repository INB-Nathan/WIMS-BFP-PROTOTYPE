"""Regression tests for reverse-proxy client IP header handling."""

from __future__ import annotations

from pathlib import Path


NGINX_CONF = Path(__file__).resolve().parents[2] / "nginx" / "nginx.conf"


def test_nginx_overwrites_x_forwarded_for_instead_of_appending_spoofable_header():
    conf = NGINX_CONF.read_text(encoding="utf-8")

    assert "$proxy_add_x_forwarded_for" not in conf
    forwarded_lines = [
        line.strip() for line in conf.splitlines() if "proxy_set_header X-Forwarded-For" in line
    ]
    assert forwarded_lines
    assert set(forwarded_lines) == {"proxy_set_header X-Forwarded-For $remote_addr;"}
