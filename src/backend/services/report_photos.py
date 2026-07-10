"""Civilian Contributor — photo upload pipeline service.

Post-submit upload-and-attach: validates, extracts EXIF, encrypts three
independent artifacts (original, sanitized, metadata), writes to same-
filesystem temp files with atomic renames, and commits DB row + audit
in a single transaction with compensation on failure.

Ownership:
  - Anonymous: verified via report.device_id using the device_id from the
    request body. uploader_user_id remains NULL.
  - Registered (CIVILIAN_REPORTER): verified via report.contributor_user_id
    matching the authenticated user's UUID. uploader_user_id is set.

All encryption uses ``get_crypto_provider().encrypt_bytes`` for raw bytes
and the service-level ``encrypt_metadata_json`` wrapper for the sensitive
metadata blob (EXIF allowlist + browser GPS + original filename).

AAD strings (UTF-8, exact):
  - civilian-photo:{photo_id}:original:v1
  - civilian-photo:{photo_id}:sanitized:v1
  - civilian-photo:{photo_id}:metadata:v1

EXIF extraction happens BEFORE sanitization. Original filename, EXIF
allowlist, and browser GPS are encrypted — never stored as plaintext.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import secrets
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from schemas.civilian import BrowserGPSFields, PhotoUploadResponse
from services.kms import get_crypto_provider
from utils.audit import log_system_audit
from utils.crypto import SecurityProviderError
from utils.exif import extract_exif, sanitize_image, compute_gps_consensus
from utils.upload_validation import (
    sanitize_filename,
    validate_extension,
    check_magic_bytes,
)

logger = logging.getLogger("wims.report_photos")

# ── Constants ─────────────────────────────────────────────────────────────────

# Approved photo extensions
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}

# Approved MIME types
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}

# Byte caps
ANONYMOUS_MAX_BYTES = 5 * 1024 * 1024  # 5 MiB
REGISTERED_MAX_BYTES = 10 * 1024 * 1024  # 10 MiB

# Photo caps per report
ANONYMOUS_PHOTO_CAP = 1
REGISTERED_PHOTO_CAP = 5

# Storage directory
DEFAULT_STORAGE_DIR = "/app/storage/civilian-photos"

# Exact AAD templates
AAD_ORIGINAL = "civilian-photo:{photo_id}:original:v1"
AAD_SANITIZED = "civilian-photo:{photo_id}:sanitized:v1"
AAD_METADATA = "civilian-photo:{photo_id}:metadata:v1"

# GPS consensus threshold base
GPS_CONSENSUS_BASE_METERS = 100.0
_FINAL_ARTIFACT_RE = re.compile(r"^[0-9a-f]{32}_(?:original|sanitized)\.bin$")


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════


def _get_storage_dir() -> Path:
    """Resolve the civilian photo storage directory.

    Uses CIVILIAN_PHOTO_STORAGE_DIR env var, falling back to DEFAULT_STORAGE_DIR.
    Creates the directory if it does not exist.
    """
    path_str = os.environ.get("CIVILIAN_PHOTO_STORAGE_DIR", DEFAULT_STORAGE_DIR)
    path = Path(path_str).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _read_upload(file: UploadFile, max_bytes: int) -> bytes:
    """Read upload file, enforcing byte cap.

    Raises HTTPException(413) if content exceeds max_bytes.
    """
    content = file.file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Photo exceeds maximum size of {max_bytes // (1024 * 1024)} MB",
        )
    return content


def is_terminal_status(status: str) -> bool:
    """Check if a report status is terminal (cannot be modified).

    Canonical predicate shared with append and follow-up routes:
    ``status == "ACTIONED" or status.startswith("REJECTED_")``
    """
    return status == "ACTIONED" or status.startswith("REJECTED_")


def _ensure_device_id_present(device_id: str | None) -> None:
    """Anonymous routes require a device_id."""
    if device_id is None or device_id.strip() == "":
        raise HTTPException(status_code=404, detail="Report not found")


def _encrypt_and_write(
    photo_id: str,
    plaintext: bytes,
    aad_template: str,
    storage_dir: Path,
    suffix: str,
) -> tuple[str, str, dict[str, Any]]:
    """Encrypt plaintext, write to same-filesystem temp file, return metadata.

    Returns:
        (final_path_str, ciphertext_or_nonce_data, encryption_metadata)
        Where encryption_metadata is a dict with keys:
          encryption_iv, key_version, crypto_provider, kms_key_name
    """
    aad = aad_template.format(photo_id=photo_id).encode("utf-8")
    try:
        provider = get_crypto_provider()
        nonce_b64, ciphertext = provider.encrypt_bytes(plaintext, aad)
        # For env_aesgcm: ct is bytes. For openbao: ct is bytes (UTF-8 encoded string).
        ct_bytes = ciphertext if isinstance(ciphertext, bytes) else ciphertext.encode("utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to encrypt photo artifact") from exc

    # Generate UUID-based filename
    file_uuid = secrets.token_hex(16)
    final_name = f"{file_uuid}_{suffix}"
    final_path = storage_dir / final_name
    if final_path.is_symlink() or final_path.exists():
        raise HTTPException(status_code=500, detail="Failed to allocate photo artifact path")

    # Write via same-filesystem exclusive temp + atomic rename. The temp
    # file is 0600, created exclusively, and written with a complete loop.
    fd = None
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(dir=str(storage_dir), suffix=".tmp")
        os.fchmod(fd, 0o600)
        view = memoryview(ct_bytes)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("short encrypted artifact write")
            view = view[written:]
        os.fsync(fd)
        os.close(fd)
        fd = None
        os.rename(tmp_path, str(final_path))
        tmp_path = None
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail="Failed to write encrypted photo artifact"
        ) from exc
    finally:
        if fd is not None:
            os.close(fd)
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    metadata = {
        "encryption_iv": nonce_b64,
        "key_version": provider.current_version,
        "crypto_provider": provider.crypto_provider,
        "kms_key_name": provider.kms_key_name,
    }

    return str(final_path), nonce_b64, metadata


def _encrypt_metadata_json(
    metadata_dict: dict[str, Any],
    aad_template: str,
    photo_id: str,
) -> tuple[str, dict[str, Any]]:
    """Encrypt metadata dict as JSON blob.

    Provider construction failure is raised as HTTPException(500) so the
    caller's existing cleanup path removes any already-renamed artifacts.

    Returns:
        (ct_b64, encryption_metadata)
    """
    aad = aad_template.format(photo_id=photo_id).encode("utf-8")

    try:
        provider = get_crypto_provider()
        nonce_b64, ct_b64 = provider.encrypt_json(metadata_dict, aad)
    except (SecurityProviderError, Exception) as exc:
        raise HTTPException(status_code=500, detail="Failed to encrypt photo metadata") from exc

    metadata = {
        "encryption_iv": nonce_b64,
        "key_version": provider.current_version,
        "crypto_provider": provider.crypto_provider,
        "kms_key_name": provider.kms_key_name,
    }

    return ct_b64, metadata


def _cleanup_files(paths: list[str], storage_dir: Path | None = None) -> None:
    """Best-effort cleanup, refusing symlinks and paths outside the root."""
    root = storage_dir.resolve() if storage_dir is not None else _get_storage_dir().resolve()
    for p in paths:
        if not p:
            continue
        candidate = Path(p)
        try:
            if candidate.is_symlink():
                continue
            resolved = candidate.resolve(strict=False)
            if root not in resolved.parents:
                continue
            candidate.unlink(missing_ok=True)
        except OSError:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# Main upload-and-attach operation
# ═══════════════════════════════════════════════════════════════════════════════


def upload_and_attach_photo(
    db: Session,
    report_id: int,
    file: UploadFile,
    device_id: str | None,
    browser_gps_lat: float | None,
    browser_gps_lon: float | None,
    browser_gps_accuracy: float | None,
    browser_gps_captured_at: datetime | None,
    registered_user: dict | None,
    exif_gps_lat: float | None = None,
    exif_gps_lon: float | None = None,
    exif_gps_altitude: float | None = None,
    exif_datetime_original: datetime | None = None,
    client_photo_id: uuid.UUID | None = None,
) -> PhotoUploadResponse:
    """Upload, validate, encrypt, and attach a photo to a civilian report.

    This is the main service entry point called by the thin route handler.
    It owns all business logic: validation, EXIF, crypto, filesystem, DB,
    audit, and compensation.

    Args:
        db: SQLAlchemy session (non-superuser wims_app_user with RLS
            context set via ``get_photo_db``). FORCE ROW LEVEL SECURITY
            on ``wims.report_photos`` is the final authorization boundary.
        report_id: Target report ID.
        file: Uploaded file (multipart).
        device_id: Device ID for anonymous ownership (required for anonymous).
        browser_gps_*: Optional browser GPS fields (all-or-none).
        registered_user: Authenticated user dict or None for anonymous.
        client_photo_id: Client-generated UUID for idempotent retry.
            When provided, uses INSERT ... ON CONFLICT DO NOTHING RETURNING
            so the caller can detect duplicate uploads without a follow-up
            SELECT (which would fail under ANONYMOUS RLS on report_photos).

    Returns:
        PhotoUploadResponse on success (duplicate=True if client_photo_id
        matched an existing row).

    Raises:
        HTTPException on validation failure, ownership mismatch, terminal
        report, cap exceeded, RLS denial, or internal error.
    """
    # ── 1. Identity and ownership validation ───────────────────────────────
    is_registered = registered_user is not None
    uploaded_paths: list[str] = []
    photo_id: str | None = None
    anonymous_device_uuid: uuid.UUID | None = None

    if is_registered:
        if registered_user.get("role") != "CIVILIAN_REPORTER":
            raise HTTPException(status_code=404, detail="Report not found")
    else:
        _ensure_device_id_present(device_id)
        try:
            anonymous_device_uuid = uuid.UUID(str(device_id))
        except (ValueError, TypeError, AttributeError) as exc:
            raise HTTPException(status_code=404, detail="Report not found") from exc

    # ── 2. Validate filename, extension, MIME, magic bytes ─────────────────
    # Sanitize and validate before reading content (early exit for bad names)
    safe_name = sanitize_filename(file.filename)
    ext = validate_extension(safe_name, ALLOWED_EXTENSIONS)

    # Map extension to expected MIME
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}
    expected_mime = mime_map[ext]

    # Read content with cap
    max_bytes = REGISTERED_MAX_BYTES if is_registered else ANONYMOUS_MAX_BYTES
    content = _read_upload(file, max_bytes)

    # Verify claimed MIME type and content magic agree.
    if file.content_type not in ALLOWED_MIME_TYPES or file.content_type != expected_mime:
        raise HTTPException(status_code=400, detail="File MIME type is not allowed")
    check_magic_bytes(content, ext)
    if expected_mime == "image/jpeg" and not content.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=400, detail="File content does not match MIME type")
    if expected_mime == "image/png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail="File content does not match MIME type")

    # ── 3. Browser GPS all-or-none/range validation ────────────────────────
    try:
        browser_gps = BrowserGPSFields(
            browser_gps_lat=browser_gps_lat,
            browser_gps_lon=browser_gps_lon,
            browser_gps_accuracy=browser_gps_accuracy,
            browser_gps_captured_at=browser_gps_captured_at,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail="Invalid browser GPS fields") from exc

    browser_gps_present = browser_gps.browser_gps_captured_at is not None
    if browser_gps_present:
        accuracy = browser_gps.browser_gps_accuracy
        if accuracy is None or not math.isfinite(accuracy) or accuracy > 10_000:
            raise HTTPException(status_code=400, detail="browser_gps_accuracy invalid")
        captured = browser_gps.browser_gps_captured_at
        if abs(datetime.now(timezone.utc) - captured.astimezone(timezone.utc)) > timedelta(days=1):
            raise HTTPException(
                status_code=400, detail="browser_gps_captured_at is outside the allowed time window"
            )

    # ── 4. Extract EXIF before sanitization ────────────────────────────────
    try:
        extracted = extract_exif(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unsafe image metadata") from exc

    # ── 4a. Determine EXIF data source provenance ──────────────────────────
    # The client may submit EXIF data that was extracted before compression.
    # The server also independently extracts EXIF from the binary. When both
    # are available, server extraction is authoritative and overwrites client
    # values. The exif_data_source column tracks the provenance.
    #
    # We determine the "photo GPS" (gps from the image, used for distance
    # computation and consensus) here — before the PostGIS distances — so
    # the correct coordinates are used throughout.
    server_exif_available = extracted.gps_present or extracted.datetime_original is not None
    client_exif_available = exif_gps_lat is not None and exif_gps_lon is not None

    if server_exif_available:
        exif_data_source = "server_extracted"
        final_exif_lat = extracted.gps.latitude if extracted.gps else exif_gps_lat
        final_exif_lon = extracted.gps.longitude if extracted.gps else exif_gps_lon
        final_exif_altitude = (
            extracted.gps.altitude
            if (extracted.gps and extracted.gps.altitude is not None)
            else exif_gps_altitude
        )
        final_exif_dt = (
            extracted.datetime_original if extracted.datetime_original else exif_datetime_original
        )
        # Use server-extracted GPS as the photo GPS for distance/consensus
        photo_gps = extracted.gps
    elif client_exif_available:
        exif_data_source = "client_extracted"
        final_exif_lat = exif_gps_lat
        final_exif_lon = exif_gps_lon
        final_exif_altitude = exif_gps_altitude
        final_exif_dt = exif_datetime_original
        # Build a minimal GPS-like object for PostGIS distance + consensus
        from types import SimpleNamespace as _SimpleNS

        photo_gps = _SimpleNS(
            latitude=exif_gps_lat,
            longitude=exif_gps_lon,
            altitude=exif_gps_altitude,
        )
    else:
        exif_data_source = None
        final_exif_lat = None
        final_exif_lon = None
        final_exif_altitude = None
        final_exif_dt = None
        photo_gps = extracted.gps  # may be None

    # ── 5. Sanitize (deterministic re-encode, fail-closed) ─────────────────
    try:
        sanitized = sanitize_image(content, expected_mime)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # ── 6. Generate photo_id and resolve storage dir ───────────────────────
    photo_id = str(uuid.uuid4())
    storage_dir = _get_storage_dir()

    # ── 7. Encrypt three artifacts independently ───────────────────────────
    try:
        orig_path, orig_nonce, orig_enc_meta = _encrypt_and_write(
            photo_id, content, AAD_ORIGINAL, storage_dir, "original.bin"
        )
        uploaded_paths.append(orig_path)

        sanitized_path, sanitized_nonce, sanitized_enc_meta = _encrypt_and_write(
            photo_id, sanitized.data, AAD_SANITIZED, storage_dir, "sanitized.bin"
        )
        uploaded_paths.append(sanitized_path)
    except HTTPException:
        _cleanup_files(uploaded_paths, storage_dir)
        raise

    # Build sensitive metadata blob
    metadata_dict: dict[str, Any] = {
        "original_filename": safe_name,
        "exif_gps_lat": extracted.gps.latitude if extracted.gps else None,
        "exif_gps_lon": extracted.gps.longitude if extracted.gps else None,
        "exif_datetime_original": extracted.datetime_original,
        "exif_offset_time": extracted.offset_time,
        "exif_make": extracted.make,
        "exif_model": extracted.model,
        "exif_orientation": extracted.orientation,
    }
    if browser_gps_present:
        metadata_dict["browser_gps_lat"] = browser_gps_lat
        metadata_dict["browser_gps_lon"] = browser_gps_lon
        metadata_dict["browser_gps_accuracy"] = browser_gps_accuracy
        metadata_dict["browser_gps_captured_at"] = (
            browser_gps_captured_at.isoformat() if browser_gps_captured_at else None
        )

    try:
        ct_b64, metadata_enc_meta = _encrypt_metadata_json(metadata_dict, AAD_METADATA, photo_id)
    except HTTPException:
        _cleanup_files(uploaded_paths, storage_dir)
        raise

    # ── 8. Compute hashes ─────────────────────────────────────────────────
    original_sha256 = hashlib.sha256(content).hexdigest()
    sanitized_sha256 = hashlib.sha256(sanitized.data).hexdigest()

    # ── 9. PostGIS distances (will compute after DB lock) ──────────────────
    # We'll compute these within the locked transaction using PostGIS.

    # ── 10. Acquire report-scoped lock, re-read, enforce caps/status ──────
    try:
        # Advisory lock keyed on report_id
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('rl:civilian-photo:' || :rid))"),
            {"rid": report_id},
        ).scalar()

        # Re-read report under lock
        report_row = db.execute(
            text("""
                SELECT status, device_id, contributor_user_id,
                       ST_Y(location::geometry) AS lat,
                       ST_X(location::geometry) AS lon
                FROM wims.citizen_reports
                WHERE report_id = :rid
            """),
            {"rid": report_id},
        ).fetchone()

        if not report_row:
            _cleanup_files(uploaded_paths, storage_dir)
            raise HTTPException(status_code=404, detail="Report not found")
        if (
            not all(math.isfinite(float(v)) for v in (report_row.lat, report_row.lon))
            or not -90 <= float(report_row.lat) <= 90
            or not -180 <= float(report_row.lon) <= 180
        ):
            _cleanup_files(uploaded_paths, storage_dir)
            raise HTTPException(status_code=500, detail="Report location is invalid")

        # Verify ownership
        if is_registered:
            owner_match = report_row.contributor_user_id is not None and str(
                report_row.contributor_user_id
            ) == registered_user.get("user_id")
        else:
            owner_match = str(report_row.device_id) == str(device_id)

        if not owner_match:
            _cleanup_files(uploaded_paths, storage_dir)
            raise HTTPException(status_code=404, detail="Report not found")

        # Check terminal status
        if is_terminal_status(report_row.status):
            _cleanup_files(uploaded_paths, storage_dir)
            raise HTTPException(
                status_code=409,
                detail="Cannot attach photos to a closed report. Submit a new report or call 911.",
            )

        # ── 11. Compute PostGIS distances ──────────────────────────────────
        report_wkt = f"SRID=4326;POINT({report_row.lon} {report_row.lat})"

        exif_to_report_m = None
        browser_to_report_m = None
        source_distance_m = None
        photo_reported_m = None

        if photo_gps:
            exif_wkt = f"SRID=4326;POINT({photo_gps.longitude} {photo_gps.latitude})"
            exif_to_report_m = db.execute(
                text(
                    "SELECT ST_Distance(ST_GeogFromText(:p1)::geography, ST_GeogFromText(:p2)::geography)"
                ),
                {"p1": exif_wkt, "p2": report_wkt},
            ).scalar()
            photo_reported_m = exif_to_report_m

        if browser_gps_present:
            browser_wkt = f"SRID=4326;POINT({browser_gps_lon} {browser_gps_lat})"
            browser_to_report_m = db.execute(
                text(
                    "SELECT ST_Distance(ST_GeogFromText(:p1)::geography, ST_GeogFromText(:p2)::geography)"
                ),
                {"p1": browser_wkt, "p2": report_wkt},
            ).scalar()
            if photo_reported_m is None:
                photo_reported_m = browser_to_report_m
            if photo_gps:
                source_distance_m = db.execute(
                    text(
                        "SELECT ST_Distance(ST_GeogFromText(:p1)::geography, ST_GeogFromText(:p2)::geography)"
                    ),
                    {"p1": exif_wkt, "p2": browser_wkt},
                ).scalar()

        # Consensus classification — uses photo_gps (server-extracted or
        # client-supplied) as primary, falls back to extracted.gps.
        consensus = compute_gps_consensus(
            photo_gps if (server_exif_available or client_exif_available) else extracted.gps,
            browser_gps_lat if browser_gps_present else None,
            browser_gps_lon if browser_gps_present else None,
            browser_gps_accuracy if browser_gps_present else None,
            float(source_distance_m) if source_distance_m is not None else None,
        )

        # Ensure distances are float for DB
        exif_dist_float = float(exif_to_report_m) if exif_to_report_m is not None else None
        browser_dist_float = float(browser_to_report_m) if browser_to_report_m is not None else None
        photo_dist_float = float(photo_reported_m) if photo_reported_m is not None else None

        # ── 12. Insert DB row + audit in one transaction ──────────────────
        uploader_id = None
        if is_registered:
            try:
                uploader_id = str(uuid.UUID(str(registered_user.get("user_id"))))
            except (ValueError, TypeError, AttributeError):
                _cleanup_files(uploaded_paths, storage_dir)
                db.rollback()
                raise HTTPException(status_code=404, detail="Report not found")

        exif_gps_status = "present" if extracted.gps_present else "unavailable"
        browser_gps_status = "present" if browser_gps_present else "unavailable"

        # ── 12a. INSERT with RLS denial neutralisation ────────────────────
        # SQLSTATE 42501 (insufficient_privilege) is raised by PostgreSQL
        # FORCE ROW LEVEL SECURITY when the caller does not satisfy the
        # report_photos_insert WITH CHECK policy.  Catch this and convert
        # to a neutral 404 (same as owner mismatch). Other DB failures
        # remain 500.
        # ── 12a. Atomic INSERT with optional idempotency ─────────────────
        # When client_photo_id is provided, use ON CONFLICT DO NOTHING RETURNING
        # so the caller can detect duplicates without a follow-up SELECT
        # (which would fail under ANONYMOUS RLS on report_photos).
        # The partial unique index only fires when client_photo_id IS NOT NULL,
        # so legacy uploads without one are unaffected.
        try:
            base_cols = (
                "photo_id, report_id, uploader_user_id, uploader_device_id,"
                " media_type, file_extension, image_width, image_height, file_size_bytes,"
                " original_storage_path, original_file_size_bytes, original_sha256,"
                " orig_encryption_iv, orig_key_version, orig_crypto_provider, orig_kms_key_name,"
                " sanitized_storage_path, sanitized_file_size_bytes, sanitized_sha256,"
                " sanitized_encryption_iv, sanitized_key_version, sanitized_crypto_provider, sanitized_kms_key_name,"
                " sensitive_metadata_blob_enc,"
                " metadata_encryption_iv, metadata_key_version, metadata_crypto_provider, metadata_kms_key_name,"
                " exif_gps_status, browser_gps_status, gps_consensus,"
                " exif_to_report_distance_m, browser_to_report_distance_m,"
                " photo_reported_distance_m,"
                " exif_gps_lat, exif_gps_lon, exif_gps_altitude, exif_datetime_original, exif_data_source"
            )
            base_vals = (
                ":photo_id, :report_id, :uploader_user_id, :uploader_device_id,"
                " :media_type, :file_extension, :image_width, :image_height, :file_size_bytes,"
                " :original_storage_path, :original_file_size_bytes, :original_sha256,"
                " :orig_encryption_iv, :orig_key_version, :orig_crypto_provider, :orig_kms_key_name,"
                " :sanitized_storage_path, :sanitized_file_size_bytes, :sanitized_sha256,"
                " :sanitized_encryption_iv, :sanitized_key_version, :sanitized_crypto_provider, :sanitized_kms_key_name,"
                " :sensitive_metadata_blob_enc,"
                " :metadata_encryption_iv, :metadata_key_version, :metadata_crypto_provider, :metadata_kms_key_name,"
                " :exif_gps_status, :browser_gps_status, :gps_consensus,"
                " :exif_to_report_distance_m, :browser_to_report_distance_m,"
                " :photo_reported_distance_m,"
                " :exif_gps_lat_val, :exif_gps_lon_val, :exif_gps_altitude_val, :exif_dt_val, :exif_data_source"
            )
            if client_photo_id:
                cols = base_cols + ", client_photo_id"
                vals = base_vals + ", :client_photo_id"
                conflict = " ON CONFLICT (client_photo_id) WHERE client_photo_id IS NOT NULL DO NOTHING RETURNING photo_id"
            else:
                cols = base_cols
                vals = base_vals
                conflict = ""

            insert_sql = text(f"INSERT INTO wims.report_photos ({cols}) VALUES ({vals}){conflict}")

            insert_params = {
                "photo_id": photo_id,
                "report_id": report_id,
                "uploader_user_id": uploader_id,
                "uploader_device_id": None if is_registered else anonymous_device_uuid,
                "media_type": expected_mime,
                "file_extension": ext,
                "image_width": sanitized.width,
                "image_height": sanitized.height,
                "file_size_bytes": len(content),
                "original_storage_path": orig_path,
                "original_file_size_bytes": len(content),
                "original_sha256": original_sha256,
                "orig_encryption_iv": orig_enc_meta["encryption_iv"],
                "orig_key_version": orig_enc_meta["key_version"],
                "orig_crypto_provider": orig_enc_meta["crypto_provider"],
                "orig_kms_key_name": orig_enc_meta["kms_key_name"],
                "sanitized_storage_path": sanitized_path,
                "sanitized_file_size_bytes": len(sanitized.data),
                "sanitized_sha256": sanitized_sha256,
                "sanitized_encryption_iv": sanitized_enc_meta["encryption_iv"],
                "sanitized_key_version": sanitized_enc_meta["key_version"],
                "sanitized_crypto_provider": sanitized_enc_meta["crypto_provider"],
                "sanitized_kms_key_name": sanitized_enc_meta["kms_key_name"],
                "sensitive_metadata_blob_enc": ct_b64,
                "metadata_encryption_iv": metadata_enc_meta["encryption_iv"],
                "metadata_key_version": metadata_enc_meta["key_version"],
                "metadata_crypto_provider": metadata_enc_meta["crypto_provider"],
                "metadata_kms_key_name": metadata_enc_meta["kms_key_name"],
                "exif_gps_status": exif_gps_status,
                "browser_gps_status": browser_gps_status,
                "gps_consensus": consensus,
                "exif_to_report_distance_m": exif_dist_float,
                "browser_to_report_distance_m": browser_dist_float,
                "photo_reported_distance_m": photo_dist_float,
                "exif_gps_lat_val": final_exif_lat,
                "exif_gps_lon_val": final_exif_lon,
                "exif_gps_altitude_val": final_exif_altitude,
                "exif_dt_val": final_exif_dt,
                "exif_data_source": exif_data_source,
            }
            if client_photo_id:
                insert_params["client_photo_id"] = client_photo_id

            if client_photo_id:
                photo_id_val = db.execute(insert_sql, insert_params).scalar()
                if photo_id_val is None:
                    # Duplicate — INSERT did nothing, RETURNING returned NULL.
                    # Skip commit/audit/cleanup and return early.
                    # The caller trusts the UUID entropy (122 bits).
                    # Delete the temp file artifacts since they were not persisted.
                    _cleanup_files(uploaded_paths, storage_dir)
                    return PhotoUploadResponse(
                        photo_id=None,
                        report_id=report_id,
                        file_size_bytes=0,
                        mime_type=expected_mime,
                        image_width=0,
                        image_height=0,
                        exif_gps_status="unavailable",
                        browser_gps_status="unavailable",
                        gps_consensus=None,
                        photo_reported_distance_m=None,
                        duplicate=True,
                    )
                # photo_id_val is the same as our generated photo_id
            else:
                # Non-idempotent path — check cap before INSERT
                cap = REGISTERED_PHOTO_CAP if is_registered else ANONYMOUS_PHOTO_CAP
                photo_count = (
                    db.execute(
                        text("SELECT COUNT(*) FROM wims.report_photos WHERE report_id = :rid"),
                        {"rid": report_id},
                    ).scalar()
                    or 0
                )
                if photo_count >= cap:
                    _cleanup_files(uploaded_paths, storage_dir)
                    raise HTTPException(
                        status_code=409,
                        detail=f"Photo cap reached for this report (max {cap})",
                    )
                db.execute(insert_sql, insert_params)
        except DBAPIError as db_exc:
            # SQLSTATE 42501 = insufficient_privilege (RLS policy violation).
            # psycopg2 exposes pgcode; psycopg3 exposes sqlstate.
            original = getattr(db_exc, "orig", None)
            sqlstate = getattr(original, "pgcode", None) or getattr(original, "sqlstate", None)
            if sqlstate == "42501":
                _cleanup_files(uploaded_paths, storage_dir)
                db.rollback()
                raise HTTPException(status_code=404, detail="Report not found") from db_exc
            _cleanup_files(uploaded_paths, storage_dir)
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to insert photo record") from db_exc

        # ── 12b. Photo cap check (after INSERT, for idempotent path only) ──
        # For client_photo_id retries, the duplicate early-return above handles
        # the case. For fresh non-idempotent inserts, the cap was checked before
        # the INSERT. For fresh idempotent inserts that weren't duplicates, check
        # the cap here — rollback and cleanup if exceeded.
        if client_photo_id:
            cap = REGISTERED_PHOTO_CAP if is_registered else ANONYMOUS_PHOTO_CAP
            photo_count = (
                db.execute(
                    text("SELECT COUNT(*) FROM wims.report_photos WHERE report_id = :rid"),
                    {"rid": report_id},
                ).scalar()
                or 0
            )
            if photo_count > cap:
                _cleanup_files(uploaded_paths, storage_dir)
                db.rollback()
                raise HTTPException(
                    status_code=409,
                    detail=f"Photo cap reached for this report (max {cap})",
                )

        # Audit: PHOTO_UPLOAD_ATTACH (record_id=report_id, photo_id in new_values)
        try:
            log_system_audit(
                db=db,
                user_id=uploader_id,
                action_type="PHOTO_UPLOAD_ATTACH",
                table_affected="wims.report_photos",
                record_id=report_id,
                new_values={"photo_id": photo_id},
                sensitive=True,
            )
        except Exception as audit_exc:
            # Audit failure rolls back the whole transaction
            _cleanup_files(uploaded_paths, storage_dir)
            db.rollback()
            logger.error("Photo upload audit insert failed; transaction rolled back")
            raise HTTPException(
                status_code=500, detail="Failed to record photo audit"
            ) from audit_exc

        # Commit
        try:
            db.commit()
        except Exception as commit_exc:
            _cleanup_files(uploaded_paths, storage_dir)
            db.rollback()
            logger.error("Photo upload commit failed; transaction rolled back")
            raise HTTPException(
                status_code=500, detail="Failed to save photo record"
            ) from commit_exc

    except HTTPException:
        raise
    except Exception as exc:
        _cleanup_files(uploaded_paths, storage_dir)
        db.rollback()
        logger.error("Unexpected error during photo upload")
        raise HTTPException(
            status_code=500, detail="Internal server error processing photo"
        ) from exc

    # ── 13. Return success ────────────────────────────────────────────────
    return PhotoUploadResponse(
        photo_id=photo_id,
        report_id=report_id,
        file_size_bytes=len(content),
        mime_type=expected_mime,
        image_width=sanitized.width,
        image_height=sanitized.height,
        exif_gps_status=exif_gps_status,
        browser_gps_status=browser_gps_status,
        gps_consensus=consensus,
        photo_reported_distance_m=photo_dist_float,
        duplicate=False,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Orphan cleanup
# ═══════════════════════════════════════════════════════════════════════════════


def reconcile_unreferenced_photo_artifacts(
    db: Session,
    storage_dir: Path | None = None,
    grace_hours: int = 48,
    quarantine_dir_name: str = "quarantine",
) -> int:
    """Scan storage for unreferenced final photo artifacts and quarantine them.

    This is an operator-safe reconciliation: it scans only strict
    server-generated final-artifact filenames (``*_original.bin`` and
    ``*_sanitized.bin``), resolves them against DB rows, and moves
    candidates matching the age window into a ``quarantine/`` subdirectory.

    Never deletes attached rows or arbitrary files.  Symlinks, paths
    outside the storage root, and stale temp files are handled
    separately (see ``cleanup_stale_temp_files``).

    Args:
        db: SQLAlchemy session (admin session is acceptable since
            this is an operator-maintenance job).
        storage_dir: Resolved storage root. Defaults to env/dynamic
            via ``_get_storage_dir()``.
        grace_hours: Minimum age before a final artifact is eligible
            for quarantine (default 48h).
        quarantine_dir_name: Name of the quarantine subdirectory.

    Returns:
        Number of artifacts quarantined.
    """
    root = storage_dir.resolve() if storage_dir is not None else _get_storage_dir().resolve()
    if not root.is_dir():
        return 0

    # Build set of all known final artifact paths from DB.
    known_paths: set[str] = set()
    try:
        rows = db.execute(
            text(
                "SELECT original_storage_path, sanitized_storage_path "
                "FROM wims.report_photos "
                "WHERE original_storage_path IS NOT NULL "
                "   OR sanitized_storage_path IS NOT NULL"
            )
        ).fetchall()
        for row in rows:
            if row[0]:
                known_paths.add(str(row[0]))
            if row[1]:
                known_paths.add(str(row[1]))
    except Exception:
        logger.exception("Failed to query known photo artifact paths")
        return 0

    now = datetime.now(timezone.utc)
    quarantined = 0

    # Create quarantine subdirectory inside root.
    quarantine_dir = root / quarantine_dir_name
    try:
        if quarantine_dir.exists() and quarantine_dir.is_symlink():
            logger.warning("Refusing symlink quarantine directory: %s", quarantine_dir)
            return 0
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        quarantine_resolved = quarantine_dir.resolve()
        if root not in quarantine_resolved.parents:
            logger.warning(
                "Refusing quarantine directory outside storage root: %s", quarantine_resolved
            )
            return 0
    except OSError:
        logger.exception("Cannot create quarantine directory")
        return 0

    for entry in root.iterdir():
        # Only strict final-artifact patterns, and only files
        if entry.is_symlink():
            continue
        if not entry.is_file():
            continue
        name = entry.name
        if not _FINAL_ARTIFACT_RE.fullmatch(name):
            continue

        resolved = entry.resolve(strict=False)
        if root not in resolved.parents and root != resolved.parent:
            logger.warning("Skipping out-of-root artifact: %s", resolved)
            continue

        path_str = str(resolved)
        if path_str in known_paths:
            continue  # referenced by a DB row

        try:
            mtime = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue

        if (now - mtime).total_seconds() < grace_hours * 3600:
            continue  # not old enough for quarantine

        # Move to quarantine directory
        dest = quarantine_dir / name
        try:
            if dest.exists() or dest.is_symlink():
                logger.warning("Quarantine destination already exists: %s", dest)
                continue
            entry.rename(dest)
            quarantined += 1
            logger.info(
                "Quarantined unreferenced photo artifact: %s -> %s",
                path_str,
                dest,
            )
        except OSError as exc:
            logger.warning("Failed to quarantine %s: %s", path_str, exc)

    return quarantined


def cleanup_orphan_photos(_db: Session, max_age_hours: int = 24) -> int:
    """Deprecated: use ``reconcile_unreferenced_photo_artifacts``.

    This function is kept for backward compatibility.  It delegates to
    ``reconcile_unreferenced_photo_artifacts`` but does not actually
    accept a Session for artifact scanning (the argument name ``_db``
    indicates it is ignored).  Post-submit schema has no eligible
    unattached rows — ``report_id`` is NOT NULL.  Use the scheduled
    task's two-phase cleanup instead.
    """
    return 0


def cleanup_stale_temp_files(max_age_hours: int = 1) -> int:
    """Remove recognized stale temporary files from the storage directory.

    Only removes ``*.tmp`` files older than max_age_hours. Does NOT follow
    symlinks, delete files outside the storage root, or touch final artifacts.
    """
    storage_dir = _get_storage_dir()
    if not storage_dir.is_dir():
        return 0

    now = datetime.now(timezone.utc)
    cleaned = 0
    for entry in storage_dir.iterdir():
        if not entry.is_file() or entry.is_symlink():
            continue
        if entry.suffix != ".tmp":
            continue
        try:
            mtime = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)
            if (now - mtime).total_seconds() > max_age_hours * 3600:
                entry.unlink()
                cleaned += 1
        except OSError:
            pass

    return cleaned
