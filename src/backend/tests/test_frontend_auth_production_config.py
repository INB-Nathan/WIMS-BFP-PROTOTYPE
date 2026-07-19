from pathlib import Path

import yaml

SRC = Path(__file__).resolve().parents[2]


def test_frontend_refresh_uses_public_keycloak_issuer_in_production():
    compose = yaml.safe_load((SRC / "docker-compose.prod.yml").read_text())

    environment = compose["services"]["frontend"]["environment"]
    assert "AUTH_SERVER_URL=${PUBLIC_BASE_URL}/auth" in environment
    assert "AUTH_SERVER_URL=http://nginx-gateway/auth" not in environment
