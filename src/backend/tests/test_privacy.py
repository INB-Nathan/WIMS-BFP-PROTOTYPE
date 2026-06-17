"""Tests for M10 RA 10173 privacy-rights endpoints.

Covers:
  - GET  /api/admin/privacy/export  (user + report subjects)
  - POST /api/admin/privacy/anonymize
  - POST /api/auth/consent  (public, no-auth)
  - RBAC, audit, idempotency, terminal-status guard, corrections A-G
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from database import get_db
from main import app

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ADMIN_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
_USER_ID = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
_REPORT_ID = 42
_INCIDENT_ID = 99
_NOW = datetime(2026, 6, 12, 10, 0, 0, tzinfo=timezone.utc)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_admin():
    return {"user_id": _ADMIN_ID, "keycloak_id": "kid-admin", "role": "SYSTEM_ADMIN"}


def _mock_encoder():
    return {"user_id": _USER_ID, "keycloak_id": "kid-enc", "role": "REGIONAL_ENCODER"}


def _make_db():
    return MagicMock()


# ---------------------------------------------------------------------------
# Helpers for mock row results
# ---------------------------------------------------------------------------


def _user_row():
    row = MagicMock()
    row._mapping = {
        "user_id": uuid.UUID(_USER_ID),
        "username": "test_user",
        "role": "REGIONAL_ENCODER",
        "contact_number": "09171234567",
        "is_active": True,
        "mfa_enabled": False,
        "last_login": None,
        "created_at": _NOW,
    }
    return row


def _report_row(status="ACTIONED", verified_incident_id=None):
    row = MagicMock()
    row.__getitem__ = lambda s, k: {
        0: _REPORT_ID,
        1: status,
        2: verified_incident_id,
    }[k]
    row._mapping = {
        "report_id": _REPORT_ID,
        "witness_name": "Juan dela Cruz",
        "witness_phone": "09181234567",
        "ip_hash": "abc123",
        "device_id": str(uuid.uuid4()),
        "phone_latitude": 14.5995,
        "phone_longitude": 120.9842,
        "category": "STRUCTURAL",
        "sub_category": None,
        "reporting_context": "WITNESS",
        "safety_status": "I_AM_SAFE",
        "reported_at": _NOW,
        "created_at": _NOW,
        "status": status,
        "verified_incident_id": verified_incident_id,
    }
    return row


def _sensitive_row():
    row = MagicMock()
    row._mapping = {
        "incident_id": _INCIDENT_ID,
        "caller_name": None,
        "caller_number": None,
        "owner_name": None,
        "occupant_name": None,
        "narrative_report": None,
        "street_address": "123 Rizal St",
        "landmark": "Near BFP Station",
        "prepared_by_officer": "Officer A",
        "noted_by_officer": "Officer B",
        "remarks": None,
        "pii_blob_enc": "dGVzdGJsb2I=",
        "encryption_iv": "aXZkYXRh",
        "crypto_provider": "env_aesgcm",
        "kms_key_name": None,
        "key_version": 1,
    }
    return row


def _consent_rows():
    return []  # empty consent history is fine for most tests


# ---------------------------------------------------------------------------
# Export — user subject
# ---------------------------------------------------------------------------


class TestExportUserSubject:
    def test_export_user_returns_bundle(self, client: TestClient):
        """GET /export?subject_type=USER&subject_id=... returns profile + consent_history."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _user_row()),  # users SELECT
            MagicMock(fetchall=lambda: _consent_rows()),  # consent_log SELECT
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get(f"/api/admin/privacy/export?subject_type=USER&subject_id={_USER_ID}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["subject_type"] == "USER"
        assert body["subject_id"] == _USER_ID
        assert "user_profile" in body
        assert body["user_profile"]["username"] == "test_user"
        assert body["consent_history"] == []

    def test_user_export_excludes_third_party_pii(self, client: TestClient):
        """User export must NOT contain incident_sensitive_details — those belong to third parties."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _user_row()),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get(f"/api/admin/privacy/export?subject_type=USER&subject_id={_USER_ID}")
        assert resp.status_code == 200
        body = resp.json()
        # incident data must be absent — user export is user-only
        assert body.get("incident_sensitive_details") is None
        assert body.get("citizen_report") is None

    def test_export_requires_admin(self, client: TestClient):
        """Non-SYSTEM_ADMIN caller must receive 403."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder
        resp = client.get(f"/api/admin/privacy/export?subject_type=USER&subject_id={_USER_ID}")
        assert resp.status_code == 403

    def test_export_returns_no_store_headers(self, client: TestClient):
        """Export response must carry Cache-Control: no-store."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _user_row()),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get(f"/api/admin/privacy/export?subject_type=USER&subject_id={_USER_ID}")
        assert resp.status_code == 200
        assert "no-store" in resp.headers.get("cache-control", "")

    def test_export_audited(self, client: TestClient):
        """Export must call log_system_audit with PII_EXPORT action."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        # log_system_audit patched → audit INSERT skipped; only 2 direct db.execute() calls:
        #   1) users SELECT  2) consent_log SELECT
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _user_row()),
            MagicMock(fetchall=lambda: _consent_rows()),
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.privacy.log_system_audit") as mock_audit:
            resp = client.get(f"/api/admin/privacy/export?subject_type=USER&subject_id={_USER_ID}")
        assert resp.status_code == 200
        mock_audit.assert_called_once()
        call_args = mock_audit.call_args[0]
        assert call_args[2] == "PII_EXPORT"

    def test_export_user_not_found(self, client: TestClient):
        """GET /export for non-existent user returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.return_value = MagicMock(fetchone=lambda: None)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/admin/privacy/export?subject_type=USER&subject_id=nonexistent")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Export — report subject
# ---------------------------------------------------------------------------


class TestExportReportSubject:
    def test_export_report_decrypts_pii(self, client: TestClient):
        """Report export decrypts pii_blob_enc and injects caller_name etc."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _report_row(verified_incident_id=_INCIDENT_ID)),
            MagicMock(fetchone=lambda: _sensitive_row()),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        mock_provider = MagicMock()
        mock_provider.decrypt_json.return_value = {
            "caller_name": "Maria Santos",
            "caller_number": "09179999999",
            "owner_name": "Juan Reyes",
            "occupant_name": "Ana Reyes",
            "narrative_report": "Fire in kitchen",
            "casualty_details": [],
        }

        with patch("api.routes.admin.privacy.get_crypto_provider", return_value=mock_provider):
            resp = client.get(
                f"/api/admin/privacy/export?subject_type=REPORT&subject_id={_REPORT_ID}"
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["subject_type"] == "REPORT"
        sd = body["incident_sensitive_details"]
        assert sd is not None
        assert sd["caller_name"] == "Maria Santos"
        assert sd["caller_number"] == "09179999999"
        assert "pii_blob_enc" not in sd
        assert "encryption_iv" not in sd

    def test_export_after_anonymize_returns_no_pii(self, client: TestClient):
        """Export after anonymization: witness/report data present but zero caller/owner/occupant PII.

        Simulates the post-anonymize state: pii_blob_enc IS NULL, plaintext PII columns NULL.
        _decrypt_sensitive_details must short-circuit (blob falsy) — no decrypt_json call,
        no injected PII fields, no error.
        """
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()

        # Anonymized sensitive row: blob and plaintext PII all NULL, crypto_provider NULL
        anonymized_sd = MagicMock()
        anonymized_sd._mapping = {
            "incident_id": _INCIDENT_ID,
            "caller_name": None,
            "caller_number": None,
            "owner_name": None,
            "occupant_name": None,
            "narrative_report": None,
            "street_address": "123 Rizal St",
            "landmark": "Near BFP Station",
            "prepared_by_officer": "Officer A",
            "noted_by_officer": "Officer B",
            "remarks": None,
            "pii_blob_enc": None,  # <-- anonymized: blob cleared
            "encryption_iv": None,
            "crypto_provider": None,  # <-- also cleared
            "kms_key_name": None,
            "key_version": None,
        }

        mock_db.execute.side_effect = [
            MagicMock(
                fetchone=lambda: _report_row(status="ACTIONED", verified_incident_id=_INCIDENT_ID)
            ),
            MagicMock(fetchone=lambda: anonymized_sd),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        # get_crypto_provider must NOT be called when pii_blob_enc is None
        with patch("api.routes.admin.privacy.get_crypto_provider") as mock_provider:
            resp = client.get(
                f"/api/admin/privacy/export?subject_type=REPORT&subject_id={_REPORT_ID}"
            )

        assert resp.status_code == 200
        mock_provider.assert_not_called()  # short-circuit confirmed

        body = resp.json()
        assert body["citizen_report"] is not None  # report-level data still present
        sd = body["incident_sensitive_details"]
        assert sd is not None  # SD row returned (structural data intact)
        # All PII fields must be absent or None — no injection happened
        assert sd.get("caller_name") is None
        assert sd.get("caller_number") is None
        assert sd.get("owner_name") is None
        assert sd.get("occupant_name") is None
        # Blob columns must be stripped from response
        assert "pii_blob_enc" not in sd
        assert "encryption_iv" not in sd
        assert "crypto_provider" not in sd

    def test_export_decrypt_passes_key_version(self, client: TestClient):
        """decrypt_json receives stored key_version when non-default (Q2 fix).

        Rows encrypted with a rotated key (key_version != 1) on the env_aesgcm
        path must pass that version to decrypt_json so the correct keyring entry
        is used.  Without this, rotated-key rows silently fail to decrypt.
        """
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()

        sd_row_v2 = MagicMock()
        sd_row_v2._mapping = {
            "incident_id": _INCIDENT_ID,
            "caller_name": None,
            "caller_number": None,
            "owner_name": None,
            "occupant_name": None,
            "narrative_report": None,
            "street_address": "123 Rizal St",
            "landmark": "Near BFP Station",
            "prepared_by_officer": "Officer A",
            "noted_by_officer": "Officer B",
            "remarks": None,
            "pii_blob_enc": "dGVzdGJsb2I=",
            "encryption_iv": "aXZkYXRh",
            "crypto_provider": "env_aesgcm",
            "kms_key_name": None,
            "key_version": 2,  # <-- rotated key, non-default
        }

        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _report_row(verified_incident_id=_INCIDENT_ID)),
            MagicMock(fetchone=lambda: sd_row_v2),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        mock_provider = MagicMock()
        mock_provider.decrypt_json.return_value = {
            "caller_name": "Maria Santos",
            "caller_number": "09179999999",
            "owner_name": "Juan Reyes",
            "occupant_name": "Ana Reyes",
            "narrative_report": "Fire in kitchen",
            "casualty_details": [],
        }

        with patch("api.routes.admin.privacy.get_crypto_provider", return_value=mock_provider):
            resp = client.get(
                f"/api/admin/privacy/export?subject_type=REPORT&subject_id={_REPORT_ID}"
            )

        assert resp.status_code == 200
        # Q2: decrypt_json must have been called with key_version=2 (4th positional arg)
        mock_provider.decrypt_json.assert_called_once()
        call_args = mock_provider.decrypt_json.call_args[0]
        assert len(call_args) >= 4, (
            f"decrypt_json called with {len(call_args)} positional args, expected >= 4"
        )
        assert call_args[3] == 2, f"key_version not forwarded to decrypt_json; got {call_args[3]}"

    def test_export_report_not_found(self, client: TestClient):
        """GET /export for non-existent report returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.return_value = MagicMock(fetchone=lambda: None)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/admin/privacy/export?subject_type=REPORT&subject_id=99999")
        assert resp.status_code == 404

    def test_export_report_null_incident(self, client: TestClient):
        """Report with NULL verified_incident_id returns without sensitive_details section."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _report_row(verified_incident_id=None)),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get(f"/api/admin/privacy/export?subject_type=REPORT&subject_id={_REPORT_ID}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["citizen_report"] is not None
        assert body["incident_sensitive_details"] is None

    def test_export_decrypt_failure_adds_sentinel(self, client: TestClient):
        """When decrypt_json raises, response includes decryption_failed: true sentinel (#304).

        The sentinel allows API consumers to distinguish "no PII exists" from
        "decryption silently failed". PII fields are absent; blob columns are stripped.
        """
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _report_row(verified_incident_id=_INCIDENT_ID)),
            MagicMock(fetchone=lambda: _sensitive_row()),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        mock_provider = MagicMock()
        mock_provider.decrypt_json.side_effect = RuntimeError("simulated decrypt failure")

        with patch("api.routes.admin.privacy.get_crypto_provider", return_value=mock_provider):
            resp = client.get(
                f"/api/admin/privacy/export?subject_type=REPORT&subject_id={_REPORT_ID}"
            )

        assert resp.status_code == 200
        body = resp.json()
        sd = body["incident_sensitive_details"]
        assert sd is not None
        assert sd.get("decryption_failed") is True, (
            f"Expected decryption_failed sentinel in response, got: {sd}"
        )
        # PII fields must be absent (decrypt never populated them)
        assert sd.get("caller_name") is None
        # Blob columns still stripped (defense-in-depth)
        assert "pii_blob_enc" not in sd
        assert "encryption_iv" not in sd


