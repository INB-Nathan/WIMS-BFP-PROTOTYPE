"""Unit tests for PII decryption gate in regional encoder list view.

Covers:
  1. OpenBao-style row: pii_blob_enc present, encryption_iv NULL → decrypts.
  2. env_aesgcm-style row: both pii_blob_enc and encryption_iv present → decrypts.
  3. No blob row: pii_blob_enc NULL → skips decrypt.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock

from api.routes.regional.encoder import get_regional_incidents


def _make_row(
    incident_id: int = 1,
    pii_blob_enc: str | None = "enc_blob",
    encryption_iv: str | None = "iv_b64",
) -> tuple:
    """Build a row tuple matching the list-endpoint SELECT column order."""
    now = datetime(2025, 6, 12, 10, 0, 0)
    return (
        incident_id,  #  0: incident_id
        "DRAFT",  #  1: verification_status
        now,  #  2: created_at
        now,  #  3: notification_dt
        "STRUCTURAL",  #  4: general_category
        "FIRST_ALARM",  #  5: alarm_level
        "Station Alpha",  #  6: fire_station_name
        None,  #  7: structures_affected
        None,  #  8: households_affected
        None,  #  9: families_affected
        None,  # 10: individuals_affected
        None,  # 11: vehicles_affected
        None,  # 12: responder_type
        None,  # 13: fire_origin
        None,  # 14: extent_of_damage
        None,  # 15: sub_category
        None,  # 16: owner_name (plaintext fallback)
        None,  # 17: establishment_name
        None,  # 18: caller_name (plaintext fallback)
        None,  # 19: caller_number (plaintext fallback)
        None,  # 20: street_address
        pii_blob_enc,  # 21: pii_blob_enc
        encryption_iv,  # 22: encryption_iv
        False,  # 23: is_wildland
        now,  # 24: updated_at
        None,  # 25: city_municipality
        None,  # 26: province_district
        "Region I",  # 27: region_name
    )


def _make_user() -> dict:
    return {"user_id": "aaaaaaaa-bbbb-cccc-dddd-000000000001"}


# ── OpenBao-style: encrypted blob present, encryption_iv NULL ─────────────────


def test_list_decrypts_openbao_style_null_iv(monkeypatch):
    """Regression Q1/T4: rows with pii_blob_enc but NULL encryption_iv must decrypt."""
    row = _make_row(pii_blob_enc="encrypted_blob_data", encryption_iv=None)

    mock_db = MagicMock()
    mock_db.execute.return_value.fetchall.return_value = [row]
    mock_db.execute.return_value.scalar.return_value = 1

    mock_provider = MagicMock()
    mock_provider.decrypt_json.return_value = {
        "owner_name": "OpenBao Owner",
        "caller_name": "OpenBao Caller",
        "caller_number": "09991112222",
    }

    monkeypatch.setattr(
        "api.routes.regional.encoder.get_crypto_provider",
        lambda: mock_provider,
    )

    result = get_regional_incidents(user=_make_user(), db=mock_db)

    # Gate must open — decrypt_json must be called
    mock_provider.decrypt_json.assert_called_once()
    # Decrypted values must appear in output
    item = result["items"][0]
    assert item["owner_name"] == "OpenBao Owner"
    assert item["caller_name"] == "OpenBao Caller"
    assert item["caller_number"] == "09991112222"
    assert item["has_sensitive_data"] is True


# ── env_aesgcm-style: both pii_blob_enc and encryption_iv present ─────────────


def test_list_decrypts_aesgcm_style_both_present(monkeypatch):
    """Rows with both pii_blob_enc and encryption_iv must decrypt (existing path)."""
    row = _make_row(pii_blob_enc="enc_blob", encryption_iv="nonce_b64")

    mock_db = MagicMock()
    mock_db.execute.return_value.fetchall.return_value = [row]
    mock_db.execute.return_value.scalar.return_value = 1

    mock_provider = MagicMock()
    mock_provider.decrypt_json.return_value = {
        "owner_name": "AES Owner",
        "caller_name": "AES Caller",
    }

    monkeypatch.setattr(
        "api.routes.regional.encoder.get_crypto_provider",
        lambda: mock_provider,
    )

    result = get_regional_incidents(user=_make_user(), db=mock_db)

    mock_provider.decrypt_json.assert_called_once()
    item = result["items"][0]
    assert item["owner_name"] == "AES Owner"
    assert item["caller_name"] == "AES Caller"
    assert item["has_sensitive_data"] is True


# ── No blob: pii_blob_enc is NULL → skip decrypt ─────────────────────────────


def test_list_skips_decrypt_when_no_blob(monkeypatch):
    """Rows with NULL pii_blob_enc must skip decrypt even if encryption_iv is present."""
    row = _make_row(pii_blob_enc=None, encryption_iv="nonce_b64")

    mock_db = MagicMock()
    mock_db.execute.return_value.fetchall.return_value = [row]
    mock_db.execute.return_value.scalar.return_value = 1

    mock_provider = MagicMock()
    monkeypatch.setattr(
        "api.routes.regional.encoder.get_crypto_provider",
        lambda: mock_provider,
    )

    result = get_regional_incidents(user=_make_user(), db=mock_db)

    # Gate must be closed — decrypt_json must NOT be called
    mock_provider.decrypt_json.assert_not_called()
    item = result["items"][0]
    assert item["has_sensitive_data"] is False
    # Plaintext fallbacks unchanged
    assert item["owner_name"] is None
    assert item["caller_name"] is None
