from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_compose() -> dict[str, Any]:
    compose_path = _repo_root() / "docker-compose.yml"
    if not compose_path.exists():
        raise AssertionError(f"docker-compose.yml not found at {compose_path}")
    with compose_path.open("r", encoding="utf-8") as handle:
        try:
            data = yaml.safe_load(handle)
        except yaml.YAMLError as exc:
            raise AssertionError(f"docker-compose.yml is not valid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise AssertionError("docker-compose.yml did not parse to a dictionary")
    return data


def _service_env(compose: dict[str, Any], service_name: str) -> dict[str, Any]:
    services = compose.get("services")
    if not isinstance(services, dict):
        raise AssertionError("docker-compose.yml missing services map")
    service = services.get(service_name)
    if not isinstance(service, dict):
        raise AssertionError(f"service '{service_name}' not found")
    env = service.get("environment")
    if env is None:
        return {}
    if isinstance(env, dict):
        return env
    if isinstance(env, list):
        normalized: dict[str, Any] = {}
        for item in env:
            if isinstance(item, str):
                if "=" in item:
                    key, value = item.split("=", 1)
                    normalized[key] = value
                else:
                    normalized[item] = None
            elif isinstance(item, dict):
                normalized.update(item)
        return normalized
    raise AssertionError(f"service '{service_name}' has unsupported environment format")


def _service_build_args(compose: dict[str, Any], service_name: str) -> dict[str, Any]:
    services = compose.get("services")
    if not isinstance(services, dict):
        raise AssertionError("docker-compose.yml missing services map")
    service = services.get(service_name)
    if not isinstance(service, dict):
        raise AssertionError(f"service '{service_name}' not found")
    build = service.get("build")
    if not isinstance(build, dict):
        return {}
    args = build.get("args")
    if args is None:
        return {}
    if isinstance(args, dict):
        return args
    raise AssertionError(f"service '{service_name}' has unsupported build args format")


def _service(compose: dict[str, Any], service_name: str) -> dict[str, Any]:
    services = compose.get("services")
    if not isinstance(services, dict):
        raise AssertionError("docker-compose.yml missing services map")
    service = services.get(service_name)
    if not isinstance(service, dict):
        raise AssertionError(f"service '{service_name}' not found")
    return service


@pytest.fixture(autouse=True)
def flush_rate_limits() -> None:
    """Override redis-dependent autouse fixture in conftest for this module."""
    return None


def test_keycloak_admin_lockout_guard() -> None:
    compose = _load_compose()
    keycloak_env = _service_env(compose, "keycloak")
    assert "KEYCLOAK_ADMIN" in keycloak_env, (
        "Keycloak bootstrap admin is missing. Set KEYCLOAK_ADMIN explicitly in docker-compose.yml."
    )


def test_frontend_next_public_api_url_is_browser_resolvable() -> None:
    compose = _load_compose()
    frontend_env = _service_env(compose, "frontend")
    frontend_build_args = _service_build_args(compose, "frontend")
    api_url = frontend_env.get("NEXT_PUBLIC_API_URL")
    assert api_url, (
        "NEXT_PUBLIC_API_URL is missing for the frontend service. "
        "It must be browser-resolvable (localhost or relative path)."
    )
    assert "nginx-gateway" not in str(api_url), (
        "NEXT_PUBLIC_API_URL points at an internal Docker hostname. "
        "Use localhost or a relative path instead of nginx-gateway."
    )
    assert api_url == "/api", (
        "NEXT_PUBLIC_API_URL must be same-origin /api so HTTPS localhost does not "
        "make browser requests to http://localhost/api and trigger CORS preflight redirects."
    )
    assert frontend_build_args.get("NEXT_PUBLIC_API_URL") == "/api", (
        "The frontend build arg for NEXT_PUBLIC_API_URL must also be /api because "
        "Next.js inlines NEXT_PUBLIC_* values at build time."
    )


def test_frontend_server_auth_routes_call_backend_directly() -> None:
    compose = _load_compose()
    frontend_env = _service_env(compose, "frontend")
    backend_url = frontend_env.get("BACKEND_URL")
    assert backend_url == "http://backend:8000", (
        "Next.js auth route handlers must call FastAPI directly inside Docker. "
        "Calling nginx-gateway over HTTP can hit the HTTP-to-HTTPS redirect and make "
        "/api/auth/session return 500 after login."
    )


def test_keycloak_nginx_relative_path_alignment() -> None:
    compose = _load_compose()
    keycloak_env = _service_env(compose, "keycloak")
    assert keycloak_env.get("KC_HTTP_RELATIVE_PATH") == "/auth", (
        "KC_HTTP_RELATIVE_PATH must be set to /auth to match the Nginx reverse proxy."
    )


def test_keycloak_master_realm_bootstrap_service() -> None:
    compose = _load_compose()
    bootstrap = _service(compose, "keycloak-bootstrap")
    bootstrap_env = _service_env(compose, "keycloak-bootstrap")
    depends_on = bootstrap.get("depends_on")

    assert bootstrap.get("image") == "quay.io/keycloak/keycloak:24.0.0"
    assert bootstrap_env.get("KEYCLOAK_URL") == "http://keycloak:8080/auth"
    assert isinstance(depends_on, dict)
    assert depends_on.get("keycloak", {}).get("condition") == "service_healthy"

    script_path = _repo_root() / "keycloak" / "bootstrap" / "bootstrap-master-realm.sh"
    script = script_path.read_text(encoding="utf-8")
    assert "--realm master" in script
    assert "-r master" in script
    assert "security-admin-console" in script
    assert "https://localhost/auth/admin/master/console/*" in script
    assert "https://wimsbfp.tech/auth/admin/master/console/*" in script