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
            raise AssertionError(
                f"docker-compose.yml is not valid YAML: {exc}"
            ) from exc
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


@pytest.fixture(autouse=True)
def flush_rate_limits() -> None:
    """Override redis-dependent autouse fixture in conftest for this module."""
    return None


def test_keycloak_admin_lockout_guard() -> None:
    compose = _load_compose()
    keycloak_env = _service_env(compose, "keycloak")
    assert "KEYCLOAK_ADMIN" in keycloak_env, (
        "Keycloak bootstrap admin is missing. "
        "Set KEYCLOAK_ADMIN explicitly in docker-compose.yml."
    )


def test_frontend_next_public_api_url_is_browser_resolvable() -> None:
    compose = _load_compose()
    frontend_env = _service_env(compose, "frontend")
    api_url = frontend_env.get("NEXT_PUBLIC_API_URL")
    assert api_url, (
        "NEXT_PUBLIC_API_URL is missing for the frontend service. "
        "It must be browser-resolvable (localhost or relative path)."
    )
    assert "nginx-gateway" not in str(api_url), (
        "NEXT_PUBLIC_API_URL points at an internal Docker hostname. "
        "Use localhost or a relative path instead of nginx-gateway."
    )


def test_keycloak_nginx_relative_path_alignment() -> None:
    compose = _load_compose()
    keycloak_env = _service_env(compose, "keycloak")
    assert keycloak_env.get("KC_HTTP_RELATIVE_PATH") == "/auth", (
        "KC_HTTP_RELATIVE_PATH must be set to /auth to match the Nginx reverse proxy."
    )
