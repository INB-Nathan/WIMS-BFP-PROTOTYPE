"""Focused optional-auth behavior for civilian photo ownership."""

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import auth


def _request_with_cookie(token: str = "token") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/civilian/reports/1/photos",
            "headers": [(b"cookie", f"access_token={token}".encode())],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
        }
    )


def _request_without_cookie() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
        }
    )


@pytest.mark.asyncio
async def test_optional_auth_missing_cookie_is_anonymous():
    assert await auth.optional_auth(_request_without_cookie(), object()) is None


@pytest.mark.asyncio
async def test_optional_auth_valid_reporter_returns_resolved_user(monkeypatch):
    request = _request_with_cookie("reporter-token")
    db = object()
    payload = {"sub": "kc-reporter"}
    resolved_user = {
        "user_id": "user-1",
        "keycloak_id": "kc-reporter",
        "role": "CIVILIAN_REPORTER",
    }

    async def validate_token(token):
        assert token == "reporter-token"
        return payload

    async def resolve_user(dep_request, token_payload, dep_db):
        assert dep_request is request
        assert token_payload == payload
        assert dep_db is db
        return resolved_user

    monkeypatch.setattr(auth.authenticator, "validate_token", validate_token)
    monkeypatch.setattr(auth, "get_current_wims_user", resolve_user)

    assert await auth.optional_auth(request, db) == resolved_user


@pytest.mark.asyncio
async def test_optional_auth_valid_non_reporter_returns_resolved_user(monkeypatch):
    request = _request_with_cookie("analyst-token")
    payload = {"sub": "kc-analyst"}
    resolved_user = {
        "user_id": "user-2",
        "keycloak_id": "kc-analyst",
        "role": "NATIONAL_ANALYST",
    }

    async def validate_token(_token):
        return payload

    async def resolve_user(_request, token_payload, _db):
        assert token_payload == payload
        return resolved_user

    monkeypatch.setattr(auth.authenticator, "validate_token", validate_token)
    monkeypatch.setattr(auth, "get_current_wims_user", resolve_user)

    assert await auth.optional_auth(request, object()) == resolved_user


@pytest.mark.asyncio
async def test_optional_auth_expired_cookie_propagates_401(monkeypatch):
    async def raise_401(_token):
        raise HTTPException(status_code=401, detail="Token expired")

    monkeypatch.setattr(auth.authenticator, "validate_token", raise_401)
    with pytest.raises(HTTPException) as exc_info:
        await auth.optional_auth(_request_with_cookie("expired-token"), object())
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Token expired"


@pytest.mark.asyncio
async def test_optional_auth_malformed_cookie_propagates_401(monkeypatch):
    async def raise_401(_token):
        raise HTTPException(status_code=401, detail="Invalid token: malformed sub")

    monkeypatch.setattr(auth.authenticator, "validate_token", raise_401)
    with pytest.raises(HTTPException) as exc_info:
        await auth.optional_auth(_request_with_cookie("malformed-token"), object())
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid token: malformed sub"


@pytest.mark.asyncio
async def test_optional_auth_invalid_audience_cookie_propagates_401(monkeypatch):
    async def raise_401(_token):
        raise HTTPException(status_code=401, detail="Invalid token: JWT validation failed")

    monkeypatch.setattr(auth.authenticator, "validate_token", raise_401)
    with pytest.raises(HTTPException) as exc_info:
        await auth.optional_auth(_request_with_cookie("wrong-audience-token"), object())
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid token: JWT validation failed"


@pytest.mark.asyncio
async def test_optional_auth_unresolved_user_propagates_403(monkeypatch):
    payload = {"sub": "kc-missing"}

    async def validate_token(_token):
        return payload

    async def resolve_user(_request, token_payload, _db):
        assert token_payload == payload
        raise HTTPException(status_code=403, detail="User not found in WIMS")

    monkeypatch.setattr(auth.authenticator, "validate_token", validate_token)
    monkeypatch.setattr(auth, "get_current_wims_user", resolve_user)

    with pytest.raises(HTTPException) as exc_info:
        await auth.optional_auth(_request_with_cookie("missing-user-token"), object())
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "User not found in WIMS"


@pytest.mark.asyncio
async def test_optional_auth_preserves_identity_provider_failures(monkeypatch):
    async def raise_503(_token):
        raise HTTPException(status_code=503, detail="idp down")

    monkeypatch.setattr(auth.authenticator, "validate_token", raise_503)
    with pytest.raises(HTTPException) as exc_info:
        await auth.optional_auth(_request_with_cookie(), object())
    assert exc_info.value.status_code == 503
