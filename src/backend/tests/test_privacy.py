"""Tests for M6 RA 10173 privacy-rights endpoints.

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
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: _user_row()),
            MagicMock(fetchall=lambda: _consent_rows()),
            MagicMock(),
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
        mock_db.execute.side_effect = [update_result, MagicMock()]

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
        mock_db.execute.side_effect = [update_result, MagicMock()]

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
        """Second anonymize call on already-nulled row still succeeds (rowcount=1 from UPDATE WHERE)."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()
        update_result = MagicMock()
        update_result.rowcount = 1
        mock_db.execute.side_effect = [update_result, MagicMock(), update_result, MagicMock()]

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        for _ in range(2):
            resp = client.post(
                "/api/admin/privacy/anonymize",
                json={"subject_type": "USER", "subject_id": _USER_ID, "confirm": True},
            )
            assert resp.status_code == 200


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
        """Anonymize report → witness fields nulled; FK-carrying columns kept."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_admin
        mock_db = _make_db()

        select_result = MagicMock(
            fetchone=lambda: _report_row(status="ACTIONED", verified_incident_id=_INCIDENT_ID)
        )
        update_cr = MagicMock()
        update_sd = MagicMock()
        update_ip = MagicMock()
        audit1 = MagicMock()
        audit2 = MagicMock()
        audit3 = MagicMock()

        mock_db.execute.side_effect = [
            select_result,
            update_cr,
            audit1,
            update_sd,
            audit2,
            update_ip,
            audit3,
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
        """POST with WITHDRAWN → 201 + action=WITHDRAWN."""
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
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
            MagicMock(),
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
                "action": "WITHDRAWN",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["action"] == "WITHDRAWN"

    def test_consent_public_insert_succeeds_under_rls(self, client: TestClient):
        """POST /api/auth/consent requires NO auth header — public endpoint (correction A)."""
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
        mock_db.execute.side_effect = [
            MagicMock(fetchone=lambda: consent_row),
            MagicMock(),
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
