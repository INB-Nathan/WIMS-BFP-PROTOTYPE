"""
TDD: M9c System Configuration — GET/PATCH /api/admin/config endpoints,
     AI timeout consumer, and Suricata severity threshold consumer.
"""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# =============================================================================
# Helpers
# =============================================================================


def mock_admin_user():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-admin",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


def mock_encoder_user():
    return {
        "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-encoder",
        "username": "encoder",
        "role": "REGIONAL_ENCODER",
    }


_SEED_ROWS = [
    ("ai_timeout_seconds", "60", "Ollama timeout", None, None),
    ("alert_severity_threshold", "3", "Suricata HIGH cutoff", None, None),
    ("offline_storage_mb", "50", "IndexedDB advisory cap", None, None),
    ("session_timeout_minutes", "30", "Idle timeout UI hint", None, None),
    ("worker_offline_timeout_seconds", "300", "Worker OFFLINE threshold", None, None),
    ("worker_stale_timeout_seconds", "60", "Worker STALE threshold", None, None),
    ("npc_contact_name", "NPC DPO", "NPC contact person", None, None),
    ("npc_contact_phone", "+63 2 8234-2228", "NPC contact phone", None, None),
    ("npc_office_phone", "+63 2 8234-2228", "NPC office phone", None, None),
]

_SENTINEL = object()


def _mock_config_db(rows=None, update_rowcount=1, fetchone_row=_SENTINEL):
    """Return a mock DB session for system_config endpoints.

    fetchone_row: value returned by mock_result.fetchone().  When the
    default sentinel is used, a non-None MagicMock is returned (simulates
    a found row).  Pass ``None`` to simulate a missing row.
    """
    mock_result = MagicMock()
    mock_result.fetchall.return_value = rows if rows is not None else _SEED_ROWS
    mock_result.rowcount = update_rowcount
    if fetchone_row is not _SENTINEL:
        mock_result.fetchone.return_value = fetchone_row
    mock_db = MagicMock()
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


# =============================================================================
# GET /api/admin/config
# =============================================================================


class TestGetConfig:
    def test_returns_all_seed_keys(self, client: TestClient):
        """GET /admin/config returns all nine seed config keys."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_config_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/config")

        assert response.status_code == 200
        data = response.json()
        assert "config" in data
        keys = [entry["key"] for entry in data["config"]]
        assert "ai_timeout_seconds" in keys
        assert "alert_severity_threshold" in keys
        assert "offline_storage_mb" in keys
        assert "session_timeout_minutes" in keys
        assert "worker_stale_timeout_seconds" in keys
        assert "worker_offline_timeout_seconds" in keys
        assert "npc_contact_name" in keys
        assert "npc_contact_phone" in keys
        assert "npc_office_phone" in keys

    def test_returns_value_and_description(self, client: TestClient):
        """Each config entry includes value and description fields."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_config_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/config")
        data = response.json()
        ai_entry = next(e for e in data["config"] if e["key"] == "ai_timeout_seconds")
        assert ai_entry["value"] == "60"
        assert ai_entry["description"] == "Ollama timeout"

    def test_requires_admin(self, client: TestClient):
        """Non-admin role returns 403."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user
        _, mock_get_db = _mock_config_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/config")
        assert response.status_code in (401, 403)


# =============================================================================
# PATCH /api/admin/config/{key}
# =============================================================================


class TestNpcConfigKeys:
    """NPC contact config keys (#355) — valid in VALID_CONFIG_KEYS and patchable."""

    def test_npc_contact_name_is_valid_key(self, client: TestClient):
        """PATCH npc_contact_name succeeds with 200."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        old_row = MagicMock()
        old_row.__getitem__ = lambda self, i: "Old Name"
        mock_db, mock_get_db = _mock_config_db(fetchone_row=old_row)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/config/npc_contact_name", json={"value": "Atty. Reyes"})
        assert response.status_code == 200
        assert response.json()["value"] == "Atty. Reyes"

    def test_npc_contact_phone_is_valid_key(self, client: TestClient):
        """PATCH npc_contact_phone succeeds with 200."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        old_row = MagicMock()
        old_row.__getitem__ = lambda self, i: "+63 2 111-1111"
        mock_db, mock_get_db = _mock_config_db(fetchone_row=old_row)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/npc_contact_phone", json={"value": "+63 2 8234-2228"}
        )
        assert response.status_code == 200

    def test_npc_office_phone_is_valid_key(self, client: TestClient):
        """PATCH npc_office_phone succeeds with 200."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        old_row = MagicMock()
        old_row.__getitem__ = lambda self, i: "+63 2 111-1111"
        mock_db, mock_get_db = _mock_config_db(fetchone_row=old_row)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/npc_office_phone", json={"value": "+63 2 8234-2228"}
        )
        assert response.status_code == 200

    def test_npc_key_update_audit_logged(self, client: TestClient):
        """NPC config key update produces audit INSERT with old/new values."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        old_row = MagicMock()
        old_row.__getitem__ = lambda self, i: "Old Name"
        mock_db, mock_get_db = _mock_config_db(fetchone_row=old_row)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        client.patch("/api/admin/config/npc_contact_name", json={"value": "New Name"})

        # Find the audit INSERT call
        audit_params = None
        for call in mock_db.execute.call_args_list:
            sql = str(call[0][0])
            if "system_audit_trails" in sql:
                audit_params = call[0][1]
                break

        assert audit_params is not None, "No audit INSERT found"
        assert audit_params["action"] == "CONFIG_UPDATE"
        assert audit_params["table"] == "system_config"


