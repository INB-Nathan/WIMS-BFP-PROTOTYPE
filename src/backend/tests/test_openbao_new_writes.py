"""Phase 4 #152 — flag-gated OpenBao Transit new-write tests.

Verifies that when ``WIMS_CRYPTO_PROVIDER`` is unset or ``openbao_transit``,
the write paths (field-update helpers) store the correct provider metadata
in SQL INSERT/UPDATE params.

No live OpenBao required — uses mocks/fakes exclusively.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from schemas.regional import IncidentUpdateRequest


# ── Import gates ──────────────────────────────────────────────────────────────

try:
    from api.routes.regional.field_updates import (
        _apply_incident_field_updates,
        _fetch_incident_edit_fields,
    )
except ImportError as exc:
    pytest.fail(f"Required module not importable: {exc}")


# ── Helpers ───────────────────────────────────────────────────────────────────


def _fake_db_session() -> MagicMock:
    """Return a mock DB session that captures text() execute calls.

    After the helper runs, inspect ``db.captured_calls`` for a list of
    ``(sql_text, params_dict)`` tuples.
    """
    db = MagicMock()
    captured: list[tuple[str, dict]] = []

    def _execute_side_effect(sql_obj, params=None):
        # sql_obj is a TextClause; str(sql_obj) gives the SQL text
        sql_text = str(sql_obj)
        captured.append((sql_text, params or {}))
        # Return a fake result that looks like a Row
        fake_result = MagicMock()
        # fetchone must return something falsy by default so "if existing" fails
        fake_result.fetchone.return_value = None
        # scalar returns None by default
        fake_result.scalar.return_value = None
        return fake_result

    db.execute.side_effect = _execute_side_effect
    db.captured_calls = captured
    return db


def _fake_env_aesgcm_provider() -> MagicMock:
    """Fake SecurityProvider that matches env_aesgcm metadata."""
    sp = MagicMock()
    sp.encrypt_json.return_value = ("nonce123base64", "ct123base64")
    sp.crypto_provider = "env_aesgcm"
    sp.kms_key_name = None
    return sp


def _fake_openbao_provider() -> MagicMock:
    """Fake KmsSecurityProvider that matches openbao_transit metadata."""
    ksp = MagicMock()
    ksp.encrypt_json.return_value = ("OPENBAO_TRANSIT", "vault:v1:abc123def456")
    ksp.crypto_provider = "openbao_transit"
    ksp.kms_key_name = "wims-incident-pii"
    return ksp


def _pii_update_body() -> IncidentUpdateRequest:
    """Return an IncidentUpdateRequest with one PII field set."""
    return IncidentUpdateRequest(caller_name="Juan Dela Cruz")


def _sd_select_row(
    pii_blob_enc: str | None = None,
    encryption_iv: str | None = None,
    crypto_provider: str | None = None,
    kms_key_name: str | None = None,
):
    """Simulate a Row._mapping dict as returned by execute().fetchone()."""
    return {
        "pii_blob_enc": pii_blob_enc,
        "encryption_iv": encryption_iv,
        "crypto_provider": crypto_provider,
        "kms_key_name": kms_key_name,
    }


# ════════════════════════════════════════════════════════════════════════════════
# Test 1: Default env-AES write behaviour
# ════════════════════════════════════════════════════════════════════════════════


class TestEnvAesgcmWrites:
    """When WIMS_CRYPTO_PROVIDER is unset (default env_aesgcm), new writes
    must store 'env_aesgcm' metadata with real nonce and no KMS key name."""

    def test_new_pii_write_stores_env_aesgcm_metadata(self, monkeypatch):
        """_apply_incident_field_updates with env_aesgcm provider stores
        crypto_provider='env_aesgcm', encryption_iv=nonce, kms_key_name=NULL."""
        monkeypatch.setenv("WIMS_MASTER_KEY", "AAAA" + "A" * 40 + "==")
        fake_sp = _fake_env_aesgcm_provider()

        with patch(
            "api.routes.regional.field_updates.get_crypto_provider",
            return_value=fake_sp,
        ):
            db = _fake_db_session()
            _apply_incident_field_updates(db, incident_id=42, body=_pii_update_body())

        # Find the sensitive-details UPDATE call
        sd_updates = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql and "pii_blob_enc" in sql
        ]
        assert len(sd_updates) == 1, (
            f"Expected 1 UPDATE on incident_sensitive_details with pii_blob_enc, "
            f"got {len(sd_updates)}: {[s[0][:80] for s in db.captured_calls]}"
        )

        sql, params = sd_updates[0]

        assert params.get("crypto_provider") == "env_aesgcm", (
            f"crypto_provider param: {params.get('crypto_provider')!r}"
        )
        assert params.get("enc_iv") == "nonce123base64", (
            f"encryption_iv param: {params.get('enc_iv')!r}"
        )
        assert params.get("kms_key_name") is None, (
            f"kms_key_name param should be None, got {params.get('kms_key_name')!r}"
        )
        assert params.get("pii_blob") == "ct123base64", (
            f"pii_blob_enc param: {params.get('pii_blob')!r}"
        )

    def test_no_pii_update_leaves_metadata_unchanged(self):
        """When no PII field is updated, the sensitive-details UPDATE
        should NOT include crypto_provider/kms_key_name columns."""
        body = IncidentUpdateRequest(street_address="123 Main St")
        db = _fake_db_session()

        # The helper should still run but has_encryptable_update = False
        _apply_incident_field_updates(db, incident_id=42, body=body)

        sd_updates = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql
        ]
        # There may be an UPDATE for street_address, but no pii_blob_enc set
        for sql, params in sd_updates:
            assert "pii_blob_enc" not in sql.lower(), (
                f"PII blob should not be in UPDATE when no PII fields changed: {sql[:120]}"
            )
            assert "crypto_provider" not in sql.lower(), (
                f"crypto_provider should not be in UPDATE when no PII fields changed: {sql[:120]}"
            )


# ════════════════════════════════════════════════════════════════════════════════
# Test 2: openbao_transit new-write behaviour
# ════════════════════════════════════════════════════════════════════════════════


class TestOpenBaoNewWrites:
    """When WIMS_CRYPTO_PROVIDER=openbao_transit, new writes must store
    openbao_transit metadata: kms_key_name, NULL encryption_iv, Transit ciphertext."""

    def test_new_pii_write_stores_openbao_metadata(self, monkeypatch):
        """_apply_incident_field_updates with openbao_transit provider stores
        crypto_provider='openbao_transit', kms_key_name='wims-incident-pii',
        encryption_iv=NULL."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "openbao_transit")
        fake_ksp = _fake_openbao_provider()

        with patch(
            "api.routes.regional.field_updates.get_crypto_provider",
            return_value=fake_ksp,
        ):
            db = _fake_db_session()
            _apply_incident_field_updates(db, incident_id=42, body=_pii_update_body())

        sd_updates = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql and "pii_blob_enc" in sql
        ]
        assert len(sd_updates) == 1, f"Expected 1 UPDATE with pii_blob_enc, got {len(sd_updates)}"

        sql, params = sd_updates[0]

        assert params.get("crypto_provider") == "openbao_transit", (
            f"crypto_provider param: {params.get('crypto_provider')!r}"
        )
        assert params.get("kms_key_name") == "wims-incident-pii", (
            f"kms_key_name param: {params.get('kms_key_name')!r}"
        )
        assert params.get("enc_iv") is None, (
            f"encryption_iv should be None for openbao_transit, got {params.get('enc_iv')!r}"
        )
        assert params.get("pii_blob") == "vault:v1:abc123def456", (
            f"pii_blob_enc should be Transit ciphertext, got {params.get('pii_blob')!r}"
        )

    def test_openbao_write_does_not_store_nonce(self, monkeypatch):
        """The sentinel nonce 'OPENBAO_TRANSIT' must never be stored as encryption_iv."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "openbao_transit")
        fake_ksp = _fake_openbao_provider()
        # sentinel nonce returned by encrypt_json
        fake_ksp.encrypt_json.return_value = ("OPENBAO_TRANSIT", "vault:v1:abc")

        with patch(
            "api.routes.regional.field_updates.get_crypto_provider",
            return_value=fake_ksp,
        ):
            db = _fake_db_session()
            _apply_incident_field_updates(db, incident_id=42, body=_pii_update_body())

        sd_updates = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql and "pii_blob_enc" in sql
        ]
        assert len(sd_updates) == 1

        _, params = sd_updates[0]
        # encryption_iv must be None, not the sentinel
        assert params.get("enc_iv") is None, (
            f"Sentinel nonce must NOT be stored as encryption_iv: {params.get('enc_iv')!r}"
        )


# ════════════════════════════════════════════════════════════════════════════════
# Test 3: API response stripping
# ════════════════════════════════════════════════════════════════════════════════


class TestResponseMetadataStripping:
    """API/detail/conflict responses must NOT expose internal crypto metadata
    (crypto_provider, kms_key_name, pii_blob_enc, encryption_iv)."""

    def test_conflict_response_strips_internal_columns(self, monkeypatch):
        """_fetch_incident_edit_fields strips pii_blob_enc, encryption_iv,
        crypto_provider, and kms_key_name from the conflict payload."""
        monkeypatch.setenv("WIMS_MASTER_KEY", "AAAA" + "A" * 40 + "==")

        db = MagicMock()
        # First call: nonsensitive details
        # Second call: sensitive details
        # Third call: fire_incidents coords
        call_count = 0

        def _fetchone_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # incident_nonsensitive_details
                fake_ns = MagicMock()
                fake_ns._mapping = {"notification_dt": "2026-01-15", "alarm_level": "1st Alarm"}
                return fake_ns
            elif call_count == 2:
                # incident_sensitive_details
                fake_sd = MagicMock()
                fake_sd._mapping = {
                    "street_address": "123 Main St",
                    "pii_blob_enc": "vault:v1:abc123",
                    "encryption_iv": "nonce123",
                    "crypto_provider": "openbao_transit",
                    "kms_key_name": "wims-incident-pii",
                    "owner_name": None,
                }
                return fake_sd
            else:
                # fire_incidents
                fake_fi = MagicMock()
                fake_fi._mapping = {
                    "incident_type_code": "FIRE",
                    "updated_at": None,
                    "latitude": 14.5,
                    "longitude": 121.0,
                }
                return fake_fi

        fake_result = MagicMock()
        fake_result.fetchone.side_effect = _fetchone_side_effect
        db.execute.return_value = fake_result

        result = _fetch_incident_edit_fields(db, incident_id=1)

        # Internal crypto metadata must not leak
        assert "pii_blob_enc" not in result, (
            f"pii_blob_enc must not appear in response: {result.keys()}"
        )
        assert "encryption_iv" not in result, (
            f"encryption_iv must not appear in response: {result.keys()}"
        )
        assert "crypto_provider" not in result, (
            f"crypto_provider must not appear in response: {result.keys()}"
        )
        assert "kms_key_name" not in result, (
            f"kms_key_name must not appear in response: {result.keys()}"
        )
        # Editable fields should still be present
        assert result.get("street_address") == "123 Main St"
        assert result.get("notification_dt") == "2026-01-15"

    def test_conflict_response_strips_metadata_without_blob(self, monkeypatch):
        """_fetch_incident_edit_fields handles rows with no encrypted blob
        (pii_blob_enc is None) and still strips metadata."""
        monkeypatch.setenv("WIMS_MASTER_KEY", "AAAA" + "A" * 40 + "==")

        db = MagicMock()
        call_count = 0

        def _fetchone_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                fake_ns = MagicMock()
                fake_ns._mapping = {"notification_dt": None}
                return fake_ns
            elif call_count == 2:
                fake_sd = MagicMock()
                fake_sd._mapping = {
                    "pii_blob_enc": None,
                    "encryption_iv": None,
                    "crypto_provider": "env_aesgcm",
                    "kms_key_name": None,
                }
                return fake_sd
            else:
                fake_fi = MagicMock()
                fake_fi._mapping = {
                    "incident_type_code": None,
                    "updated_at": None,
                    "latitude": None,
                    "longitude": None,
                }
                return fake_fi

        fake_result = MagicMock()
        fake_result.fetchone.side_effect = _fetchone_side_effect
        db.execute.return_value = fake_result

        result = _fetch_incident_edit_fields(db, incident_id=1)

        assert "pii_blob_enc" not in result
        assert "encryption_iv" not in result
        assert "crypto_provider" not in result
        assert "kms_key_name" not in result


# ════════════════════════════════════════════════════════════════════════════════
# Test 4: AFOR import wiring now dispatches through get_crypto_provider
# ════════════════════════════════════════════════════════════════════════════════


class TestAforCommitWiring:
    """Verify that the afor.py wiring now returns get_crypto_provider() instead
    of the legacy helpers.get_security_provider()."""

    def test_afor_get_security_provider_returns_kms_dispatch(self, monkeypatch):
        """_get_security_provider in afor.py returns the result of get_crypto_provider."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "openbao_transit")
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")

        from api.routes.regional.afor import _get_security_provider

        provider = _get_security_provider()
        assert provider.crypto_provider == "openbao_transit"
        assert provider.kms_key_name == "wims-incident-pii"

    def test_afor_default_env_aesgcm(self, monkeypatch):
        """When env is unset, _get_security_provider returns env_aesgcm provider."""
        monkeypatch.delenv("WIMS_CRYPTO_PROVIDER", raising=False)
        monkeypatch.setenv("WIMS_MASTER_KEY", "AAAA" + "A" * 40 + "==")

        from api.routes.regional.afor import _get_security_provider

        provider = _get_security_provider()
        assert provider.crypto_provider == "env_aesgcm"
        assert provider.kms_key_name is None

    def test_init_get_security_provider_returns_kms_dispatch(self, monkeypatch):
        """_get_security_provider in __init__.py returns the result of get_crypto_provider."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "openbao_transit")
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")

        from api.routes.regional import _get_security_provider

        provider = _get_security_provider()
        assert provider.crypto_provider == "openbao_transit"
