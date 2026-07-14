"""Unit tests for the OpenBao Transit audit-export signing contract."""

import base64
from unittest.mock import MagicMock

import pytest

from services.kms.openbao_client import KmsSignature, OpenBaoClient, OpenBaoClientError


_SIGNATURE = "vault:v3:" + base64.b64encode(b"der-signature").decode("ascii")


def _client(monkeypatch) -> OpenBaoClient:
    monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
    monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
    return OpenBaoClient()


def test_sign_posts_base64_input_and_parses_key_version(monkeypatch):
    client = _client(monkeypatch)
    client._request = MagicMock(return_value={"data": {"signature": _SIGNATURE}})

    result = client.sign("audit-export-signer", b"manifest-bytes")

    assert result == KmsSignature(signature=_SIGNATURE, key_version=3)
    client._request.assert_called_once_with(
        "POST",
        "sign/audit-export-signer",
        json_body={
            "input": base64.b64encode(b"manifest-bytes").decode("ascii"),
            "hash_algorithm": "sha2-256",
        },
    )


@pytest.mark.parametrize(
    "signature",
    [
        "vault:v1/not-a-valid-envelope",
        "vault:v0:YWJj",
        "vault:v1:not base64",
        "vault:v1:",
    ],
)
def test_sign_rejects_malformed_signature(monkeypatch, signature):
    client = _client(monkeypatch)
    client._request = MagicMock(return_value={"data": {"signature": signature}})

    with pytest.raises(OpenBaoClientError, match="signature"):
        client.sign("audit-export-signer", b"manifest-bytes")


def test_verify_posts_signature_and_returns_boolean(monkeypatch):
    client = _client(monkeypatch)
    client._request = MagicMock(return_value={"data": {"valid": True}})

    result = client.verify(
        "audit-export-signer",
        b"manifest-bytes",
        _SIGNATURE,
        hash_algorithm="sha2-256",
    )

    assert result is True
    client._request.assert_called_once_with(
        "POST",
        "verify/audit-export-signer",
        json_body={
            "input": base64.b64encode(b"manifest-bytes").decode("ascii"),
            "signature": _SIGNATURE,
            "hash_algorithm": "sha2-256",
        },
    )


def test_verify_returns_false_for_valid_openbao_negative_result(monkeypatch):
    client = _client(monkeypatch)
    client._request = MagicMock(return_value={"data": {"valid": False}})

    assert client.verify("audit-export-signer", b"manifest-bytes", _SIGNATURE) is False


def test_verify_forwards_requested_hash_algorithm(monkeypatch):
    client = _client(monkeypatch)
    client._request = MagicMock(return_value={"data": {"valid": False}})

    client.verify("audit-export-signer", b"manifest-bytes", _SIGNATURE, hash_algorithm="sha1")

    assert client._request.call_args.kwargs["json_body"]["hash_algorithm"] == "sha1"


@pytest.mark.parametrize(
    "method, call",
    [
        ("sign", lambda client: client.sign("audit-export-signer", b"manifest-bytes")),
        (
            "verify",
            lambda client: client.verify("audit-export-signer", b"manifest-bytes", _SIGNATURE),
        ),
    ],
)
def test_sign_and_verify_propagate_openbao_errors(monkeypatch, method, call):
    client = _client(monkeypatch)
    client._request = MagicMock(side_effect=OpenBaoClientError("OpenBao unavailable"))

    with pytest.raises(OpenBaoClientError, match="unavailable"):
        call(client)
