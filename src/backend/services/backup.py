"""Backup management service — core business logic.

All non-trivial backup operations live here, not in route handlers.
Both the HTTP route module and the Celery scheduled task import from here.
"""

import json
import logging
import os
import re
import subprocess
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("wims.services.backup")

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/storage/backups"))
BACKUP_MAX_FILES = int(os.environ.get("BACKUP_MAX_FILES", "100"))
_BACKUP_DIR_READY = False


class BackupError(Exception):
    """Domain exception for backup operations.

    Raised by service methods when a recoverable backup error occurs.
    HTTP route handlers wrap this into HTTPException; Celery tasks
    handle it as a regular exception.
    """

    def __init__(self, message: str, status_code: int = 500) -> None:
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def ensure_backup_dir() -> None:
    """Create backup directory lazily once per process."""
    global _BACKUP_DIR_READY
    if _BACKUP_DIR_READY:
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    _BACKUP_DIR_READY = True


def _apply_backup_retention() -> None:
    """Delete oldest backups when count exceeds BACKUP_MAX_FILES."""
    if BACKUP_MAX_FILES <= 0:
        return

    def _mtime(path: Path) -> float:
        try:
            return float(path.stat().st_mtime)
        except Exception:
            return 0.0

    backups: list[Path] = []
    try:
        with os.scandir(BACKUP_DIR) as entries:
            for entry in entries:
                if entry.is_file() and re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", entry.name):
                    backups.append(BACKUP_DIR / entry.name)
    except FileNotFoundError:
        return

    backups.sort(key=_mtime, reverse=True)
    stale = backups[BACKUP_MAX_FILES:]
    for backup_path in stale:
        try:
            backup_path.unlink()
        except FileNotFoundError:
            continue

        # Delete sibling manifest to prevent orphaned files
        # Use string concat, NOT with_suffix — the filename has two extensions (.sql.enc)
        manifest_path = BACKUP_DIR / (backup_path.name + ".manifest.json")
        try:
            manifest_path.unlink()
        except FileNotFoundError:
            pass


def trigger_backup(db: Session) -> dict:
    """Execute the core backup logic — pg_dump, encrypt, manifest, retention.

    This is called by both the HTTP endpoint and the Celery scheduled task.
    The caller is responsible for audit logging and commit.

    Raises BackupError on any recoverable failure.
    """
    ensure_backup_dir()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"wims_{timestamp}.sql"
    output_path = BACKUP_DIR / filename

    db_url = os.environ.get("DATABASE_URL", "")
    try:
        parsed = urllib.parse.urlparse(db_url)
    except Exception:
        logger.exception("Invalid DATABASE_URL")
        raise BackupError("Invalid DATABASE_URL")

    if parsed.scheme != "postgresql":
        raise BackupError("DATABASE_URL must use postgresql:// scheme")

    db_user = parsed.username or ""
    db_pass = parsed.password or ""
    db_host = parsed.hostname or ""
    db_port = str(parsed.port) if parsed.port else "5432"
    db_name = parsed.path.lstrip("/") or ""

    if not db_host or not db_user:
        raise BackupError("Invalid DATABASE_URL format")

    env = os.environ.copy()
    env["PGPASSWORD"] = db_pass

    # ── Backup manifest snapshot (before pg_dump) ────────────────────
    from utils.backup_crypto import _resolve_backup_provider

    manifest_data = {}
    created_at = datetime.now(timezone.utc).isoformat()
    try:
        snapshot = (
            db.execute(
                text("""
            SELECT
                (SELECT COUNT(*) FROM wims.fire_incidents) AS incident_count,
                (SELECT COUNT(*) FROM wims.citizen_reports) AS citizen_count,
                (SELECT COUNT(*) FROM wims.users) AS user_count,
                (SELECT MAX(updated_at) FROM wims.fire_incidents) AS last_incident_update,
                (SELECT MAX(created_at) FROM wims.citizen_reports) AS last_citizen_report,
                (SELECT MAX(created_at) FROM wims.users) AS last_user_change
        """)
            )
            .mappings()
            .one()
        )

        manifest_data = {
            "backup_filename": filename,
            "triggered_at": created_at,
            "provider": _resolve_backup_provider(),
            "record_counts": {
                "incidents": snapshot["incident_count"],
                "citizens": snapshot["citizen_count"],
                "users": snapshot["user_count"],
            },
            "last_updates": {
                "incident": snapshot["last_incident_update"].isoformat()
                if snapshot["last_incident_update"]
                else None,
                "citizen_report": snapshot["last_citizen_report"].isoformat()
                if snapshot["last_citizen_report"]
                else None,
                "user_change": snapshot["last_user_change"].isoformat()
                if snapshot["last_user_change"]
                else None,
            },
        }
    except Exception:
        logger.warning("Failed to capture backup manifest snapshot (non-fatal)", exc_info=True)

    try:
        result = subprocess.run(
            [
                "pg_dump",
                "-h",
                db_host,
                "-p",
                db_port,
                "-U",
                db_user,
                "-d",
                db_name,
                "-f",
                str(output_path),
                "--no-password",
                "--clean",
                "--if-exists",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise BackupError("Backup timed out after 120s", status_code=504)
    except FileNotFoundError:
        raise BackupError("pg_dump not found in PATH")

    if result.returncode != 0:
        raise BackupError(f"pg_dump failed: {result.stderr[:500]}")

    try:
        from utils.backup_crypto import encrypt_backup

        encrypted_path = encrypt_backup(output_path)
        filename = encrypted_path.name
    except Exception:
        logger.exception("Backup encryption failed")
        raise BackupError("Backup created but encryption failed")

    # ── Write backup manifest (separate try/except — backup file is intact) ──
    if manifest_data:
        try:
            manifest_path = BACKUP_DIR / (encrypted_path.name + ".manifest.json")
            manifest_path.write_text(json.dumps(manifest_data, indent=2))
        except Exception as e:
            logger.warning("Backup manifest write failed (non-fatal): %s", e)

    size_bytes = encrypted_path.stat().st_size
    try:
        created_ts = float(encrypted_path.stat().st_mtime)
        created_at = datetime.fromtimestamp(created_ts, timezone.utc).isoformat()
    except Exception:
        created_at = datetime.now(timezone.utc).isoformat()
    _apply_backup_retention()

    return {
        "filename": filename,
        "size_bytes": size_bytes,
        "created_at": created_at,
    }
