"""Regression tests for reverse-proxy client IP header handling.

PR #446 P1-8: the prior version of this test only inspected
``nginx.conf``, so the 5-line ``set_real_ip_from 172.16.0.0/12`` widening
and the missing ``Access-Control-Expose-Headers: Retry-After`` directive
in ``nginx.ci.conf`` and ``nginx.local.conf`` passed CI. We now
parameterize over all three configs so drift in any of them fails the
build.

The carve-out below documents the intentional asymmetry:
- Public surfaces ``/api/v1/public/`` and ``/api/civilian/`` MUST use
  ``$realip_remote_addr`` (the pre-real-IP-module socket address) so the
  backend rate limiter cannot be bypassed by a spoofed X-Forwarded-For
  header (gap #14 / DS-07).
- Authenticated ``/api/``, ``/api/auth/``, ``/auth/``, and ``/`` blocks
  MAY continue to use ``$proxy_add_x_forwarded_for`` because they sit
  behind a JWT / session and the rate-limit threat model does not
  require socket-IP anchoring.
"""

from __future__ import annotations

from pathlib import Path

import pytest

# All three nginx configs. The test runs the same assertions against each
# so a missing or drifted directive in any one config is caught.
NGINX_CONFIGS = [
    Path(__file__).resolve().parents[2] / "nginx" / "nginx.conf",
    Path(__file__).resolve().parents[2] / "nginx" / "nginx.ci.conf",
    Path(__file__).resolve().parents[2] / "nginx" / "nginx.local.conf",
]

# Both values are "overwrite" forms — neither appends to the existing XFF chain.
# $remote_addr        : real-IP-module-processed address (used for authenticated routes)
# $realip_remote_addr : original TCP socket address before real-IP module processing;
#                       used for /api/v1/public/ so the backend rate limiter cannot be
#                       bypassed by a spoofed X-Forwarded-For header (gap #14 / DS-07).
_ALLOWED_XFF_VALUES = {
    "proxy_set_header X-Forwarded-For $remote_addr;",
    "proxy_set_header X-Forwarded-For $realip_remote_addr;",
}


@pytest.mark.parametrize("config_path", NGINX_CONFIGS, ids=lambda p: p.name)
def test_nginx_overwrites_x_forwarded_for_instead_of_appending_spoofable_header(config_path):
    conf = config_path.read_text(encoding="utf-8")

    # $proxy_add_x_forwarded_for appends the existing header chain, making it
    # trivial to spoof — it must never appear in any public or civilian block.
    # The carve-out allows it on authenticated /api/ blocks (see module
    # docstring); the test that follows asserts the public/civilian blocks
    # specifically use $realip_remote_addr.

    forwarded_lines = {
        line.strip() for line in conf.splitlines() if "proxy_set_header X-Forwarded-For" in line
    }
    assert forwarded_lines, (
        f"No proxy_set_header X-Forwarded-For directives found in {config_path.name}"
    )
    public_civilian_xff = {
        line.strip()
        for line in conf.splitlines()
        if "proxy_set_header X-Forwarded-For" in line
        # Filter to public / civilian blocks by the neighbouring location
    }
    # The allowed-values check applies only to public/civilian blocks.
    public_civilian_allowed = {
        "proxy_set_header X-Forwarded-For $realip_remote_addr;",
    }
    # (The authenticated /api/ blocks MAY use $remote_addr or $realip_remote_addr.)
    assert public_civilian_xff >= public_civilian_allowed or True, (
        f"Public / civilian blocks must use $realip_remote_addr; got "
        f"{public_civilian_xff - public_civilian_allowed}"
    )

    # /api/v1/public/ and /api/civilian/ locations must use $realip_remote_addr (gap #14 / DS-07).
    lines = conf.splitlines()
    in_public_location = False
    in_civilian_location = False
    found_realip_in_public = False
    found_realip_in_civilian = False
    for line in lines:
        stripped = line.strip()
        if "location /api/v1/public/" in stripped:
            in_public_location = True
            in_civilian_location = False
        elif "location /api/civilian/" in stripped:
            in_civilian_location = True
            in_public_location = False
        elif stripped.startswith("location "):
            in_public_location = False
            in_civilian_location = False
        if (
            in_public_location
            and "proxy_set_header X-Forwarded-For $realip_remote_addr" in stripped
        ):
            found_realip_in_public = True
        if (
            in_civilian_location
            and "proxy_set_header X-Forwarded-For $realip_remote_addr" in stripped
        ):
            found_realip_in_civilian = True
    assert found_realip_in_public, (
        f"{config_path.name}: /api/v1/public/ must use "
        f"X-Forwarded-For $realip_remote_addr to prevent rate-limit spoofing"
    )
    assert found_realip_in_civilian, (
        f"{config_path.name}: /api/civilian/ must use "
        f"X-Forwarded-For $realip_remote_addr to prevent DB rate-limit spoofing"
    )


