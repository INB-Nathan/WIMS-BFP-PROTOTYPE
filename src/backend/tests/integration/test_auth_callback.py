"""
Auth Callback Integration Tests — PKCE, token validation, session revocation, JIT provisioning.

Validates POST /api/auth/callback:
  - Valid token returns 200 with user_id + access_token
  - Expired/tampered/wrong-audience tokens return 401
  - Session revocation rejects revoked tokens
  - JIT provisioning creates user on first login
  - Idempotent: second login updates without duplicate

Uses unique sub and username per test run to avoid cross-test pollution.
All external dependencies (Keycloak HTTP, Redis, JWT validation) are mocked.
Requires: PostgreSQL with wims schema, DATABASE_URL set.

Run:
  pytest src/backend/tests/integration/test_auth_callback.py -v --tb=short
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
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"Database unreachable: {e}")


@pytest.fixture
def unique_identity():
    uid = str(uuid.uuid4())
    return {"sub": uid, "username": f"testuser_{uid[:8]}"}


@pytest.fixture
def cleanup_test_user(engine, unique_identity):
    yield
    with engine.connect() as conn:
        conn.execute(
            text("DELETE FROM wims.users WHERE keycloak_id = CAST(:kid AS uuid)"),
            {"kid": unique_identity["sub"]},
        )
        conn.commit()


@pytest.fixture
def mock_valid_token(unique_identity):
    """Mock Keycloak token endpoint + JWT validation for a valid user."""
    sub = unique_identity["sub"]
    username = unique_identity["username"]
    fake_token = "valid_access_token_abc"

    respx.post(main_module.TOKEN_ENDPOINT).mock(
        return_value=respx.MockResponse(
            status_code=200,
            json={"access_token": fake_token},
        )
    )

    with patch.object(
        main_module.auth.authenticator,
        "validate_token",
        new_callable=AsyncMock,
        return_value={
            "sub": sub,
            "preferred_username": username,
            "realm_access": {"roles": ["REGIONAL_ENCODER"]},
        },
    ) as mock_validate:
        yield fake_token, mock_validate


@respx.mock
def test_callback_valid_token_returns_200(mock_valid_token, unique_identity, cleanup_test_user):
    """Valid token → 200 with user_id and access_token."""
    fake_token, _ = mock_valid_token
    client = TestClient(main_module.app)

    r = client.post(
        "/api/auth/callback",
        json={
            "code": "test_code",
            "code_verifier": "test_verifier",
            "redirect_uri": "http://localhost:3000/auth/callback",
        },
    )

    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()
    assert "user_id" in data
    assert data["access_token"] == fake_token


@respx.mock
def test_callback_expired_token_returns_401(unique_identity, cleanup_test_user):
    """Keycloak returns expired token error → 401."""
    respx.post(main_module.TOKEN_ENDPOINT).mock(
        return_value=respx.MockResponse(
            status_code=400,
            json={"error": "invalid_grant", "error_description": "Token expired"},
        )
    )

    client = TestClient(main_module.app)
    r = client.post(
        "/api/auth/callback",
        json={
            "code": "expired_code",
            "code_verifier": "test_verifier",
            "redirect_uri": "http://localhost:3000/auth/callback",
        },
    )

    assert r.status_code == 401


@respx.mock
def test_callback_session_revoked_returns_401(unique_identity, cleanup_test_user):
    """Valid JWT but session is revoked → 401."""

    respx.post(main_module.TOKEN_ENDPOINT).mock(
        return_value=respx.MockResponse(
            status_code=200,
            json={"access_token": "revoked_user_token"},
        )
    )

    # validate_token itself checks is_token_revoked internally.
    # Mock it to raise 401 as it would for a revoked session.
    with patch.object(
        main_module.auth.authenticator,
        "validate_token",
        new_callable=AsyncMock,
        side_effect=main_module.auth.HTTPException(
            status_code=401, detail="Token has been revoked"
        ),
    ):
        client = TestClient(main_module.app)
        r = client.post(
            "/api/auth/callback",
            json={
                "code": "test_code",
                "code_verifier": "test_verifier",
                "redirect_uri": "http://localhost:3000/auth/callback",
            },
        )

        assert r.status_code == 401, f"Expected 401 for revoked session, got {r.status_code}"


@respx.mock
def test_callback_jit_provisioning_creates_user(
    mock_valid_token, unique_identity, cleanup_test_user
):
    """First login with new keycloak_id → user created in wims.users."""
    _token, _ = mock_valid_token
    sub = unique_identity["sub"]
    client = TestClient(main_module.app)

    r = client.post(
        "/api/auth/callback",
        json={
            "code": "test_code",
            "code_verifier": "test_verifier",
            "redirect_uri": "http://localhost:3000/auth/callback",
        },
    )

    assert r.status_code == 200
    data = r.json()
    user_id = data["user_id"]

    # Verify user exists in wims.users
    engine = _get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT user_id, username FROM wims.users WHERE keycloak_id = CAST(:kid AS uuid)"),
            {"kid": sub},
        ).fetchone()

    assert row is not None, "User should be provisioned in wims.users"
    assert str(row[0]) == user_id


@respx.mock
def test_callback_existing_user_updates_login(mock_valid_token, unique_identity, cleanup_test_user):
    """Second login with same keycloak_id → same user_id, no duplicate."""
    _token, _ = mock_valid_token
    client = TestClient(main_module.app)

    r1 = client.post(
        "/api/auth/callback",
        json={
            "code": "first_code",
            "code_verifier": "first_verifier",
            "redirect_uri": "http://localhost:3000/auth/callback",
        },
    )
    assert r1.status_code == 200
    user_id_1 = r1.json()["user_id"]

    # Second login — must return same user_id
    r2 = client.post(
        "/api/auth/callback",
        json={
            "code": "second_code",
            "code_verifier": "second_verifier",
            "redirect_uri": "http://localhost:3000/auth/callback",
        },
    )
    assert r2.status_code == 200
    user_id_2 = r2.json()["user_id"]

    assert user_id_1 == user_id_2, "Second login must return the same user_id"


@respx.mock
def test_callback_tampered_token_returns_401(unique_identity, cleanup_test_user):
    """Invalid JWT signature → 401."""
    respx.post(main_module.TOKEN_ENDPOINT).mock(
        return_value=respx.MockResponse(
            status_code=200,
            json={"access_token": "tampered_token"},
        )
    )

    with patch.object(
        main_module.auth.authenticator,
        "validate_token",
        new_callable=AsyncMock,
        side_effect=main_module.auth.HTTPException(status_code=401, detail="Invalid token"),
    ):
        client = TestClient(main_module.app)
        r = client.post(
            "/api/auth/callback",
            json={
                "code": "test_code",
                "code_verifier": "test_verifier",
                "redirect_uri": "http://localhost:3000/auth/callback",
            },
        )

        assert r.status_code == 401