class TestPatchConfig:
    def test_updates_ai_timeout(self, client: TestClient):
        """PATCH ai_timeout_seconds with a valid value returns 200."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_config_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/config/ai_timeout_seconds", json={"value": "120"})

        assert response.status_code == 200
        data = response.json()
        assert data["key"] == "ai_timeout_seconds"
        assert data["value"] == "120"
        assert data["status"] == "ok"

    def test_patch_triggers_audit_log(self, client: TestClient):
        """PATCH calls db.execute at least twice: UPDATE + audit INSERT."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_config_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        client.patch("/api/admin/config/alert_severity_threshold", json={"value": "2"})

        # At minimum: UPDATE system_config + INSERT system_audit_trails
        assert mock_db.execute.call_count >= 2
        sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("system_config" in s for s in sqls)
        assert any("system_audit_trails" in s for s in sqls)

    def test_rejects_unknown_key(self, client: TestClient):
        """PATCH with an unrecognised key returns 400."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        _, mock_get_db = _mock_config_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/config/nonexistent_key", json={"value": "1"})
        assert response.status_code == 400
        assert "Unknown config key" in response.json()["detail"]

    def test_returns_404_if_row_missing(self, client: TestClient):
        """PATCH a valid key whose row was deleted returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_config_db(fetchone_row=None)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/config/ai_timeout_seconds", json={"value": "30"})
        assert response.status_code == 404

    def test_requires_admin(self, client: TestClient):
        """Non-admin role cannot PATCH config."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user
        _, mock_get_db = _mock_config_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/config/ai_timeout_seconds", json={"value": "99"})
        assert response.status_code in (401, 403)

    def test_audit_log_includes_forensic_old_new_values(self, client: TestClient):
        """PATCH audit INSERT carries oldv/newv with correct old/new config_value."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        # Provide a fetchone row whose first element is the old config_value "3"
        old_row = MagicMock()
        old_row.__getitem__ = lambda self, i: "3"
        mock_db, mock_get_db = _mock_config_db(fetchone_row=old_row)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        client.patch("/api/admin/config/alert_severity_threshold", json={"value": "2"})

        # Collect the params from the audit INSERT call
        audit_params = None
        for call in mock_db.execute.call_args_list:
            sql = str(call[0][0])
            if "system_audit_trails" in sql and "oldv" in sql:
                audit_params = call[0][1]
                break

        assert audit_params is not None, "No audit INSERT with oldv/newv found"
        assert audit_params["oldv"] == '{"config_value": "3"}', (
            f"Expected oldv to be old config_value 3, got {audit_params['oldv']!r}"
        )
        assert audit_params["newv"] == '{"config_value": "2"}', (
            f"Expected newv to be new config_value 2, got {audit_params['newv']!r}"
        )


# =============================================================================
# Audit utility — serialization safety
# =============================================================================


class TestAuditSerialization:
    """Unit tests for log_system_audit() old/new value serialization."""

    def test_serializes_uuid_and_datetime_with_default_str(self):
        """Non-JSON-serializable types (UUID, datetime) are coerced by default=str."""
        import uuid as _uuid
        from datetime import datetime, timezone
        from utils.audit import log_system_audit

        mock_db = MagicMock()
        test_uuid = _uuid.UUID("12345678-1234-5678-1234-567812345678")
        test_dt = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)

        log_system_audit(
            db=mock_db,
            user_id="00000000-0000-0000-0000-000000000001",
            action_type="TEST_FORENSIC",
            table_affected="test_table",
            record_id=1,
            old_values={"uuid_col": test_uuid, "dt_col": test_dt},
            new_values={"uuid_col": test_uuid},
        )

        # Verify db.execute was called exactly once
        assert mock_db.execute.call_count == 1, "Expected exactly one db.execute call"

        call_args = mock_db.execute.call_args[0]
        params = call_args[1]

        # Neither call should have raised TypeError
        oldv = params["oldv"]
        newv = params["newv"]
        assert isinstance(oldv, str), f"oldv should be a JSON string, got {type(oldv)}"
        assert isinstance(newv, str), f"newv should be a JSON string, got {type(newv)}"
        assert str(test_uuid) in oldv
        assert "2026-06-14" in oldv

    def test_none_values_passed_as_none(self):
        """None old_values/new_values are passed as None, not JSON null."""
        from utils.audit import log_system_audit

        mock_db = MagicMock()
        log_system_audit(
            db=mock_db,
            user_id="00000000-0000-0000-0000-000000000001",
            action_type="TEST",
            table_affected="test",
            record_id=1,
            old_values=None,
            new_values=None,
        )

        params = mock_db.execute.call_args[0][1]
        assert params["oldv"] is None
        assert params["newv"] is None


