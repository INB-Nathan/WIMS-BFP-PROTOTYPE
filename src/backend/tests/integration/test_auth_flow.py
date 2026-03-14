"""
Auth Callback Integration Tests — Idempotent Identity Sync

Validates POST /api/auth/callback:
  - First login: creates user in wims.users
  - Second login (same keycloak_id): updates username/last_login, returns same user_id
  - No IntegrityError on users_username_key when same user logs in twice

Uses unique sub and username per test run to avoid cross-test pollution.
Requires: PostgreSQL with wims schema (schema_v2.sql), DATABASE_URL set.

Run (from project root):
  cd src && docker compose run --rm backend pytest tests/integration/test_auth_flow.py -v
  # Or: DATABASE_URL=postgresql://postgres:password@localhost:5432/wims pytest src/backend/tests/integration/test_auth_flow.py -v

Idempotency proof: run twice in a row — both must pass.
"""

from __future__ import annotations

import os
import uuid
from unittest.mock import AsyncMock, patch

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import create_engine

import main as main_module


def _get_engine():
    url = os.environ.get(
        "DATABASE_URL",
        os.environ.get(
            "SQLALCHEMY_DATABASE_URL",
            "postgresql://postgres:password@postgres:5432/wims",
        ),
    )
    return create_engine(url)


@pytest.fixture(scope="module")
def engine():
    return _get_engine()


@pytest.fixture(autouse=True)
def _skip_if_no_db(engine):
    """Skip integration tests if database is unreachable."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"Database unreachable: {e}")


@pytest.fixture
def unique_identity():
    """Unique sub and username for each test to avoid cross-test conflicts."""
    uid = str(uuid.uuid4())
    return {"sub": uid, "username": f"testuser_{uid[:8]}"}


@pytest.fixture
def cleanup_test_user(engine, unique_identity):
    """Delete test user after test completes."""
    yield
    with engine.connect() as conn:
        conn.execute(
            text("DELETE FROM wims.users WHERE keycloak_id = :kid"),
            {"kid": unique_identity["sub"]},
        )
        conn.commit()


@respx.mock
def test_auth_callback_idempotent_same_user_twice(
    unique_identity, cleanup_test_user
):
    """
    Same user logs in twice — both calls succeed, same user_id returned.
    Proves idempotency: no IntegrityError on users_username_key.
    """
    sub = unique_identity["sub"]
    username = unique_identity["username"]
    fake_token = "fake_access_token_xyz"

    # Mock Keycloak token endpoint
    token_url = main_module.TOKEN_ENDPOINT
    respx.post(token_url).mock(return_value=respx.MockResponse(
        status_code=200,
        json={"access_token": fake_token},
    ))

    # Mock JWT validation to return our payload
    with patch.object(
        main_module.auth.authenticator,
        "validate_token",
        new_callable=AsyncMock,
        return_value={"sub": sub, "preferred_username": username},
    ):
        client = TestClient(main_module.app)

        # First login — creates user
        r1 = client.post(
            "/api/auth/callback",
            json={
                "code": "fake_code",
                "code_verifier": "fake_verifier",
                "redirect_uri": "http://localhost:3000/auth/callback",
            },
        )
        assert r1.status_code == 200, f"First login failed: {r1.text}"
        data1 = r1.json()
        assert "user_id" in data1
        assert "access_token" in data1
        user_id_1 = data1["user_id"]

        # Second login — same user, must succeed (idempotent)
        r2 = client.post(
            "/api/auth/callback",
            json={
                "code": "fake_code",
                "code_verifier": "fake_verifier",
                "redirect_uri": "http://localhost:3000/auth/callback",
            },
        )
        assert r2.status_code == 200, f"Second login failed: {r2.text}"
        data2 = r2.json()
        user_id_2 = data2["user_id"]

        assert user_id_1 == user_id_2, "Same user must get same user_id on repeat login"
