"""System Admin API — backup management routes."""

import hashlib
import logging
import os
import re
import subprocess
import tempfile
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from utils.audit import log_system_audit
from utils.upload_validation import safe_read_upload, sanitize_filename

logger = logging.getLogger("wims.admin")
router = APIRouter()

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/storage/backups"))
BACKUP_MAX_FILES = int(os.environ.get("BACKUP_MAX_FILES", "100"))
_BACKUP_DIR_READY = False


def _ensure_backup_dir() -> None:
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


@router.post("/backup", status_code=202)
async def trigger_backup(
    request: Request,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Trigger a pg_dump backup of the wims database."""
    _ensure_backup_dir()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"wims_{timestamp}.sql"
    output_path = BACKUP_DIR / filename

    db_url = os.environ.get("DATABASE_URL", "")
    try:
        parsed = urllib.parse.urlparse(db_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Invalid DATABASE_URL: {e}")

    if parsed.scheme != "postgresql":
        raise HTTPException(status_code=500, detail="DATABASE_URL must use postgresql:// scheme")

    db_user = parsed.username or ""
    db_pass = parsed.password or ""
    db_host = parsed.hostname or ""
    db_port = str(parsed.port) if parsed.port else "5432"
    db_name = parsed.path.lstrip("/") or ""

    if not db_host or not db_user:
        raise HTTPException(status_code=500, detail="Invalid DATABASE_URL format")

    env = os.environ.copy()
    env["PGPASSWORD"] = db_pass

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
        raise HTTPException(status_code=504, detail="Backup timed out after 120s")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="pg_dump not found in PATH")

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"pg_dump failed: {result.stderr[:500]}",
        )

    try:
        from utils.backup_crypto import encrypt_backup

        encrypted_path = encrypt_backup(output_path)
        filename = encrypted_path.name
    except Exception as e:
        logger.error(f"Backup encryption failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Backup created but encryption failed: {e}",
        )

    size_bytes = encrypted_path.stat().st_size
    try:
        created_ts = float(encrypted_path.stat().st_mtime)
        created_at = datetime.fromtimestamp(created_ts, timezone.utc).isoformat()
    except Exception:
        created_at = datetime.now(timezone.utc).isoformat()
    _apply_backup_retention()

    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="BACKUP_TRIGGERED",
        table_affected="wims",
        record_id=None,
        request=request,
    )
    db.commit()

    return {
        "filename": filename,
        "size_bytes": size_bytes,
        "created_at": created_at,
    }


@router.get("/backups")
async def list_backups(
    current_user: dict = Depends(get_system_admin),
):
    """List all available backup files sorted newest first."""
    _ensure_backup_dir()

    files = []
    for f in BACKUP_DIR.glob("wims_*.sql.enc"):
        stat = f.stat()
        files.append(
            {
                "filename": f.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            }
        )

    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files


@router.get("/backup/{filename}")
async def download_backup(
    filename: str,
    current_user: dict = Depends(get_system_admin),
):
    """Download a specific backup file."""
    _ensure_backup_dir()

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", filename):
        raise HTTPException(status_code=400, detail="Invalid backup filename format")

    file_path = BACKUP_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type="application/octet-stream",
    )


@router.post("/restore", status_code=200)
async def restore_backup(
    file: UploadFile = File(...),
    request: Request = None,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Restore wims database from an encrypted backup file."""
    # ── Deep checks (#391): filename sanitization, size cap, header validation
    filename = sanitize_filename(file.filename)
    if not re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", filename):
        raise HTTPException(status_code=400, detail="Invalid backup file format")

    # App-level size cap (50 MB default for backup files).
    _max_backup_bytes = int(os.getenv("WIMS_MAX_BACKUP_BYTES", str(50 * 1024 * 1024)))

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_enc = Path(tmpdir) / filename
        # safe_read_upload enforces the cap while streaming from disk.
        content = await safe_read_upload(file, _max_backup_bytes)
        tmp_enc.write_bytes(content)

        # Header validation: WIMSBAO1 magic header for our encrypted backup format.
        if not content.startswith(b"WIMSBAO1"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Backup file header invalid: missing WIMSBAO1 magic. "
                    "File may be corrupted or not a WIMS encrypted backup."
                ),
            )

        # Pre-restore SHA-256 checksum stored for forensic completeness.
        sha256_digest = hashlib.sha256(content).hexdigest()
        logger.info(
            "Backup restore initiated by user=%s, file=%s, sha256=%s, size=%d",
            current_user.get("user_id"),
            filename,
            sha256_digest,
            len(content),
        )

        try:
            from utils.backup_crypto import decrypt_backup

            tmp_sql = decrypt_backup(tmp_enc)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Decryption failed: {e}")

        db_url = os.environ.get("DATABASE_URL", "")
        try:
            parsed = urllib.parse.urlparse(db_url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Invalid DATABASE_URL: {e}")

        if parsed.scheme != "postgresql":
            raise HTTPException(
                status_code=500, detail="DATABASE_URL must use postgresql:// scheme"
            )

        db_user = parsed.username or ""
        db_pass = parsed.password or ""
        db_host = parsed.hostname or ""
        db_port = str(parsed.port) if parsed.port else "5432"
        db_name = parsed.path.lstrip("/") or ""

        if not db_host or not db_user:
            raise HTTPException(status_code=500, detail="Invalid DATABASE_URL format")

        env = os.environ.copy()
        env["PGPASSWORD"] = db_pass

        try:
            result = subprocess.run(
                [
                    "psql",
                    "-h",
                    db_host,
                    "-p",
                    db_port,
                    "-U",
                    db_user,
                    "-d",
                    db_name,
                    "-f",
                    str(tmp_sql),
                    "--no-password",
                ],
                env=env,
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Restore timed out after 180s")
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="psql not found in PATH")

        if result.returncode != 0:
            raise HTTPException(
                status_code=500, detail=f"psql restore failed: {result.stderr[:500]}"
            )

    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="BACKUP_RESTORED",
        table_affected="wims",
        record_id=None,
        request=request,
        new_values={
            "filename": filename,
            "size_bytes": len(content),
            "sha256": sha256_digest,
        },
    )
    db.commit()

    return {
        "status": "ok",
        "filename": filename,
        "restored_at": datetime.utcnow().isoformat(),
    }