# =============================================================================
# Suricata severity threshold consumer
# =============================================================================


class TestSuricataThresholdConsumer:
    """Unit tests for eve_to_threat_log_row with configurable high_threshold."""

    def setup_method(self):
        from services.suricata_ingestion import eve_to_threat_log_row

        self.fn = eve_to_threat_log_row

    def _eve(self, severity):
        return {
            "event_type": "alert",
            "src_ip": "1.1.1.1",
            "dest_ip": "10.0.0.1",
            "alert": {"signature_id": 1001, "severity": severity},
        }

    def test_default_threshold_3_maps_1_to_low(self):
        assert self.fn(self._eve(1))["severity_level"] == "LOW"

    def test_default_threshold_3_maps_2_to_medium(self):
        assert self.fn(self._eve(2))["severity_level"] == "MEDIUM"

    def test_default_threshold_3_maps_3_to_high(self):
        assert self.fn(self._eve(3))["severity_level"] == "HIGH"

    def test_threshold_2_escalates_medium_to_high(self):
        """With threshold=2, Suricata severity 2 is mapped to HIGH."""
        assert self.fn(self._eve(2), high_threshold=2)["severity_level"] == "HIGH"

    def test_threshold_2_keeps_1_as_low(self):
        """With threshold=2, Suricata severity 1 stays LOW."""
        assert self.fn(self._eve(1), high_threshold=2)["severity_level"] == "LOW"

    def test_none_severity_defaults_to_medium(self):
        assert self.fn(self._eve(None))["severity_level"] == "MEDIUM"


# =============================================================================
# AI timeout consumer
# =============================================================================


class TestAiTimeoutConsumer:
    """Verify analyze_threat_log reads ai_timeout_seconds from config."""

    @pytest.mark.asyncio
    async def test_analyze_uses_config_timeout(self):
        """analyze_threat_log uses ai_timeout_seconds from wims.system_config."""
        from services.ai_service import analyze_threat_log

        mock_db = MagicMock()

        log_row = (
            1,
            None,
            "1.1.1.1",
            "10.0.0.1",
            1001,
            "HIGH",
            "raw",
            None,
            None,
            None,
            None,
            None,
        )

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "system_config" in sql:
                r = MagicMock()
                r.__getitem__ = lambda self, i: "90"
                result.fetchone.return_value = r
            elif "security_threat_logs" in sql and "SELECT" in sql:
                result.fetchone.return_value = log_row
            else:
                result.fetchone.return_value = None
            return result

        mock_db.execute.side_effect = execute_side_effect

        captured_timeout = None

        class FakeResponse:
            status_code = 200

            def json(self):
                return {"response": '{"narrative": "test", "confidence": 0.9}'}

        class FakeClient:
            def __init__(self, timeout=None):
                nonlocal captured_timeout
                captured_timeout = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, *args, **kwargs):
                return FakeResponse()

        with patch("httpx.AsyncClient", FakeClient):
            with patch("services.ai_service.publish_security_event", new_callable=AsyncMock):
                await analyze_threat_log(1, mock_db)

        assert captured_timeout == 90.0, (
            f"Expected timeout=90.0 from config, got {captured_timeout}"
        )


# =============================================================================
# Worker timeout config keys (#354)
# =============================================================================


def _make_row(value):
    """Return a MagicMock that behaves like a DB row whose first element is value."""
    row = MagicMock()
    row.__getitem__ = lambda self, i: value
    return row


