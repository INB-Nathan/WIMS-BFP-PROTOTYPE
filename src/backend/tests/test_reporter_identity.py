"""Tests for reporter identity separation, encryption, and coarse GeoIP persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from schemas.civilian import CivilianReportCreate
from schemas.geoip import CoarseIpEvidence, CoarseIpUnavailable
from services.reporter_identity import (
    persist_encrypted_reporter_identity,
    resolve_reporter_identity,
)
from services.geoip_evidence import persist_coarse_ip_evidence


def _body(**overrides) -> CivilianReportCreate:
    values = {
        "latitude": 14.6,
        "longitude": 121.0,
        "category": "STRUCTURAL",
        "safety_status": "I_AM_SAFE",
        "reporter_name": "Ana Reporter",
        "reporter_phone": "09171234567",
        "witness_name": "Wally Witness",
        "witness_phone": "09999999999",
    }
    values.update(overrides)
    return CivilianReportCreate(**values)


def test_anonymous_normal_report_requires_name_and_phone() -> None:
    with pytest.raises(HTTPException) as exc:
        resolve_reporter_identity(MagicMock(), _body(reporter_name=None), None)
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc:
        resolve_reporter_identity(MagicMock(), _body(reporter_phone=None), None)
    assert exc.value.status_code == 422


def test_anonymous_life_safety_requires_name_but_allows_missing_phone() -> None:
    identity = resolve_reporter_identity(
        MagicMock(),
        _body(safety_status="I_NEED_HELP", reporter_phone=None),
        None,
    )
    assert identity.reporter_name == "Ana Reporter"
    assert identity.reporter_phone is None
    assert identity.authenticated is False

    with pytest.raises(HTTPException) as exc:
        resolve_reporter_identity(
            MagicMock(),
            _body(safety_status="SOMEONE_ELSE_NEEDS_HELP", reporter_name=None),
            None,
        )
    assert exc.value.status_code == 422


def test_authenticated_identity_is_server_derived_and_witness_is_untouched() -> None:
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = SimpleNamespace(contact_number="09170000000")
    user = {
        "user_id": "11111111-1111-4111-8111-111111111111",
        "role": "CIVILIAN_REPORTER",
        "given_name": "Server",
        "family_name": "Profile",
    }

    identity = resolve_reporter_identity(
        db,
        _body(reporter_name="Caller Override", reporter_phone="09999999999"),
        user,
    )

    assert identity.reporter_name == "Server Profile"
    assert identity.reporter_phone == "09170000000"
    assert identity.contributor_user_id == user["user_id"]
    assert identity.authenticated is True
    assert _body().witness_name == "Wally Witness"
    assert _body().witness_phone == "09999999999"


def test_authenticated_profile_completion_respects_life_safety_exception() -> None:
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = SimpleNamespace(contact_number=None)
    user = {
        "user_id": "11111111-1111-4111-8111-111111111111",
        "role": "CIVILIAN_REPORTER",
        "given_name": "Server",
        "family_name": "Profile",
    }

    with pytest.raises(HTTPException) as exc:
        resolve_reporter_identity(db, _body(), user)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "PROFILE_INCOMPLETE"
    assert exc.value.detail["missing_fields"] == ["contact_number"]

    identity = resolve_reporter_identity(
        db,
        _body(safety_status="I_NEED_HELP"),
        user,
    )
    assert identity.reporter_phone is None


def test_reporter_snapshot_is_encrypted_with_distinct_aad_and_no_plaintext_write() -> None:
    db = MagicMock()
    identity = resolve_reporter_identity(MagicMock(), _body(), None)
    provider = MagicMock(
        crypto_provider="env_aesgcm",
        current_version=7,
        kms_key_name=None,
    )
    provider.encrypt_json.return_value = ("nonce", "ciphertext")

    with patch("services.reporter_identity.get_crypto_provider", return_value=provider):
        persist_encrypted_reporter_identity(db, 42, identity)

    provider.encrypt_json.assert_called_once_with(
        {
            "reporter_name": "Ana Reporter",
            "reporter_phone": "09171234567",
            "contributor_user_id": None,
            "authenticated": False,
        },
        b"civilian-report:42:reporter-identity:v1",
    )
    sql = str(db.execute.call_args.args[0])
    assert "reporter_pii_blob_enc" in sql
    assert "reporter_name" not in sql
    assert "reporter_phone" not in sql


def test_reporter_encryption_failure_is_fail_closed() -> None:
    db = MagicMock()
    provider = MagicMock()
    provider.encrypt_json.side_effect = RuntimeError("provider unavailable")

    with (
        patch("services.reporter_identity.get_crypto_provider", return_value=provider),
        pytest.raises(HTTPException) as exc,
    ):
        persist_encrypted_reporter_identity(
            db, 42, resolve_reporter_identity(MagicMock(), _body(), None)
        )

    assert exc.value.status_code == 500
    db.execute.assert_not_called()


def test_geoip_success_persists_only_approved_coarse_fields() -> None:
    db = MagicMock()
    evidence = CoarseIpEvidence(
        city="Cebu City",
        province="Cebu",
        latitude=10.3157,
        longitude=123.8854,
        accuracy_m=20_000,
        provider="GeoLite2-City",
        lookup_at=datetime.now(timezone.utc),
    )

    persist_coarse_ip_evidence(db, 42, evidence)

    sql = " ".join(str(db.execute.call_args.args[0]).split())
    params = db.execute.call_args.args[1]
    assert "ST_SetSRID( ST_MakePoint(:longitude, :latitude), 4326 )::geography" in sql
    assert set(params) == {
        "report_id",
        "city",
        "province",
        "latitude",
        "longitude",
        "accuracy_m",
        "provider",
        "lookup_at",
    }


def test_geoip_unavailable_performs_no_write() -> None:
    db = MagicMock()
    persist_coarse_ip_evidence(db, 42, CoarseIpUnavailable(reason="database_unavailable"))
    db.execute.assert_not_called()
