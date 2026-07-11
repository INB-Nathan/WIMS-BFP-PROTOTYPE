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


async def _raise(status_code: int):
    raise HTTPException(status_code=status_code, detail="test")


async def _payload(_token):
    return {"sub": "test"}


@pytest.mark.asyncio
async def test_optional_auth_invalid_cookie_propagates_http_exception(monkeypatch):
    monkeypatch.setattr(auth.authenticator, "validate_token", lambda _token: _raise(401))
    with pytest.raises(HTTPException) as exc_info:
        await auth.optional_auth(_request_with_cookie("invalid"), object())
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_optional_auth_preserves_identity_provider_failures(monkeypatch):
    async def raise_503(_token):
        raise HTTPException(status_code=503, detail="idp down")

    monkeypatch.setattr(auth.authenticator, "validate_token", raise_503)
    with pytest.raises(HTTPException) as exc_info:
        await auth.optional_auth(_request_with_cookie(), object())
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_optional_auth_missing_cookie_is_anonymous():
    request = Request(
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
    assert await auth.optional_auth(request, object()) is None