def _build_side_effect_db(stale_value="60", offline_value="300"):
    """
    Return (mock_db, mock_get_db) where mock_db.execute uses side_effect to
    return different rows for the stale-vs-offline cross-key lookups.

    The config route calls db.execute() at most 3 times for worker timeout keys:
      1. Cross-key SELECT (offline→stale or stale→offline)
      2. Old-row SELECT for the key being patched
      3. UPDATE system_config
      4. INSERT system_audit_trails

    Calls 1 and 2 need different fetchone() results.  Call 3's result rowcount
    doesn't matter.  Call 4 just needs to not throw.
    """
    results = []

    def _execute_side_effect(query, params=None):
        sql = str(query)
        result = MagicMock()
        result.rowcount = 1

        if "system_audit_trails" in sql:
            result.fetchone.return_value = None
            results.append(result)
            return result

        if (
            "SELECT config_value" in sql
            and "worker_stale_timeout_seconds" in sql
            and "worker_offline_timeout_seconds" not in sql
        ):
            result.fetchone.return_value = _make_row(stale_value)
        elif (
            "SELECT config_value" in sql
            and "worker_offline_timeout_seconds" in sql
            and "worker_stale_timeout_seconds" not in sql
        ):
            result.fetchone.return_value = _make_row(offline_value)
        else:
            # Generic fallback — used for the third old-row SELECT
            result.fetchone.return_value = _make_row("0")

        results.append(result)
        return result

    mock_db = MagicMock()
    mock_db.execute.side_effect = _execute_side_effect

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


class TestWorkerTimeoutConfigKeys:
    """Worker stale/offline timeout config keys (#354)."""

    def test_stale_timeout_rejects_below_minimum(self, client: TestClient):
        """worker_stale_timeout_seconds must be >= 30."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        app.dependency_overrides[get_db_with_rls] = lambda: MagicMock()

        response = client.patch(
            "/api/admin/config/worker_stale_timeout_seconds",
            json={"value": "15"},
        )
        assert response.status_code == 400
        assert "must be >=" in response.json()["detail"]

    def test_stale_timeout_accepts_minimum(self, client: TestClient):
        """worker_stale_timeout_seconds = 30 is valid."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _build_side_effect_db(stale_value="60", offline_value="300")
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/worker_stale_timeout_seconds",
            json={"value": "30"},
        )
        assert response.status_code == 200
        assert response.json()["value"] == "30"

    def test_offline_timeout_rejects_below_minimum(self, client: TestClient):
        """worker_offline_timeout_seconds must be >= 60."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        app.dependency_overrides[get_db_with_rls] = lambda: MagicMock()

        response = client.patch(
            "/api/admin/config/worker_offline_timeout_seconds",
            json={"value": "30"},
        )
        assert response.status_code == 400
        assert "must be >=" in response.json()["detail"]

    def test_offline_timeout_accepts_minimum(self, client: TestClient):
        """worker_offline_timeout_seconds = 60 is valid."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _build_side_effect_db(stale_value="30", offline_value="300")
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/worker_offline_timeout_seconds",
            json={"value": "60"},
        )
        assert response.status_code == 200
        assert response.json()["value"] == "60"

    def test_offline_must_be_greater_than_stale(self, client: TestClient):
        """Reject worker_offline_timeout_seconds <= worker_stale_timeout_seconds."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        # stale=90, offline would be set to 80 — must reject
        mock_db, mock_get_db = _build_side_effect_db(stale_value="90", offline_value="300")
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/worker_offline_timeout_seconds",
            json={"value": "80"},
        )
        assert response.status_code == 400
        assert "must be greater than" in response.json()["detail"]

    def test_stale_must_be_less_than_offline(self, client: TestClient):
        """Reject worker_stale_timeout_seconds >= worker_offline_timeout_seconds."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        # offline=200, stale would be set to 250 — must reject
        mock_db, mock_get_db = _build_side_effect_db(stale_value="60", offline_value="200")
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/worker_stale_timeout_seconds",
            json={"value": "250"},
        )
        assert response.status_code == 400
        assert "must be less than" in response.json()["detail"]

    def test_stale_timeout_valid_update(self, client: TestClient):
        """worker_stale_timeout_seconds = 45 is valid when offline=300."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _build_side_effect_db(stale_value="60", offline_value="300")
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/worker_stale_timeout_seconds",
            json={"value": "45"},
        )
        assert response.status_code == 200
        assert response.json()["value"] == "45"

    def test_offline_timeout_valid_update(self, client: TestClient):
        """worker_offline_timeout_seconds = 600 is valid when stale=60."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _build_side_effect_db(stale_value="60", offline_value="300")
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/config/worker_offline_timeout_seconds",
            json={"value": "600"},
        )
        assert response.status_code == 200
        assert response.json()["value"] == "600"

    def test_worker_timeout_audit_logged(self, client: TestClient):
        """Worker timeout config update produces audit INSERT."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _build_side_effect_db(stale_value="60", offline_value="300")
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        client.patch(
            "/api/admin/config/worker_stale_timeout_seconds",
            json={"value": "90"},
        )

        # Find the audit INSERT call
        audit_params = None
        for call in mock_db.execute.call_args_list:
            sql = str(call[0][0])
            if "system_audit_trails" in sql:
                audit_params = call[0][1]
                break

        assert audit_params is not None, "No audit INSERT found"
        assert audit_params["action"] == "CONFIG_UPDATE"
        assert audit_params["table"] == "system_config"
