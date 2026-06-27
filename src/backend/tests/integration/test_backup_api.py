"""
TDD: Backup Trigger and Management API — #46.

Red State: Endpoints do not exist.
Green State: POST /api/admin/backup returns 202 with filename/size,
            GET /api/admin/backups lists files, GET /api/admin/backup/{name} downloads.
"""

import json
import os
import re
import pytest
from unittest.mock import MagicMock, patch

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

        with (
            patch("subprocess.run") as mock_run,
            patch("pathlib.Path.mkdir") as _mock_mkdir,
            patch("pathlib.Path.stat") as mock_stat,
            patch("utils.backup_crypto.encrypt_backup") as mock_encrypt,
        ):
            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            mock_encrypted_path = MagicMock()
            mock_encrypted_path.name = "wims_20250510_120000.sql.enc"
            mock_encrypted_path.stat.return_value.st_size = 12345
            mock_encrypted_path.stat.return_value.st_mtime = 1746432000.0
            mock_encrypt.return_value = mock_encrypted_path

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

        with (
            patch("subprocess.run") as mock_run,
            patch("pathlib.Path.mkdir") as _mock_mkdir,
            patch("pathlib.Path.stat") as mock_stat,
            patch("utils.backup_crypto.encrypt_backup") as mock_encrypt,
        ):
            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            mock_encrypted_path = MagicMock()
            mock_encrypted_path.name = "wims_20250510_120000.sql.enc"
            mock_encrypted_path.stat.return_value.st_size = 12345
            mock_encrypted_path.stat.return_value.st_mtime = 1746432000.0
            mock_encrypt.return_value = mock_encrypted_path

            response = client.post("/api/admin/backup")
            assert response.status_code == 202
            filename = response.json()["filename"]
            assert re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", filename)

    def test_backup_file_is_valid_sql(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("subprocess.run") as mock_run,
            patch("pathlib.Path.mkdir") as _mock_mkdir,
            patch("pathlib.Path.stat") as mock_stat,
            patch("utils.backup_crypto.encrypt_backup") as mock_encrypt,
        ):
            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            mock_encrypted_path = MagicMock()
            mock_encrypted_path.name = "wims_20250510_120000.sql.enc"
            mock_encrypted_path.stat.return_value.st_size = 12345
            mock_encrypted_path.stat.return_value.st_mtime = 1746432000.0
            mock_encrypt.return_value = mock_encrypted_path

            response = client.post("/api/admin/backup")
            assert response.status_code == 202
            assert response.json()["size_bytes"] > 0

    def test_list_backups_returns_empty_initially(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        with patch("pathlib.Path.mkdir"), patch("pathlib.Path.glob") as mock_glob:
            mock_glob.return_value = []
            response = client.get("/api/admin/backups")
            assert response.status_code == 200
            assert isinstance(response.json(), list)

    def test_list_backups_shows_created_backup(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        fake_file = MagicMock()
        fake_file.name = "wims_20250505_120000.sql.enc"
        fake_file.stat.return_value.st_size = 5432
        fake_file.stat.return_value.st_mtime = 1746432000.0

        with patch("pathlib.Path.mkdir"), patch("pathlib.Path.glob") as mock_glob:
            mock_glob.return_value = [fake_file]
            response = client.get("/api/admin/backups")
            assert response.status_code == 200
            items = response.json()
            assert any(item["filename"] == "wims_20250505_120000.sql.enc" for item in items)
            for item in items:
                assert "filename" in item
                assert "size_bytes" in item
                assert "created_at" in item

    def test_download_backup_returns_200(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        fake_stat_result = os.stat_result((0o100644, 1, 0, 0, 0, 0, 12345, 0, 0, 0))

        with (
            patch("pathlib.Path.exists", return_value=True),
            patch("starlette.responses.os.stat", return_value=fake_stat_result),
            patch(
                "builtins.open",
                MagicMock(return_value=MagicMock(read=MagicMock(return_value=b"fake sql content"))),
            ),
        ):
            response = client.get("/api/admin/backup/wims_20250505_120000.sql.enc")
            assert response.status_code == 200
            assert "wims_20250505_120000.sql.enc" in response.headers.get("Content-Disposition", "")

    def test_download_backup_returns_404_for_missing(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        with patch("pathlib.Path.exists") as mock_exists:
            mock_exists.return_value = False
            response = client.get("/api/admin/backup/wims_20250505_120000.sql.enc")
            assert response.status_code == 404

    def test_download_backup_blocks_path_traversal(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.get("/api/admin/backup/../../../etc/passwd")
        assert response.status_code in (400, 404)

    def test_download_backup_blocks_non_encrypted_extension(self, client):
        """Requests for .sql (unencrypted) backups must be rejected."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        response = client.get("/api/admin/backup/wims_20250505_120000.sql")
        assert response.status_code == 400

    def test_backup_writes_audit_log(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("subprocess.run") as mock_run,
            patch("pathlib.Path.mkdir") as _mock_mkdir,
            patch("pathlib.Path.stat") as mock_stat,
            patch("api.routes.admin.backups.log_system_audit") as mock_audit,
            patch("utils.backup_crypto.encrypt_backup") as mock_encrypt,
        ):
            mock_stat.return_value.st_size = 12345
            mock_run.return_value = MagicMock(returncode=0, stderr="")

            mock_encrypted_path = MagicMock()
            mock_encrypted_path.name = "wims_20250510_120000.sql.enc"
            mock_encrypted_path.stat.return_value.st_size = 12345
            mock_encrypted_path.stat.return_value.st_mtime = 1746432000.0
            mock_encrypt.return_value = mock_encrypted_path

            response = client.post("/api/admin/backup")
            assert response.status_code == 202

            mock_audit.assert_called_once()
            call_kwargs = mock_audit.call_args
            assert "BACKUP_TRIGGERED" in str(call_kwargs)


class TestDeleteBackup:
    def test_delete_existing_backup_returns_204(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.exists", return_value=True),
            patch("pathlib.Path.unlink"),
            patch("api.routes.admin.backups.log_system_audit") as mock_audit,
        ):
            response = client.delete("/api/admin/backup/wims_20250505_120000.sql.enc")
            assert response.status_code == 204
            mock_audit.assert_called_once()

    def test_delete_missing_backup_returns_404(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.exists", return_value=False),
        ):
            response = client.delete("/api/admin/backup/wims_20250505_120000.sql.enc")
            assert response.status_code == 404

    def test_delete_blocks_path_traversal(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.delete("/api/admin/backup/../../../etc/passwd")
        assert response.status_code in (400, 404)

    def test_delete_blocks_invalid_filename(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.delete("/api/admin/backup/not_a_backup.txt")
        assert response.status_code == 400


class TestBackupManifest:
    def test_get_manifest_for_existing_backup(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        fake_manifest = {
            "backup_filename": "wims_20250505_120000.sql.enc",
            "triggered_at": "2026-05-05T12:00:00Z",
            "provider": "openbao_transit",
            "record_counts": {"incidents": 847, "citizens": 2103, "users": 24},
            "last_updates": {
                "incident": "2026-05-05T11:55:00Z",
                "citizen_report": "2026-05-05T10:30:00Z",
                "user_change": "2026-05-05T09:00:00Z",
            },
        }

        mock_manifest_path = MagicMock()
        mock_manifest_path.exists.return_value = True
        mock_manifest_path.read_text.return_value = json.dumps(fake_manifest)

        with (
            patch("pathlib.Path.mkdir"),
            patch("api.routes.admin.backups.BACKUP_DIR") as mock_dir,
        ):
            mock_dir.__truediv__.return_value = mock_manifest_path
            response = client.get("/api/admin/backup/wims_20250505_120000.sql.enc/manifest")
            assert response.status_code == 200
            data = response.json()
            assert data["provider"] == "openbao_transit"
            assert data["record_counts"]["incidents"] == 847

    def test_get_manifest_for_legacy_backup_returns_404(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_manifest_path = MagicMock()
        mock_manifest_path.exists.return_value = False

        with (
            patch("pathlib.Path.mkdir"),
            patch("api.routes.admin.backups.BACKUP_DIR") as mock_dir,
        ):
            mock_dir.__truediv__.return_value = mock_manifest_path
            response = client.get("/api/admin/backup/wims_20250505_120000.sql.enc/manifest")
            assert response.status_code == 404

    def test_get_manifest_blocks_path_traversal(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        response = client.get("/api/admin/backup/../../../etc/passwd/manifest")
        assert response.status_code in (400, 404)


class TestBackupSchedule:
    def test_get_schedule_returns_none_when_not_configured(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        result_proxy = MagicMock()
        result_proxy.one_or_none.return_value = None
        mock_db.execute.return_value.mappings.return_value = result_proxy
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.get("/api/admin/backup-schedule")
        assert response.status_code == 200
        assert response.json() is None

    def test_save_schedule_returns_ok(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.admin.backup_schedule.log_system_audit"),
        ):
            response = client.post(
                "/api/admin/backup-schedule",
                json={"enabled": True, "cron_expr": "0 2 * * *"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert data["enabled"] is True

    def test_save_schedule_rejects_invalid_cron(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.post(
            "/api/admin/backup-schedule",
            json={"enabled": True, "cron_expr": "not-a-cron"},
        )
        assert response.status_code == 422

    def test_save_schedule_writes_audit_log(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_db = MagicMock()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.admin.backup_schedule.log_system_audit") as mock_audit,
        ):
            response = client.post(
                "/api/admin/backup-schedule",
                json={"enabled": True, "cron_expr": "0 */12 * * *"},
            )
            assert response.status_code == 200
            mock_audit.assert_called_once()


class TestListBackupsWithManifest:
    def test_list_backups_folds_manifest_data(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        fake_file = MagicMock()
        fake_file.name = "wims_20250505_120000.sql.enc"
        fake_file.stat.return_value.st_size = 5432
        fake_file.stat.return_value.st_mtime = 1746432000.0

        fake_manifest = {
            "record_counts": {"incidents": 100, "citizens": 200, "users": 5},
            "last_updates": {
                "incident": "2026-05-05T11:55:00Z",
                "citizen_report": "2026-05-05T10:30:00Z",
                "user_change": "2026-05-05T09:00:00Z",
            },
        }

        mock_manifest_path = MagicMock()
        mock_manifest_path.exists.return_value = True
        mock_manifest_path.read_text.return_value = json.dumps(
            {
                "provider": "openbao_transit",
                **fake_manifest,
            }
        )

        with (
            patch("pathlib.Path.mkdir"),
            patch("api.routes.admin.backups.BACKUP_DIR") as mock_dir,
        ):
            # glob returns the fake_file, __truediv__/.manifest.json returns mock_manifest_path
            mock_dir.glob.return_value = [fake_file]
            mock_dir.__truediv__.return_value = mock_manifest_path

            response = client.get("/api/admin/backups")
            assert response.status_code == 200
            items = response.json()
            assert len(items) == 1
            item = items[0]
            assert item["provider"] == "openbao_transit"
            assert item["manifest"] is not None
            assert item["manifest"]["record_counts"]["incidents"] == 100

    def test_list_backups_legacy_backup_has_null_manifest(self, client):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        fake_file = MagicMock()
        fake_file.name = "wims_20250505_120000.sql.enc"
        fake_file.stat.return_value.st_size = 5432
        fake_file.stat.return_value.st_mtime = 1746432000.0

        mock_manifest_path = MagicMock()
        mock_manifest_path.exists.return_value = False  # legacy — no manifest

        with (
            patch("pathlib.Path.mkdir"),
            patch("api.routes.admin.backups.BACKUP_DIR") as mock_dir,
        ):
            mock_dir.glob.return_value = [fake_file]
            mock_dir.__truediv__.return_value = mock_manifest_path

            response = client.get("/api/admin/backups")
            assert response.status_code == 200
            items = response.json()
            assert len(items) == 1
            item = items[0]
            assert item["provider"] is None
            assert item["manifest"] is None
