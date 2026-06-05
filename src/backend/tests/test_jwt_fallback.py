"""
JWT Key Fallback Unit Tests — to_pem guard + refreshed-JWKS retry

Validates the explicit hasattr(to_pem) guard added in PR #213 (issue #198).
Tests the candidate-key loop and refreshed-JWKS fallback path in
KeycloakAuthenticator.validate_token() without requiring Docker services.

Markers: unit (no Docker required — all external calls mocked)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_key_with_pem():
    """A JWK key dict whose constructed object has to_pem()."""
    return {"kid": "valid-key-1", "kty": "RSA", "use": "sig", "alg": "RS256"}


@pytest.fixture
def mock_key_no_pem():
    """A JWK key dict whose constructed object lacks to_pem()."""
    return {"kid": "bad-key-2", "kty": "RSA", "use": "sig", "alg": "RS256"}


@pytest.fixture
def mock_keys_multiple(mock_key_with_pem):
    """Two keys: first has no to_pem, second is valid."""
    return [
        {"kid": "bad-key-1", "kty": "RSA", "use": "sig", "alg": "RS256"},
        mock_key_with_pem,
    ]


@pytest.fixture
def mock_valid_payload():
    return {
        "sub": "user-uuid-1234",
        "exp": 2000000000,
        "iat": 1700000000,
        "iss": "http://localhost:8080/auth/realms/bfp/",
        "aud": "wims-web",
        "azp": "wims-web",
        "preferred_username": "testuser",
        "email": "test@example.com",
        "realm_access": {"roles": ["REGIONAL_ENCODER"]},
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# A token that looks enough like a JWT for get_unverified_header to not crash,
# but whose real header is "eyJraWQiOiAidmFsaWQta2V5LTEifQ==" → {"kid":"valid-key-1"}
# We override get_unverified_header in tests anyway, but providing a valid-looking
# token avoids the "Not enough segments" JWSError on the fallback path.
FAKE_JWT_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake-signature"


def _make_constructed_key(has_pem: bool):
    """Return a mock object mirroring jwk.construct() output."""
    key = MagicMock()
    if has_pem:
        key.to_pem.return_value = b"fake-pem-key-bytes"
    else:
        del key.to_pem  # hasattr(to_pem) returns False
    return key


def _setup_authenticator(keys, oidc_config=None):
    """Pre-populate the singleton authenticator's JWKS/oidc cache."""
    import auth as auth_module
    authenticator = auth_module.authenticator
    authenticator.jwks = {"keys": keys}
    authenticator.jwks_fetched_at = 9999999999.0  # far future — cached
    authenticator.oidc_config = oidc_config or {
        "jwks_uri": "http://keycloak:8080/auth/realms/bfp/protocol/openid-connect/certs"
    }
    return authenticator


# ---------------------------------------------------------------------------
# Tests — using @patch decorators for clean mock lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
@patch("auth.jwt.decode")
@patch("auth.jwk.construct")
@patch("auth.jwt.get_unverified_header", return_value={"kid": "valid-key-1"})
@patch.object(
    __import__("auth").authenticator, "_fetch_jwks", new_callable=AsyncMock
)
@patch.object(
    __import__("auth").authenticator, "_fetch_oidc_config", new_callable=AsyncMock
)
async def test_valid_key_with_to_pem_succeeds(
    mock_fetch_oidc,
    mock_fetch_jwks,
    mock_get_header,
    mock_construct,
    mock_decode,
    mock_key_with_pem,
    mock_valid_payload,
):
    """Candidate key has to_pem() — token decodes and returns payload."""
    authenticator = _setup_authenticator([mock_key_with_pem])
    mock_construct.return_value = _make_constructed_key(True)
    mock_decode.return_value = mock_valid_payload

    result = await authenticator.validate_token(FAKE_JWT_TOKEN)

    assert result["sub"] == mock_valid_payload["sub"]
    assert result["azp"] == "wims-web"
    mock_construct.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
