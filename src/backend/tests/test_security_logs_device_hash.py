"""Tests for device_token_hash exposure on GET /api/admin/security-logs
(Wayfinder — issue #571 modified blocking flow needs to know per-row whether
a device hash exists to offer "Block Device" vs "Block IP").
"""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from main import app

_ADMIN = {
    "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "keycloak_id": "kid-admin",
    "username": "admin",
    "role": "SYSTEM_ADMIN",
}

# 18-element row: the 17 pre-existing columns + device_token_hash.
_ROW_WITH_DEVICE_HASH = (
    1,
    None,
    "10.0.0.1",
    "10.0.0.2",
    1001,
    "HIGH",
    "{}",
    None,
    None,
    None,  # xai_confidence_breakdown
    None,  # admin_action_taken
    None,  # resolved_at
    None,  # reviewed_by
    None,  # hitl_decision
    None,  # classification
    None,  # suricata_signature
    None,  # suricata_category
    "abc123devicehash",  # device_token_hash
)

# 17-element row — the pre-#568 shape, still used by older test fixtures.
_ROW_WITHOUT_DEVICE_HASH_COLUMN = (
    2,
    None,
    "10.0.0.3",
    "10.0.0.4",
    1002,
    "HIGH",
    "{}",
    None,
    None,
    None,
    None,
    None,
    None,
    None,
    None,
    None,
    None,
)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def _make_list_db(rows, total):
    mock_rows = MagicMock()
    mock_rows.fetchall.return_value = rows
    mock_count = MagicMock()
    mock_count.scalar.return_value = total
    mock_db = MagicMock()
    mock_db.execute.side_effect = [mock_rows, mock_count]

    def _get_db():
        yield mock_db

    return mock_db, _get_db


class TestDeviceTokenHashExposure:
    def test_row_with_device_hash_exposes_it(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_ROW_WITH_DEVICE_HASH], total=1)
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs")

        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["device_token_hash"] == "abc123devicehash"

    def test_legacy_17_element_row_defaults_to_none(self, client: TestClient):
        """A row shaped before issue #568 (no device_token_hash column) must
        not raise IndexError — it simply reports None."""
        app.dependency_overrides[auth.get_current_wims_user] = lambda: _ADMIN
        mock_db, _get_db = _make_list_db([_ROW_WITHOUT_DEVICE_HASH_COLUMN], total=1)
        app.dependency_overrides[get_db_with_rls] = _get_db

        resp = client.get("/api/admin/security-logs")

        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["device_token_hash"] is None
