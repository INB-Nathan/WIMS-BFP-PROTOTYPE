"""
TDD: Backup Trigger and Management API — #46.

Red State: Endpoints do not exist.
Green State: POST /api/admin/backup returns 202 with filename/size,
            GET /api/admin/backups lists files, GET /api/admin/backup/{name} downloads.
"""

import os
import re
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch, ANY
from datetime import datetime
from fastapi.testclient import TestClient

import auth
from database import get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def mock_admin_user():
    return {
        "user_id": "test-uuid",
        "keycloak_id": "kid",
        "username": "test-username",
        "role": "SYSTEM_ADMIN",
    }


def mock_encoder_user():
    return {
        "user_id": "test-uuid",
        "keycloak_id": "kid",
        "username": "test-username",
        "role": "REGIONAL_ENCODER",
    }


class TestBackupAPI:

    def test_backup_trigger_returns_403_for_non_admin(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user
        response = client.post("/api/admin/backup")
        assert response.status_code == 403

    def test_backup_trigger_returns_202_for_admin(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("subprocess.run") as mock_run, \
             patch("pathlib.Path.mkdir") as mock_mkdir, \
             patch("pathlib.Path.stat") as mock_stat:

            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            response = client.post("/api/admin/backup")
            assert response.status_code == 202
            data = response.json()
            assert "filename" in data
            assert "size_bytes" in data
            assert "created_at" in data

    def test_backup_filename_format(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("subprocess.run") as mock_run, \
             patch("pathlib.Path.mkdir") as mock_mkdir, \
             patch("pathlib.Path.stat") as mock_stat:

            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            response = client.post("/api/admin/backup")
            assert response.status_code == 202
            filename = response.json()["filename"]
            assert re.match(r"^wims_\d{8}_\d{6}\.sql$", filename)

    def test_backup_file_is_valid_sql(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("subprocess.run") as mock_run, \
             patch("pathlib.Path.mkdir") as mock_mkdir, \
             patch("pathlib.Path.stat") as mock_stat:

            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            response = client.post("/api/admin/backup")
            assert response.status_code == 202
            assert response.json()["size_bytes"] > 0

    def test_list_backups_returns_empty_initially(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        with patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.glob") as mock_glob:
            mock_glob.return_value = []
            response = client.get("/api/admin/backups")
            assert response.status_code == 200
            assert isinstance(response.json(), list)

    def test_list_backups_shows_created_backup(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        fake_file = MagicMock()
        fake_file.name = "wims_20250505_120000.sql"
        fake_file.stat.return_value.st_size = 5432
        fake_file.stat.return_value.st_mtime = 1746432000.0

        with patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.glob") as mock_glob:
            mock_glob.return_value = [fake_file]
            response = client.get("/api/admin/backups")
            assert response.status_code == 200
            items = response.json()
            assert any(item["filename"] == "wims_20250505_120000.sql" for item in items)
            for item in items:
                assert "filename" in item
                assert "size_bytes" in item
                assert "created_at" in item

    def test_download_backup_returns_200(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        fake_stat_result = os.stat_result((0o100644, 1, 0, 0, 0, 0, 12345, 0, 0, 0))

        with patch("pathlib.Path.exists", return_value=True), \
             patch("starlette.responses.os.stat", return_value=fake_stat_result), \
             patch("builtins.open", MagicMock(return_value=MagicMock(read=MagicMock(return_value=b"fake sql content")))):
            response = client.get("/api/admin/backup/wims_20250505_120000.sql")
            assert response.status_code == 200
            assert "wims_20250505_120000.sql" in response.headers.get("Content-Disposition", "")

    def test_download_backup_returns_404_for_missing(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        with patch("pathlib.Path.exists") as mock_exists:
            mock_exists.return_value = False
            response = client.get("/api/admin/backup/wims_20250505_120000.sql")
            assert response.status_code == 404

    def test_download_backup_blocks_path_traversal(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.get("/api/admin/backup/../../../etc/passwd")
        assert response.status_code in (400, 404)

    def test_backup_writes_audit_log(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("subprocess.run") as mock_run, \
             patch("pathlib.Path.mkdir") as mock_mkdir, \
             patch("pathlib.Path.stat") as mock_stat, \
             patch("api.routes.admin.log_system_audit") as mock_audit:

            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            response = client.post("/api/admin/backup")
            assert response.status_code == 202

            mock_audit.assert_called_once()
            call_kwargs = mock_audit.call_args
            assert "BACKUP_TRIGGERED" in str(call_kwargs)
