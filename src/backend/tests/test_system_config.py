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
]


def _mock_config_db(rows=None, update_rowcount=1):
    mock_result = MagicMock()
    mock_result.fetchall.return_value = rows if rows is not None else _SEED_ROWS
    mock_result.rowcount = update_rowcount
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
        """GET /admin/config returns all four seed config keys."""
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
        mock_db, mock_get_db = _mock_config_db(update_rowcount=0)
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
        """analyze_threat_log uses the timeout value from wims.system_config."""
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

        call_count = 0

        def execute_side_effect(query, params=None):
            nonlocal call_count
            result = MagicMock()
            sql = str(query)
            if "system_config" in sql:
                r = MagicMock()
                r.__getitem__ = lambda self, i: "120"
                result.fetchone.return_value = r
            elif "security_threat_logs" in sql and "SELECT" in sql:
                result.fetchone.return_value = log_row
            else:
                result.fetchone.return_value = None
            call_count += 1
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

        assert captured_timeout == 120.0, (
            f"Expected timeout=120.0 from config, got {captured_timeout}"
        )