# ---------------------------------------------------------------------------
# Anonymize — user subject
# ---------------------------------------------------------------------------


class TestAnonymizeUser:
    def test_anonymize_user_nulls_contact_number(self, client: TestClient):
        """Anonymize user → UPDATE sets contact_number=NULL; rowcount=1 → 200."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        update_result = MagicMock()
        update_result.rowcount = 1
        # 3 direct db.execute() calls: 1) SELECT existence  2) UPDATE wims.users  3) audit INSERT
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: MagicMock()),  # user exists
            update_result,
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(
            "/api/admin/privacy/anonymize",
            json={"subject_type": "USER", "subject_id": _USER_ID, "confirm": True},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["anonymized"] is True
        assert "wims.users" in body["tables_affected"]
        assert body["warning"] == "irreversible"

    def test_anonymize_requires_confirm(self, client: TestClient):
        """confirm:false must return 422 — Pydantic validator fires before route handler."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(
            "/api/admin/privacy/anonymize",
            json={"subject_type": "USER", "subject_id": _USER_ID, "confirm": False},
        )
        assert resp.status_code == 422

    def test_anonymize_audited(self, client: TestClient):
        """Anonymize must call log_system_audit with PII_ANONYMIZE."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        update_result = MagicMock()
        update_result.rowcount = 1
        # log_system_audit patched → audit INSERT skipped; 2 db.execute() calls:
        #   SELECT existence + UPDATE wims.users
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: MagicMock()),  # user exists
            update_result,
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.privacy.log_system_audit") as mock_audit:
            resp = client.post(
                "/api/admin/privacy/anonymize",
                json={"subject_type": "USER", "subject_id": _USER_ID, "confirm": True},
            )
        assert resp.status_code == 200
        mock_audit.assert_called_once()
        call_args = mock_audit.call_args[0]
        assert call_args[2] == "PII_ANONYMIZE"

    def test_anonymize_idempotent(self, client: TestClient):
        """Second anonymize call is a no-op — only first call writes audit entry (#316).

        Verifies the SQL idempotency mechanism (#312): the second UPDATE must include
        a WHERE user_id clause. The idempotency guarantee relies on conditional UPDATE
        WHERE clauses that skip rows already anonymized.
        """
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()

        select_exists = MagicMock(fetchone=lambda: MagicMock())  # user exists both times
        update_hit = MagicMock(rowcount=1)  # first call: row modified
        update_miss = MagicMock(rowcount=0)  # second call: no-op (contact already NULL)

        # log_system_audit patched → audit INSERT skipped.
        # Each call: SELECT existence → UPDATE.
        # Call 1: SELECT + UPDATE (rowcount=1 → audit happens via patched fn)
        # Call 2: SELECT + UPDATE (rowcount=0 → no audit)
        mock_db.execute.side_effect = [
            select_exists,
            update_hit,
            select_exists,
            update_miss,
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.privacy.log_system_audit") as mock_audit:
            for _ in range(2):
                resp = client.post(
                    "/api/admin/privacy/anonymize",
                    json={"subject_type": "USER", "subject_id": _USER_ID, "confirm": True},
                )
                assert resp.status_code == 200

        # Only one audit entry across two calls
        assert mock_audit.call_count == 1, f"Expected 1 audit call, got {mock_audit.call_count}"
        call_args = mock_audit.call_args[0]
        assert call_args[2] == "PII_ANONYMIZE"

        # ═══ Issue #312: Verify SQL idempotency mechanism ═══
        # Second anonymize UPDATE must include WHERE user_id to ensure the
        # correct row is targeted. A missing or changed WHERE clause would
        # silently break the idempotency guarantee.
        update_calls = [c for c in mock_db.execute.call_args_list if "UPDATE" in str(c[0][0])]
        assert len(update_calls) >= 2, f"Expected >= 2 UPDATE calls, got {len(update_calls)}"
        second_update_sql = str(update_calls[1][0][0])
        assert "user_id" in second_update_sql, (
            f"Second anonymize UPDATE missing user_id in WHERE clause: {second_update_sql}"
        )

    def test_anonymize_user_not_found(self, client: TestClient):
        """Anonymize non-existent user returns 404 (SELECT existence check)."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        # SELECT existence returns None → 404 before UPDATE is attempted
        mock_db.execute.return_value = MagicMock(fetchone=lambda: None)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(
            "/api/admin/privacy/anonymize",
            json={"subject_type": "USER", "subject_id": "nonexistent", "confirm": True},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Anonymize — report subject
# ---------------------------------------------------------------------------


class TestAnonymizeReport:
    def test_anonymize_refuses_nonterminal_report(self, client: TestClient):
        """409 when report status is non-terminal (PENDING, UNDER_REVIEW, LINKED)."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.return_value = MagicMock(fetchone=lambda: _report_row(status="PENDING"))

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(
            "/api/admin/privacy/anonymize",
            json={"subject_type": "REPORT", "subject_id": str(_REPORT_ID), "confirm": True},
        )
        assert resp.status_code == 409
        assert "PENDING" in resp.json()["detail"]

    def test_anonymize_report_nulls_pii_preserves_fks(self, client: TestClient):
        """Anonymize report → witness fields nulled; narrative_report nulled; FK-carrying columns kept.

        Verifies SQL dispatch: the incident_sensitive_details UPDATE includes
        narrative_report = NULL (Q1 fix — narrative_report was previously leaked).
        """
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()

        select_result = MagicMock(
            fetchone=lambda: _report_row(status="ACTIONED", verified_incident_id=_INCIDENT_ID)
        )
        update_cr = MagicMock(rowcount=1)
        update_sd = MagicMock(rowcount=1)
        update_ip = MagicMock(rowcount=1)

        # log_system_audit is patched below → 4 db.execute calls happen
        # but audit gate requires rowcount > 0
        mock_db.execute.side_effect = [
            select_result,
            update_cr,
            update_sd,
            update_ip,
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.privacy.log_system_audit"):
            resp = client.post(
                "/api/admin/privacy/anonymize",
                json={"subject_type": "REPORT", "subject_id": str(_REPORT_ID), "confirm": True},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["anonymized"] is True
        tables = body["tables_affected"]
        assert "wims.citizen_reports" in tables
        assert "wims.incident_sensitive_details" in tables
        assert "wims.involved_parties" in tables
        assert body["warning"] == "irreversible"

        # Q1: Verify SQL dispatch — narrative_report must be in the anonymize UPDATE
        sd_update_sql = str(mock_db.execute.call_args_list[2][0][0])
        assert "narrative_report = NULL" in sd_update_sql, (
            f"narrative_report = NULL missing from anonymize UPDATE: {sd_update_sql}"
        )

    def test_anonymize_report_not_found(self, client: TestClient):
        """Anonymize non-existent report returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        mock_db.execute.return_value = MagicMock(fetchone=lambda: None)

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(
            "/api/admin/privacy/anonymize",
            json={"subject_type": "REPORT", "subject_id": "99999", "confirm": True},
        )
        assert resp.status_code == 404

    def test_anonymize_report_null_incident(self, client: TestClient):
        """Report with NULL verified_incident_id: only citizen_reports nulled."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()

        select_result = MagicMock(
            fetchone=lambda: _report_row(status="ACTIONED", verified_incident_id=None)
        )
        update_cr = MagicMock(rowcount=1)

        mock_db.execute.side_effect = [select_result, update_cr]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.admin.privacy.log_system_audit"):
            resp = client.post(
                "/api/admin/privacy/anonymize",
                json={
                    "subject_type": "REPORT",
                    "subject_id": str(_REPORT_ID),
                    "confirm": True,
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["anonymized"] is True
        tables = body["tables_affected"]
        assert "wims.citizen_reports" in tables
        assert "wims.incident_sensitive_details" not in tables
        assert "wims.involved_parties" not in tables


# ---------------------------------------------------------------------------
# Consent endpoint (public — correction A)
# ---------------------------------------------------------------------------


class TestConsentEndpoint:
    def test_consent_records_grant(self, client: TestClient):
        """POST /api/auth/consent with GRANTED → 201 + consent_id returned."""
        mock_db = _make_db()
        consent_row = MagicMock()
        consent_row.__getitem__ = lambda s, k: {
            0: 1,
            1: "USER",
            2: "some-user-id",
            3: "DATA_PROCESSING",
            4: "GRANTED",
            5: _NOW,
        }[k]
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        resp = client.post(
            "/api/auth/consent",
            json={
                "subject_type": "USER",
                "subject_id": "some-user-id",
                "consent_type": "DATA_PROCESSING",
                "action": "GRANTED",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["action"] == "GRANTED"
        assert body["consent_id"] == 1

    def test_consent_records_withdraw(self, client: TestClient):
        """POST with WITHDRAWN → 201 + CONSENT_WITHDRAW audit."""
        mock_db = _make_db()
        consent_row = MagicMock()
        consent_row.__getitem__ = lambda s, k: {
            0: 2,
            1: "USER",
            2: "some-user-id",
            3: "DATA_PROCESSING",
            4: "WITHDRAWN",
            5: _NOW,
        }[k]
        # log_system_audit patched → audit INSERT skipped; only 1 direct db.execute() call
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        with patch("api.routes.consent.log_system_audit") as mock_audit:
            resp = client.post(
                "/api/auth/consent",
                json={
                    "subject_type": "USER",
                    "subject_id": "some-user-id",
                    "consent_type": "DATA_PROCESSING",
                    "action": "WITHDRAWN",
                },
            )
        assert resp.status_code == 201
        assert resp.json()["action"] == "WITHDRAWN"
        mock_audit.assert_called_once()
        call_args = mock_audit.call_args[0]
        assert call_args[2] == "CONSENT_WITHDRAW"
        assert call_args[1] is None
        assert call_args[3] == "wims.consent_log"
        assert call_args[4] == 2

    def test_consent_public_no_auth_required(self, client: TestClient):
        """POST /api/auth/consent requires NO auth header — public endpoint (correction A).

        This is a no-auth public endpoint test, NOT a DB-level RLS verification.
        Actual RLS policy verification (FOR INSERT WITH CHECK (TRUE)) requires
        a real database connection and integration tests.
        """
        mock_db = _make_db()
        consent_row = MagicMock()
        consent_row.__getitem__ = lambda s, k: {
            0: 3,
            1: "REPORT",
            2: "42",
            3: "INCIDENT_REPORT_SUBMISSION",
            4: "GRANTED",
            5: _NOW,
        }[k]
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
            MagicMock(),
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        # Deliberately no Authorization header — public endpoint
        resp = client.post(
            "/api/auth/consent",
            json={
                "subject_type": "REPORT",
                "subject_id": "42",
                "consent_type": "INCIDENT_REPORT_SUBMISSION",
                "action": "GRANTED",
            },
        )
        # Must NOT be 401/403 — open to the public
        assert resp.status_code == 201

    def test_consent_audit_action_grant(self, client: TestClient):
        """Consent grant → audit log written with CONSENT_GRANT action."""
        mock_db = _make_db()
        consent_row = MagicMock()
        consent_row.__getitem__ = lambda s, k: {
            0: 5,
            1: "USER",
            2: "uid",
            3: "DATA_PROCESSING",
            4: "GRANTED",
            5: _NOW,
        }[k]
        # log_system_audit patched → audit INSERT skipped; only 1 direct db.execute() call:
        #   INSERT INTO wims.consent_log
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        with patch("api.routes.consent.log_system_audit") as mock_audit:
            client.post(
                "/api/auth/consent",
                json={
                    "subject_type": "USER",
                    "subject_id": "uid",
                    "consent_type": "DATA_PROCESSING",
                    "action": "GRANTED",
                },
            )
        mock_audit.assert_called_once()
        call_args = mock_audit.call_args[0]
        assert call_args[2] == "CONSENT_GRANT"
        assert call_args[1] is None  # anonymous caller — user_id=None
        assert call_args[3] == "wims.consent_log"  # table_affected
        assert call_args[4] == 5  # record_id (consent_id from mock row)

    # ── Issue #306: X-Forwarded-For / client IP capture tests ─────────────

    def test_consent_x_forwarded_for_overrides_client_ip(self, client: TestClient):
        """X-Forwarded-For header IP is recorded, not the direct client IP."""
        mock_db = _make_db()
        consent_row = MagicMock()
        consent_row.__getitem__ = lambda s, k: {
            0: 10,
            1: "USER",
            2: "uid-xff",
            3: "DATA_PROCESSING",
            4: "GRANTED",
            5: _NOW,
        }[k]
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        resp = client.post(
            "/api/auth/consent",
            json={
                "subject_type": "USER",
                "subject_id": "uid-xff",
                "consent_type": "DATA_PROCESSING",
                "action": "GRANTED",
            },
            headers={"X-Forwarded-For": "203.0.113.42"},
        )
        assert resp.status_code == 201

        insert_params = mock_db.execute.call_args_list[0][0][1]
        assert insert_params["ip"] == "203.0.113.42", (
            f"Expected X-Forwarded-For IP, got {insert_params['ip']}"
        )

    def test_consent_no_x_forwarded_for_falls_back_to_client_host(self, client: TestClient):
        """No X-Forwarded-For → falls back to request.client.host (testclient)."""
        mock_db = _make_db()
        consent_row = MagicMock()
        consent_row.__getitem__ = lambda s, k: {
            0: 11,
            1: "USER",
            2: "uid-noxff",
            3: "DATA_PROCESSING",
            4: "GRANTED",
            5: _NOW,
        }[k]
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        resp = client.post(
            "/api/auth/consent",
            json={
                "subject_type": "USER",
                "subject_id": "uid-noxff",
                "consent_type": "DATA_PROCESSING",
                "action": "GRANTED",
            },
        )
        assert resp.status_code == 201

        insert_params = mock_db.execute.call_args_list[0][0][1]
        assert insert_params["ip"] == "testclient", (
            f"Expected fallback to testclient, got {insert_params['ip']}"
        )

    def test_consent_malformed_x_forwarded_for_handled(self, client: TestClient):
        """Multiple comma-separated IPs → first taken; empty/absent → fallback."""
        mock_db = _make_db()
        consent_row = MagicMock()
        consent_row.__getitem__ = lambda s, k: {
            0: 12,
            1: "USER",
            2: "uid-multi",
            3: "DATA_PROCESSING",
            4: "GRANTED",
            5: _NOW,
        }[k]
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
            MagicMock(),  # audit INSERT
        ]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        resp = client.post(
            "/api/auth/consent",
            json={
                "subject_type": "USER",
                "subject_id": "uid-multi",
                "consent_type": "DATA_PROCESSING",
                "action": "GRANTED",
            },
            headers={"X-Forwarded-For": "198.51.100.1, 203.0.113.99"},
        )
        assert resp.status_code == 201
        insert_params = mock_db.execute.call_args_list[0][0][1]
        assert insert_params["ip"] == "198.51.100.1", (
            f"Expected first comma-separated IP, got {insert_params['ip']}"
        )

    # ── Issue #315: consent_type max_length validation ───────────────────

    def test_consent_type_rejects_over_length(self, client: TestClient):
        """consent_type > 100 chars → 422 (Field max_length=100)."""
        long_type = "X" * 101
        resp = client.post(
            "/api/auth/consent",
            json={
                "subject_type": "USER",
                "subject_id": "some-user-id",
                "consent_type": long_type,
                "action": "GRANTED",
            },
        )
        assert resp.status_code == 422, (
            f"Expected 422 for over-length consent_type, got {resp.status_code}"
        )
