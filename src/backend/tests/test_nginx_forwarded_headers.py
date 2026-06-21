"""Regression tests for reverse-proxy client IP header handling."""

from __future__ import annotations

from pathlib import Path


NGINX_CONF = Path(__file__).resolve().parents[2] / "nginx" / "nginx.conf"

# Both values are "overwrite" forms — neither appends to the existing XFF chain.
# $remote_addr        : real-IP-module-processed address (used for authenticated routes)
# $realip_remote_addr : original TCP socket address before real-IP module processing;
#                       used for /api/v1/public/ so the backend rate limiter cannot be
#                       bypassed by a spoofed X-Forwarded-For header (gap #14 / DS-07).
_ALLOWED_XFF_VALUES = {
    "proxy_set_header X-Forwarded-For $remote_addr;",
    "proxy_set_header X-Forwarded-For $realip_remote_addr;",
}


def test_nginx_overwrites_x_forwarded_for_instead_of_appending_spoofable_header():
    conf = NGINX_CONF.read_text(encoding="utf-8")

    # $proxy_add_x_forwarded_for appends the existing header chain, making it
    # trivial to spoof — it must never appear in nginx.conf.
    assert "$proxy_add_x_forwarded_for" not in conf

    forwarded_lines = {
        line.strip() for line in conf.splitlines() if "proxy_set_header X-Forwarded-For" in line
    }
    assert forwarded_lines, "No proxy_set_header X-Forwarded-For directives found"
    assert forwarded_lines <= _ALLOWED_XFF_VALUES, (
        f"Unexpected X-Forwarded-For values: {forwarded_lines - _ALLOWED_XFF_VALUES}"
    )

    # /api/v1/public/ locations must use $realip_remote_addr (gap #14 / DS-07).
    lines = conf.splitlines()
    in_public_location = False
    found_realip_in_public = False
    for line in lines:
        stripped = line.strip()
        if "location /api/v1/public/" in stripped:
            in_public_location = True
        elif in_public_location and stripped.startswith("location "):
            in_public_location = False
        if (
            in_public_location
            and "proxy_set_header X-Forwarded-For $realip_remote_addr" in stripped
        ):
            found_realip_in_public = True
    assert found_realip_in_public, (
        "/api/v1/public/ must use X-Forwarded-For $realip_remote_addr to prevent rate-limit spoofing"
    )