@patch("auth.jwt.decode")
@patch("auth.jwk.construct")
@patch("auth.jwt.get_unverified_header", return_value={"kid": "valid-key-1"})
@patch.object(
    __import__("auth").authenticator, "_fetch_jwks", new_callable=AsyncMock
)
@patch.object(
    __import__("auth").authenticator, "_fetch_oidc_config", new_callable=AsyncMock
)
async def test_key_without_to_pem_tries_next_key(
    mock_fetch_oidc,
    mock_fetch_jwks,
    mock_get_header,
    mock_construct,
    mock_decode,
    mock_keys_multiple,
    mock_valid_payload,
):
    """First key lacks to_pem() — loop continues to second key which has it."""
    authenticator = _setup_authenticator(mock_keys_multiple)
    # First key: no to_pem; second key: has to_pem
    mock_construct.side_effect = [
        _make_constructed_key(False),
        _make_constructed_key(True),
    ]
    mock_decode.return_value = mock_valid_payload

    result = await authenticator.validate_token(FAKE_JWT_TOKEN)

    assert result["sub"] == mock_valid_payload["sub"]
    assert mock_construct.call_count == 2


@pytest.mark.unit
@pytest.mark.asyncio
@patch("auth.jwt.decode")
@patch("auth.jwk.construct")
@patch("auth.jwt.get_unverified_header", return_value={"kid": "bad-only"})
@patch.object(
    __import__("auth").authenticator, "_fetch_oidc_config", new_callable=AsyncMock
)
async def test_no_to_pem_on_any_candidate_key_falls_back_to_refreshed_jwks(
    mock_fetch_oidc,
    mock_get_header,
    mock_construct,
    mock_decode,
    mock_key_with_pem,
    mock_valid_payload,
):
    """All candidate keys lack to_pem — JWKS is force-refreshed and succeeds."""
    import auth as auth_module
    authenticator = auth_module.authenticator

    # Initial JWKS: one bad key
    authenticator.jwks = {
        "keys": [{"kid": "bad-only", "kty": "RSA", "use": "sig", "alg": "RS256"}]
    }
    authenticator.jwks_fetched_at = 9999999999.0
    authenticator.oidc_config = {
        "jwks_uri": "http://keycloak:8080/auth/realms/bfp/protocol/openid-connect/certs"
    }

    # _fetch_jwks with force_refresh=True replaces keys with good one
    async def fetch_jwks_fresh(force_refresh=False):
        if force_refresh:
            authenticator.jwks = {"keys": [mock_key_with_pem]}

    fetch_jwks_mock = AsyncMock(side_effect=fetch_jwks_fresh)
    with patch.object(authenticator, "_fetch_jwks", new=fetch_jwks_mock):
        # First key: no to_pem (candidate loop fails)
        # Second key: has to_pem (refreshed loop succeeds)
        mock_construct.side_effect = [
            _make_constructed_key(False),
            _make_constructed_key(True),
        ]
        mock_decode.return_value = mock_valid_payload

        result = await authenticator.validate_token(FAKE_JWT_TOKEN)

        assert result["sub"] == mock_valid_payload["sub"]
        assert mock_construct.call_count == 2
        fetch_jwks_mock.assert_any_call(force_refresh=True)


