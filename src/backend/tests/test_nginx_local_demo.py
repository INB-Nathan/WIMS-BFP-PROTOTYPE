"""Regression tests for the local-demo nginx config (PR #741 local-stack blocker).

The wims-local.sh stack (src/docker-compose.local-demo.yml) previously
mounted src/nginx/nginx.ci.conf, whose strict CSP ``script-src 'self'``
blocks Next.js inline React hydration scripts: Chromium at
http://localhost/login stayed on the "Loading WIMS-BFP..." SSR shell.

The fix mounts a dedicated src/nginx/nginx.local-demo.conf, derived from
nginx.ci.conf, that relaxes only ``script-src`` with ``'unsafe-inline'``
(the same documented production stance until per-request CSP nonces
exist). These tests pin the seam so that:

- the local-demo compose file mounts the dedicated config (not nginx.ci.conf);
- the local-demo CSP allows inline scripts while the CI CSP stays strict;
- the local-demo config drifts from nginx.ci.conf only where intended.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

NGINX_DIR = REPO_ROOT / "nginx"
LOCAL_DEMO_CONF = NGINX_DIR / "nginx.local-demo.conf"
CI_CONF = NGINX_DIR / "nginx.ci.conf"
LOCAL_DEMO_COMPOSE = REPO_ROOT / "docker-compose.local-demo.yml"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _csp_line(conf: str) -> str:
    matches = [line for line in conf.splitlines() if "add_header Content-Security-Policy" in line]
    assert len(matches) == 1, f"expected exactly one CSP add_header, got {len(matches)}"
    return matches[0]


def test_local_demo_compose_mounts_dedicated_nginx_config() -> None:
    """The local-demo stack must mount nginx.local-demo.conf, not nginx.ci.conf."""
    assert LOCAL_DEMO_CONF.exists(), "src/nginx/nginx.local-demo.conf is missing"
    compose = _read(LOCAL_DEMO_COMPOSE)
    assert "./nginx/nginx.local-demo.conf:/etc/nginx/nginx.conf:ro" in compose, (
        "docker-compose.local-demo.yml must mount ./nginx/nginx.local-demo.conf"
    )
    assert "./nginx/nginx.ci.conf:/etc/nginx/nginx.conf:ro" not in compose, (
        "docker-compose.local-demo.yml must not mount the strict CI config"
    )


def test_local_demo_csp_allows_inline_hydration_scripts() -> None:
    """PR #741: Next.js inline hydration scripts must be allowed on localhost."""
    csp = _csp_line(_read(LOCAL_DEMO_CONF))
    assert "script-src 'self' 'unsafe-inline'" in csp, (
        "nginx.local-demo.conf must relax script-src with 'unsafe-inline' so "
        "the Next.js hydration scripts can run on http://localhost"
    )


def test_ci_csp_stays_strict_without_unsafe_inline_scripts() -> None:
    """The CI security-scan config must keep the strict script-src 'self'."""
    csp = _csp_line(_read(CI_CONF))
    assert "script-src 'self'" in csp
    assert "script-src 'self' 'unsafe-inline'" not in csp, (
        "nginx.ci.conf must stay strict (no 'unsafe-inline' in script-src); "
        "the local-demo relaxation belongs in nginx.local-demo.conf only"
    )


def test_local_demo_matches_ci_except_intended_csp_change() -> None:
    """nginx.local-demo.conf is nginx.ci.conf modulo comments and the CSP line.

    Any other divergence (proxy routes, rate limits, headers, bot blocker,
    Keycloak forwarded headers) fails this test, so security-critical
    directives cannot silently drift between the CI and local-demo configs.
    """
    ci = _read(CI_CONF)
    local_demo = _read(LOCAL_DEMO_CONF)

    def normalized(conf: str) -> list[str]:
        return [
            line
            for line in conf.splitlines()
            if line.strip()
            and not line.strip().startswith("#")
            and not line.strip().startswith("add_header Content-Security-Policy")
        ]

    assert normalized(local_demo) == normalized(ci)


def test_local_demo_keeps_bot_blocker_and_keycloak_forwarded_headers() -> None:
    """Explicit pins for the behaviors the local stack must preserve."""
    conf = _read(LOCAL_DEMO_CONF)
    assert "include /etc/nginx/bot-blocker/bots.d/blockbots.conf;" in conf
    assert "include /etc/nginx/bot-blocker/bots.d/ddos.conf;" in conf
    assert "proxy_set_header X-Forwarded-Host $host;" in conf
    assert "proxy_set_header X-Forwarded-Port $server_port;" in conf


def test_local_demo_is_loopback_http_only() -> None:
    """No TLS in the local-demo config; the compose port stays loopback-only."""
    conf = _read(LOCAL_DEMO_CONF)
    assert "listen 80" in conf
    assert "listen 443" not in conf
    assert "ssl_certificate" not in conf
    compose = _read(LOCAL_DEMO_COMPOSE)
    assert "127.0.0.1:80:80" in compose


def test_local_demo_documents_runtime_secret_and_full_stack_boundaries() -> None:
    """Operators must not confuse interpolation env or run both stacks together."""
    compose = _read(LOCAL_DEMO_COMPOSE)
    launcher = _read(REPO_ROOT.parent / "scripts" / "wims-local.sh")
    for text in (compose, launcher):
        assert "WIMS_MASTER_KEY" in text
        assert "src/.env" in text
        assert "cannot run concurrently" in text
