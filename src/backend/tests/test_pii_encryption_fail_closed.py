"""PR #385 — PII encryption fail-closed, analyst decrypt, and schema self-heal.

Tests the three functional fixes:
  1. upload_incident_bundle: fail closed when crypto unavailable + PII present
  2. get_analyst_incident_sensitive_detail: decrypt pii_blob_enc on encrypted rows
  3. Blob metadata never exposed
"""

from __future__ import annotations

from unittest.mock import MagicMock


from api.routes.incidents import (
    get_analyst_incident_sensitive_detail,
    upload_incident_bundle,
)
from schemas.incident_bundle import IncidentBundleCreate
from utils.crypto import SecurityProviderError


# ── Helpers ──────────────────────────────────────────────────────────────────


def _mock_db_execute(*, client_id_exists: bool = True):
    """Return a mocked db with sensible defaults for upload-bundle flows."""
    db = MagicMock()

    assigned_result = MagicMock()
    assigned_result.fetchone.return_value = (1,)

    batch_result = MagicMock()
    batch_result.fetchone.return_value = (7,)

    col_result = MagicMock()
    col_result.fetchone.return_value = (1,) if client_id_exists else (0,)

    inc_result = MagicMock()
    inc_result.fetchone.return_value = (100,)

    none_result = MagicMock()
    none_result.fetchone.return_value = None
    none_result.fetchall.return_value = []

    def _execute(sql, params=None):
        stmt = str(sql)
        if "assigned_region_id" in stmt:
            return assigned_result
        if "data_import_batches" in stmt and "RETURNING batch_id" in stmt:
            return batch_result
        if "information_schema.columns" in stmt:
            return col_result
        if "pg_advisory_xact_lock" in stmt:
            return none_result
        if "client_id" in stmt and "LIMIT 1" in stmt:
            return none_result
        if "INSERT INTO wims.fire_incidents" in stmt and "RETURNING incident_id" in stmt:
            return inc_result
        return none_result

    db.execute.side_effect = _execute
    return db


_incident_row_15 = (
    15,  # incident_id
    "REF-2024-0015",  # reference_number
    "VERIFIED",  # verification_status
    False,  # is_archived
)


def _make_sd_row_legacy():
    """Legacy row: plaintext PII columns populated, no pii_blob_enc."""
    row = MagicMock()
    row._mapping = {
        "incident_id": 15,
        "fire_origin": "Kitchen",
        "extent_of_damage": "Confined to Object/Vehicle",
        "narrative_report": "Legacy narrative report.",
        "prepared_by_officer": "Gwen Tendero",
        "noted_by_officer": "Earl Camama",
        "disposition": "No complaint filed.",
        "caller_name": "Juan Dela Cruz",
        "caller_number": "09171234567",
        "owner_name": "Pedro Reyes",
        "establishment_name": "Nathan Cabrales",
        "occupant_name": "Maria Santos",
        "alarm_timeline": '{"_engines":[{"name":"E1"}]}',
        "casualty_details": "1 minor injury",
        "estimated_damage_php": 50000,
        "pii_blob_enc": None,
        "encryption_iv": None,
        "crypto_provider": None,
        "key_version": None,
    }
    return row


def _make_sd_row_encrypted():
    """Encrypted row: plaintext PII columns NULL, pii_blob_enc populated."""
    row = MagicMock()
    row._mapping = {
        "incident_id": 42,
        "fire_origin": "Living Room",
        "extent_of_damage": "Confined to Room",
        "narrative_report": None,
        "prepared_by_officer": "Officer Smith",
        "noted_by_officer": "Officer Jones",
        "disposition": "Case closed.",
        "caller_name": None,
        "caller_number": None,
        "owner_name": None,
        "establishment_name": "ABC Corp",
        "occupant_name": None,
        "alarm_timeline": None,
        "casualty_details": None,  # NULL in plaintext; value is in encrypted blob
        "estimated_damage_php": None,  # NULL in plaintext; value is in encrypted blob
        "pii_blob_enc": "mock-encrypted-blob-base64",
        "encryption_iv": "mock-iv-base64",
        "crypto_provider": "env_aesgcm",
        "key_version": 1,
    }
    return row


# ── Upload-bundle: PII encryption fail-closed ────────────────────────────────