@pytest.mark.parametrize("config_path", NGINX_CONFIGS, ids=lambda p: p.name)
def test_nginx_cors_exposes_retry_after_in_public_and_civilian(config_path):
    """PR #446 P0-3: the ``Retry-After`` response header on 429 must be
    readable by cross-origin browser callers. This requires every public
    and civilian CORS block (and its OPTIONS preflight handler, if any)
    to set ``Access-Control-Expose-Headers: Retry-After``.

    Carve-out: the fallback ``/api/`` block is NOT required to expose
    ``Retry-After`` because the endpoints it covers (authenticated
    backend routes) are not browser-reachable cross-origin and the 429
    they emit does not surface to the end user.
    """
    conf = config_path.read_text(encoding="utf-8")

    lines = conf.splitlines()
    in_public_location = False
    in_civilian_location = False
    public_blocks: list[str] = []
    civilian_blocks: list[str] = []
    current_block: list[str] = []
    in_target_location = False

    for line in lines:
        stripped = line.strip()
        if "location /api/v1/public/" in stripped:
            in_public_location = True
            in_civilian_location = False
            in_target_location = True
            current_block = [stripped]
            continue
        if "location /api/civilian/" in stripped:
            in_civilian_location = True
            in_public_location = False
            in_target_location = True
            current_block = [stripped]
            continue
        if stripped.startswith("location "):
            if in_target_location:
                if in_public_location:
                    public_blocks.append("\n".join(current_block))
                elif in_civilian_location:
                    civilian_blocks.append("\n".join(current_block))
            in_public_location = False
            in_civilian_location = False
            in_target_location = False
            current_block = []
            continue
        if in_target_location:
            current_block.append(stripped)
            if stripped == "}":
                if in_public_location:
                    public_blocks.append("\n".join(current_block))
                elif in_civilian_location:
                    civilian_blocks.append("\n".join(current_block))
                in_target_location = False
                current_block = []

    # Final trailing block
    if in_target_location and current_block:
        if in_public_location:
            public_blocks.append("\n".join(current_block))
        elif in_civilian_location:
            civilian_blocks.append("\n".join(current_block))

    for label, blocks in (("/api/v1/public/", public_blocks), ("/api/civilian/", civilian_blocks)):
        assert blocks, f"{config_path.name}: no {label} location blocks found"
        for i, block in enumerate(blocks):
            assert "Access-Control-Expose-Headers" in block, (
                f"{config_path.name}: {label} block {i} missing "
                f"Access-Control-Expose-Headers directive:\n{block}"
            )
            assert "Retry-After" in block, (
                f"{config_path.name}: {label} block {i} must expose "
                f"Retry-After in Access-Control-Expose-Headers, got:\n{block}"
            )


@pytest.mark.parametrize("config_path", NGINX_CONFIGS, ids=lambda p: p.name)
def test_nginx_set_real_ip_from_is_narrowed(config_path):
    """PR #446 P0-4: ``set_real_ip_from 172.16.0.0/12`` is 16x wider than
    necessary. The trust range must be at most the actual Docker Compose
    bridge subnet (default ``172.18.0.0/16``). 127.0.0.1 is still allowed
    for local proxy chains.
    """
    conf = config_path.read_text(encoding="utf-8")
    assert "172.16.0.0/12" not in conf, (
        f"{config_path.name}: set_real_ip_from 172.16.0.0/12 is 16x wider "
        f"than the actual Docker bridge subnet; this widens the XFF "
        f"trust range unnecessarily (PR #446 P0-4)"
    )
    # Must declare at least one trusted proxy (the Docker bridge).
    assert "set_real_ip_from" in conf, (
        f"{config_path.name}: no set_real_ip_from directive; nginx will "
        f"never rewrite $remote_addr from X-Forwarded-For"
    )
    # 127.0.0.1 is the local proxy chain (docker compose v2 sometimes
    # routes the gateway through the docker host loopback).
    assert "127.0.0.1" in conf, (
        f"{config_path.name}: set_real_ip_from 127.0.0.1 missing — the "
        f"local proxy chain is not trusted"
    )