@pytest.mark.unit
@pytest.mark.asyncio
@patch("auth.jwt.decode")
@patch("auth.jwk.construct")
@patch("auth.jwt.get_unverified_header", return_value={"kid": "bad-1"})
@patch.object(
    __import__("auth").authenticator, "_fetch_oidc_config", new_callable=AsyncMock
)
async def test_no_to_pem_on_any_key_in_both_loops_returns_401(
    mock_fetch_oidc,
    mock_get_header,
    mock_construct,
    mock_decode,
):
    """No key in either candidate or refreshed loop has to_pem → HTTP 401."""
    import auth as auth_module
    authenticator = auth_module.authenticator

    bad_keys = [{"kid": "bad-1", "kty": "RSA", "use": "sig", "alg": "RS256"}]
    authenticator.jwks = {"keys": bad_keys}
    authenticator.jwks_fetched_at = 9999999999.0
    authenticator.oidc_config = {
        "jwks_uri": "http://keycloak:8080/auth/realms/bfp/protocol/openid-connect/certs"
    }

    async def fetch_jwks_still_bad(force_refresh=False):
        if force_refresh:
            authenticator.jwks = {"keys": bad_keys}  # still no to_pem

    fetch_jwks_mock = AsyncMock(side_effect=fetch_jwks_still_bad)
    with patch.object(authenticator, "_fetch_jwks", new=fetch_jwks_mock):
        mock_construct.side_effect = [
            _make_constructed_key(False),
            _make_constructed_key(False),
        ]

        with pytest.raises(HTTPException) as exc_info:
            await authenticator.validate_token(FAKE_JWT_TOKEN)
        assert exc_info.value.status_code == 401
        assert "JWT validation failed" in exc_info.value.detail


@pytest.mark.unit
@pytest.mark.asyncio
@patch("auth.jwt.decode")
@patch("auth.jwk.construct")
@patch("auth.jwt.get_unverified_header", return_value={"kid": "valid-key-1"})
@patch.object(
    __import__("auth").authenticator, "_fetch_jwks", new_callable=AsyncMock
)
@patch.object(
    __import__("auth").authenticator, "_fetch_oidc_config", new_callable=AsyncMock
)
async def test_jwt_decode_receives_pem_key_string(
    mock_fetch_oidc,
    mock_fetch_jwks,
    mock_get_header,
    mock_construct,
    mock_decode,
    mock_key_with_pem,
    mock_valid_payload,
):
    """Prove jwt.decode() receives the PEM-decoded string from to_pem().decode('utf-8')."""
    authenticator = _setup_authenticator([mock_key_with_pem])
    mock_construct.return_value = _make_constructed_key(True)
    mock_decode.return_value = mock_valid_payload

    await authenticator.validate_token(FAKE_JWT_TOKEN)

    # jwt.decode should have been called with the pem string as second positional arg
    call_args = mock_decode.call_args
    pem_arg = call_args[0][1]  # second positional arg is the key
    assert isinstance(pem_arg, str)
    assert pem_arg == "fake-pem-key-bytes"


@pytest.mark.unit
@pytest.mark.asyncio
@patch("auth.jwt.decode")
@patch("auth.jwk.construct")
@patch("auth.jwt.get_unverified_header", return_value={"kid": "valid-key-1"})
@patch.object(
    __import__("auth").authenticator, "_fetch_jwks", new_callable=AsyncMock
)
@patch.object(
    __import__("auth").authenticator, "_fetch_oidc_config", new_callable=AsyncMock
)
async def test_jwt_error_on_decode_failure_in_candidate_loop_tries_next(
    mock_fetch_oidc,
    mock_fetch_jwks,
    mock_get_header,
    mock_construct,
    mock_decode,
    mock_keys_multiple,
    mock_valid_payload,
):
    """First key decodes OK but jwt.decode raises JWTError → second key succeeds."""
    from jose import JWTError

    authenticator = _setup_authenticator(mock_keys_multiple)
    # Both keys have to_pem; first jwt.decode raises JWTError, second succeeds
    mock_construct.side_effect = [
        _make_constructed_key(True),
        _make_constructed_key(True),
    ]
    mock_decode.side_effect = [
        JWTError("Signature verification failed"),
        mock_valid_payload,
    ]

    result = await authenticator.validate_token(FAKE_JWT_TOKEN)
    assert result["sub"] == mock_valid_payload["sub"]
    assert mock_construct.call_count == 2
    assert mock_decode.call_count == 2