class TestUploadBundlePIIFailClosed:
    """upload_incident_bundle must fail closed when PII encryption is unavailable."""

    def test_without_key_and_no_pii_succeeds(self):
        """No PII → bundle succeeds even if crypto is unavailable."""
        db = _mock_db_execute()
        body = {
            "region_id": 1,
            "incidents": [
                {
                    "latitude": 14.5,
                    "longitude": 121.0,
                    "incident_nonsensitive_details": {
                        "alarm_level": "1",
                        "general_category": "Structural",
                    },
                    "incident_sensitive_details": {},
                }
            ],
        }
        body_obj = IncidentBundleCreate(**body)
        res = upload_incident_bundle(
            body_obj,
            {"user_id": "11111111-1111-4111-8111-111111111111", "role": "REGIONAL_ENCODER"},
            db,
        )
        assert res["status"] == "ok"
        assert len(res["imported"]) == 1
        assert len(res["failed"]) == 0

    def test_without_key_and_pii_present_fails(self, monkeypatch):
        """PII present + crypto unavailable → incident fails, no silent data loss."""
        monkeypatch.setattr(
            "api.routes.incidents.get_crypto_provider",
            lambda row=None: (_ for _ in ()).throw(
                SecurityProviderError("WIMS_MASTER_KEY not set")
            ),
        )

        db = _mock_db_execute()
        body = {
            "region_id": 1,
            "incidents": [
                {
                    "latitude": 14.5,
                    "longitude": 121.0,
                    "incident_nonsensitive_details": {
                        "alarm_level": "1",
                        "general_category": "Structural",
                    },
                    "incident_sensitive_details": {
                        "caller_name": "Alice",
                        "caller_number": "123",
                        "owner_name": "Owner",
                        "narrative_report": "Narrative",
                    },
                }
            ],
        }
        body_obj = IncidentBundleCreate(**body)
        res = upload_incident_bundle(
            body_obj,
            {"user_id": "11111111-1111-4111-8111-111111111111", "role": "REGIONAL_ENCODER"},
            db,
        )
        # Bundle succeeds at top level, but the incident is in "failed"
        assert res["status"] == "ok"
        assert len(res["imported"]) == 0
        assert len(res["failed"]) == 1
        assert res["failed"][0]["reason"] == "pii_encryption_unavailable"

    def test_with_key_encrypts_blob(self, monkeypatch):
        """Valid crypto provider → pii_blob_enc is set."""

        def _mock_provider(row=None):
            p = MagicMock()
            p.crypto_provider = "env_aesgcm"
            p.kms_key_name = None
            p.current_version = 1
            p.encrypt_json.return_value = ("mock-nonce-b64", "mock-ct-b64")
            return p

        monkeypatch.setattr("api.routes.incidents.get_crypto_provider", _mock_provider)

        captured = {}

        def _capture_execute(sql, params=None):
            stmt = str(sql)
            if "INSERT INTO wims.incident_sensitive_details" in stmt:
                captured["params"] = params
            return _mock_db_execute().execute(sql, params)

        db = _mock_db_execute()
        db.execute.side_effect = _capture_execute

        body = {
            "region_id": 1,
            "incidents": [
                {
                    "latitude": 14.5,
                    "longitude": 121.0,
                    "incident_nonsensitive_details": {
                        "alarm_level": "1",
                        "general_category": "Structural",
                    },
                    "incident_sensitive_details": {
                        "caller_name": "Alice",
                        "caller_number": "123",
                        "owner_name": "Owner",
                    },
                }
            ],
        }
        body_obj = IncidentBundleCreate(**body)
        res = upload_incident_bundle(
            body_obj,
            {"user_id": "11111111-1111-4111-8111-111111111111", "role": "REGIONAL_ENCODER"},
            db,
        )
        assert res["status"] == "ok"
        assert len(res["imported"]) == 1

        params = captured["params"]
        assert params["pii_blob_enc"] == "mock-ct-b64"
        assert params["pii_nonce"] == "mock-nonce-b64"
        assert params["crypto_provider"] == "env_aesgcm"
        assert params["key_version"] == 1


# ── Analyst sensitive detail: PII decryption ─────────────────────────────────


