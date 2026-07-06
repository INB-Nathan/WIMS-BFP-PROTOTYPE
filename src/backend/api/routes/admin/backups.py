"""System Admin API — backup management routes.

Routes stay thin — business logic lives in services/backup.py.
"""

import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from services.backup import (
    BACKUP_DIR,
    BackupError,
    ensure_backup_dir,
)
from services.backup import (
    trigger_backup as svc_trigger_backup,
)
from utils.audit import log_system_audit
from utils.upload_validation import sanitize_filename

logger = logging.getLogger("wims.admin")
router = APIRouter()


@router.post("/backup", status_code=202)
async def trigger_backup(
    request: Request,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Trigger a pg_dump backup of the wims database."""
    try:
        result = svc_trigger_backup(db)
    except BackupError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="BACKUP_TRIGGERED",
        table_affected="wims",
        record_id=None,
        request=request,
    )
    db.commit()

    return result


@router.get("/backups")
async def list_backups(
    current_user: dict = Depends(get_system_admin),
):
    """List all available backup files sorted newest first."""
    ensure_backup_dir()

    files = []
    for f in BACKUP_DIR.glob("wims_*.sql.enc"):
        stat = f.stat()
        entry = {
            "filename": f.name,
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        }

        # Fold manifest data server-side (avoid N+1 client fetch)
        # Path: wims_20260627_143000.sql.enc + ".manifest.json" (string concat, NOT with_suffix)
        manifest_path = BACKUP_DIR / (f.name + ".manifest.json")
        if manifest_path.exists():
            try:
                manifest_data = json.loads(manifest_path.read_text())
                entry["provider"] = manifest_data.get("provider")
                entry["manifest"] = {
                    "record_counts": manifest_data.get("record_counts"),
                    "last_updates": manifest_data.get("last_updates"),
                }
            except (json.JSONDecodeError, OSError):
                entry["manifest"] = None
                entry["provider"] = None
        else:
            entry["provider"] = None
            entry["manifest"] = None  # legacy backup — no manifest available

        files.append(entry)

    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files


@router.get("/backup/{filename}")
async def download_backup(
    filename: str,
    current_user: dict = Depends(get_system_admin),
):
    """Download a specific backup file."""
    ensure_backup_dir()

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


@router.delete("/backup/{filename}", status_code=204)
async def delete_backup(
    filename: str,
    request: Request,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Delete a specific backup file and its manifest."""
    ensure_backup_dir()

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", filename):
        raise HTTPException(status_code=400, detail="Invalid backup filename format")

    file_path = BACKUP_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    file_path.unlink()

    # Delete sibling manifest (string concat, NOT with_suffix)
    manifest_path = BACKUP_DIR / (filename + ".manifest.json")
    try:
        manifest_path.unlink()
    except FileNotFoundError:
        pass

    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="BACKUP_DELETED",
        table_affected="wims",
        record_id=None,
        request=request,
        new_values={"filename": filename},
    )
    db.commit()

    return None  # 204


@router.get("/backup/{filename}/manifest")
async def get_backup_manifest(
    filename: str,
    current_user: dict = Depends(get_system_admin),
):
    """Get the manifest for a specific backup file."""
    ensure_backup_dir()

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", filename):
        raise HTTPException(status_code=400, detail="Invalid backup filename format")

    manifest_path = BACKUP_DIR / f"{filename}.manifest.json"
    if not manifest_path.exists():
        raise HTTPException(
            status_code=404, detail="Manifest not found for this backup (legacy backup)"
        )

    try:
        return json.loads(manifest_path.read_text())
    except (json.JSONDecodeError, OSError):
        raise HTTPException(status_code=500, detail="Manifest file corrupted")


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

    # App-level size cap (1 GB default for backup files).
    _max_backup_bytes = int(os.getenv("WIMS_MAX_BACKUP_BYTES", str(1024 * 1024 * 1024)))

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_enc = Path(tmpdir) / filename

        # Stream upload to disk (not in-memory) with incremental size cap + SHA-256
        sha256_hash = hashlib.sha256()
        total_bytes = 0
        with open(tmp_enc, "wb") as f:
            while chunk := await file.read(64 * 1024):
                total_bytes += len(chunk)
                if total_bytes > _max_backup_bytes:
                    # Abort early — disk exhaustion guard
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {_max_backup_bytes // (1024 * 1024)} MB limit",
                    )
                f.write(chunk)
                sha256_hash.update(chunk)

        # Do not pre-filter by header here: decrypt_backup() auto-detects
        # both legacy env-AES-GCM backups and WIMSBAO1/OpenBao backups.

        # SHA-256 was already computed incrementally during streaming
        sha256_digest = sha256_hash.hexdigest()
        logger.info(
            "Backup restore initiated by user=%s, file=%s, sha256=%s, size=%d",
            current_user.get("user_id"),
            filename,
            sha256_digest,
            total_bytes,
        )

        try:
            from utils.backup_crypto import decrypt_backup

            tmp_sql = decrypt_backup(tmp_enc)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Backup decryption failed")
            raise HTTPException(status_code=422, detail="Decryption failed")

        db_url = os.environ.get("DATABASE_URL", "")
        try:
            parsed = urllib.parse.urlparse(db_url)
        except Exception:
            logger.exception("Invalid DATABASE_URL")
            raise HTTPException(status_code=500, detail="Invalid DATABASE_URL")

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

    # After psql restore, obtain a fresh session for audit logging.
    # The restore may have dropped/recreated tables, making the original
    # session's connection state unreliable.
    from database import get_session as get_fresh_session
    from database import set_rls_context

    fresh_db = get_fresh_session()
    try:
        set_rls_context(fresh_db, current_user["user_id"])
        log_system_audit(
            db=fresh_db,
            user_id=current_user["user_id"],
            action_type="BACKUP_RESTORED",
            table_affected="wims",
            record_id=None,
            request=request,
            new_values={
                "filename": filename,
                "size_bytes": total_bytes,
                "sha256": sha256_digest,
            },
        )
        fresh_db.commit()
    finally:
        fresh_db.close()

    return {
        "status": "ok",
        "filename": filename,
        "restored_at": datetime.now(timezone.utc).isoformat(),
    }