class TestAnalystSensitivePII:
    """get_analyst_incident_sensitive_detail decrypts PII blobs correctly."""

    def test_legacy_plaintext_row(self, monkeypatch):
        """Legacy plaintext PII is returned — no decryption."""
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchone.side_effect = [
            _incident_row_15,
            _make_sd_row_legacy(),
        ]

        mock_provider = MagicMock()
        monkeypatch.setattr(
            "api.routes.incidents.get_crypto_provider",
            lambda sd=None: mock_provider,
        )

        result = get_analyst_incident_sensitive_detail(
            incident_id=15,
            _user={"user_id": "analyst-1", "role": "NATIONAL_ANALYST"},
            db=mock_db,
        )

        assert result["caller_name"] == "Juan Dela Cruz"
        assert result["caller_number"] == "09171234567"
        assert result["owner_name"] == "Pedro Reyes"
        assert result["occupant_name"] == "Maria Santos"
        assert result["narrative_report"] == "Legacy narrative report."
        assert result["establishment_name"] == "Nathan Cabrales"
        assert result["casualty_details"] == "1 minor injury"
        assert result["estimated_damage_php"] == 50000

        # Decryption NOT called — no blob
        mock_provider.decrypt_json.assert_not_called()
        assert result["pii_decryption_failed"] is False

    def test_encrypted_row_returns_decrypted_pii(self, monkeypatch):
        """Encrypted row: plaintext PII NULL, blob decrypted."""
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchone.side_effect = [
            _incident_row_15,
            _make_sd_row_encrypted(),
        ]

        decrypted_pii = {
            "caller_name": "Alice Encrypted",
            "caller_number": "09991234567",
            "owner_name": "Bob Property",
            "occupant_name": "Charlie Tenant",
            "narrative_report": "Decrypted narrative from blob.",
            "casualty_details": "2 injuries, 1 fatality",
            "estimated_damage_php": 125000,
        }

        mock_provider = MagicMock()
        mock_provider.decrypt_json.return_value = decrypted_pii
        monkeypatch.setattr(
            "api.routes.incidents.get_crypto_provider",
            lambda sd=None: mock_provider,
        )

        result = get_analyst_incident_sensitive_detail(
            incident_id=15,
            _user={"user_id": "analyst-1", "role": "NATIONAL_ANALYST"},
            db=mock_db,
        )

        assert result["caller_name"] == "Alice Encrypted"
        assert result["caller_number"] == "09991234567"
        assert result["owner_name"] == "Bob Property"
        assert result["occupant_name"] == "Charlie Tenant"
        assert result["narrative_report"] == "Decrypted narrative from blob."
        assert result["casualty_details"] == "2 injuries, 1 fatality"
        assert result["estimated_damage_php"] == 125000

        # Non-PII plaintext fields still work
        assert result["fire_origin"] == "Living Room"
        assert result["prepared_by_officer"] == "Officer Smith"
        assert result["establishment_name"] == "ABC Corp"

        # Decrypt WAS called
        mock_provider.decrypt_json.assert_called_once()
        call_args = mock_provider.decrypt_json.call_args
        assert call_args[0][1] == "mock-encrypted-blob-base64"
        assert result["pii_decryption_failed"] is False

    def test_encrypted_row_decrypt_failure_sets_failed_flag(self, monkeypatch):
        """Decryption failure → pii_decryption_failed=True, PII fields NULL."""
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchone.side_effect = [
            _incident_row_15,
            _make_sd_row_encrypted(),
        ]

        mock_provider = MagicMock()
        mock_provider.decrypt_json.side_effect = RuntimeError("decrypt error")
        monkeypatch.setattr(
            "api.routes.incidents.get_crypto_provider",
            lambda sd=None: mock_provider,
        )

        result = get_analyst_incident_sensitive_detail(
            incident_id=15,
            _user={"user_id": "analyst-1", "role": "NATIONAL_ANALYST"},
            db=mock_db,
        )

        assert result["pii_decryption_failed"] is True
        assert result["caller_name"] is None
        assert result["caller_number"] is None
        assert result["owner_name"] is None
        assert result["occupant_name"] is None
        assert result["narrative_report"] is None
        assert result["casualty_details"] is None
        assert result["estimated_damage_php"] is None

    def test_openbao_transit_decrypt(self, monkeypatch):
        """openbao_transit rows: decrypt with KmsSecurityProvider, flag clear."""
        mock_db = MagicMock()

        openbao_row = MagicMock()
        openbao_row._mapping = {
            "incident_id": 88,
            "fire_origin": "Wildland",
            "extent_of_damage": "Extended",
            "narrative_report": None,
            "prepared_by_officer": None,
            "noted_by_officer": None,
            "disposition": None,
            "caller_name": None,
            "caller_number": None,
            "owner_name": None,
            "establishment_name": None,
            "occupant_name": None,
            "alarm_timeline": None,
            "casualty_details": None,
            "estimated_damage_php": None,
            "pii_blob_enc": "vault:v1:openbao-ct",
            "encryption_iv": None,  # openbao_transit has no encryption_iv
            "crypto_provider": "openbao_transit",
            "key_version": 1,
        }

        mock_db.execute.return_value.fetchone.side_effect = [
            _incident_row_15,
            openbao_row,
        ]

        decrypted = {
            "caller_name": "OB User",
            "caller_number": "0900",
            "owner_name": "OB Owner",
            "occupant_name": "OB Occupant",
            "narrative_report": "OB narrative",
            "casualty_details": "OB casualty",
            "estimated_damage_php": 75000,
        }

        mock_provider = MagicMock()
        mock_provider.decrypt_json.return_value = decrypted
        monkeypatch.setattr(
            "api.routes.incidents.get_crypto_provider",
            lambda sd=None: mock_provider,
        )

        result = get_analyst_incident_sensitive_detail(
            incident_id=15,
            _user={"user_id": "analyst-1", "role": "NATIONAL_ANALYST"},
            db=mock_db,
        )

        assert result["caller_name"] == "OB User"
        assert result["caller_number"] == "0900"
        assert result["owner_name"] == "OB Owner"
        assert result["occupant_name"] == "OB Occupant"
        assert result["narrative_report"] == "OB narrative"
        assert result["casualty_details"] == "OB casualty"
        assert result["estimated_damage_php"] == 75000
        assert result["pii_decryption_failed"] is False

        # decrypt called with None encryption_iv (valid for openbao_transit)
        mock_provider.decrypt_json.assert_called_once()
        call_args = mock_provider.decrypt_json.call_args
        assert call_args[0][0] is None  # encryption_iv is None
        assert call_args[0][1] == "vault:v1:openbao-ct"

    def test_legacy_row_no_missing_sensitive_details(self, monkeypatch):
        """No incident_sensitive_details row → returns null fields + no error."""
        mock_db = MagicMock()
        # First call returns incident, second returns None (no sd_row)
        mock_db.execute.return_value.fetchone.side_effect = [
            _incident_row_15,
            None,
        ]

        result = get_analyst_incident_sensitive_detail(
            incident_id=15,
            _user={"user_id": "analyst-1", "role": "NATIONAL_ANALYST"},
            db=mock_db,
        )

        assert result["incident_id"] == 15
        assert result["fire_origin"] is None
        assert result["caller_name"] is None
        assert result["casualty_details"] is None
        assert result["estimated_damage_php"] is None
        assert result["alarm_timeline"] == []
        assert result["pii_decryption_failed"] is False

    def test_blob_metadata_not_exposed(self, monkeypatch):
        """pii_blob_enc, encryption_iv, crypto_provider, key_version never in response."""
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchone.side_effect = [
            _incident_row_15,
            _make_sd_row_encrypted(),
        ]

        mock_provider = MagicMock()
        mock_provider.decrypt_json.return_value = {
            "caller_name": "Test",
            "caller_number": "000",
            "owner_name": "Owner",
            "occupant_name": "Occupant",
            "narrative_report": "Narrative",
            "casualty_details": "Casualty info",
            "estimated_damage_php": 99000,
        }
        monkeypatch.setattr(
            "api.routes.incidents.get_crypto_provider",
            lambda sd=None: mock_provider,
        )

        result = get_analyst_incident_sensitive_detail(
            incident_id=15,
            _user={"user_id": "analyst-1", "role": "NATIONAL_ANALYST"},
            db=mock_db,
        )

        for col in (
            "pii_blob_enc",
            "encryption_iv",
            "crypto_provider",
            "kms_key_name",
            "key_version",
        ):
            assert col not in result, f"{col} leaked in response"
        assert result["pii_decryption_failed"] is False
