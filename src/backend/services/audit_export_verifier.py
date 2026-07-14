"""ZIP safety and online verification for secure audit-export packages."""

from __future__ import annotations

import io
import os
import re
import zipfile
import zlib
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from schemas.audit_export import AuditExportCheck, AuditExportManifest
from services.audit_export import (
    AuditExportTooLargeError,
    EXPORT_ZIP_NAMES,
    canonical_manifest_bytes,
    compute_csv_hash,
    compute_filter_hash,
    inspect_csv_hash_chain,
    parse_transit_signature,
    public_key_fingerprint,
    verify_local_signature,
)
from services.audit_export_pdf import compute_pdf_hash
from services.kms.openbao_client import OpenBaoClient, OpenBaoClientError


MAX_COMPRESSED_ZIP_BYTES = 100 * 1024 * 1024
# Secure exports are bounded to 50,000 rows; these limits leave generous room
# for a large PDF while preventing a single request from allocating hundreds
# of megabytes in the API process.
MAX_UNCOMPRESSED_MEMBER_BYTES = 64 * 1024 * 1024
MAX_UNCOMPRESSED_TOTAL_BYTES = 128 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100
_WINDOWS_PATH_RE = re.compile(r"^(?:[A-Za-z]:|//|\\\\)")


class ArchiveValidationError(ValueError):
    """Raised when an uploaded ZIP is malformed or unsafe."""


class ArchiveTooLargeError(ArchiveValidationError):
    """Raised when compressed or uncompressed archive limits are exceeded."""


def _validate_member_name(name: str) -> None:
    if (
        not name
        or "\x00" in name
        or "\\" in name
        or name.startswith("/")
        or _WINDOWS_PATH_RE.match(name)
    ):
        raise ArchiveValidationError("ZIP contains an unsafe member path")
    path = PurePosixPath(name)
    if any(part in ("", ".", "..") for part in path.parts) or path.as_posix() != name:
        raise ArchiveValidationError("ZIP contains a non-canonical member path")


def validate_zip_package(zip_bytes: bytes) -> dict[str, bytes]:
    """Validate ZIP structure and return the three bounded member payloads."""
    if len(zip_bytes) > MAX_COMPRESSED_ZIP_BYTES:
        raise ArchiveTooLargeError("compressed ZIP exceeds the upload limit")
    if not zip_bytes.startswith(b"PK\x03\x04"):
        raise ArchiveValidationError("uploaded file is not a ZIP archive")
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as archive:
            infos = archive.infolist()
            if len(infos) != len(EXPORT_ZIP_NAMES):
                raise ArchiveValidationError("ZIP must contain exactly three files")
            names = [info.filename for info in infos]
            if len(set(names)) != len(names) or set(names) != set(EXPORT_ZIP_NAMES):
                raise ArchiveValidationError("ZIP must contain the required unique filenames")
            total_size = 0
            for info in infos:
                _validate_member_name(info.filename)
                if info.is_dir() or info.filename.endswith("/"):
                    raise ArchiveValidationError("ZIP directories are not allowed")
                if info.flag_bits & 0x1:
                    raise ArchiveValidationError("encrypted ZIP members are not allowed")
                mode = (info.external_attr >> 16) & 0o170000
                if mode == 0o120000:
                    raise ArchiveValidationError("ZIP symlink members are not allowed")
                if info.file_size > MAX_UNCOMPRESSED_MEMBER_BYTES:
                    raise ArchiveTooLargeError("ZIP member exceeds the uncompressed size limit")
                if (
                    info.file_size
                    and info.file_size / max(info.compress_size, 1) > MAX_COMPRESSION_RATIO
                ):
                    raise ArchiveTooLargeError("ZIP compression ratio exceeds the safety limit")
                total_size += info.file_size
            if total_size > MAX_UNCOMPRESSED_TOTAL_BYTES:
                raise ArchiveTooLargeError("ZIP aggregate uncompressed size exceeds the limit")
            if archive.testzip() is not None:
                raise ArchiveValidationError("ZIP CRC validation failed")
            return {name: archive.read(name) for name in EXPORT_ZIP_NAMES}
    except (
        zipfile.BadZipFile,
        zipfile.LargeZipFile,
        EOFError,
        OSError,
        RuntimeError,
        zlib.error,
    ) as exc:
        raise ArchiveValidationError("ZIP archive could not be safely read") from exc
    except MemoryError as exc:
        raise ArchiveTooLargeError("ZIP processing exceeded available memory") from exc


def _check(status: str, detail: str | None = None, **kwargs: Any) -> AuditExportCheck:
    return AuditExportCheck(status=status, detail=detail, **kwargs)


def _inspect_chain(csv_bytes: bytes, manifest: AuditExportManifest):
    try:
        return inspect_csv_hash_chain(
            csv_bytes,
            manifest.csv_chain_final_hash,
            expected_columns=manifest.csv_dialect.columns,
        )
    except AuditExportTooLargeError as exc:
        raise ArchiveTooLargeError("CSV exceeds the verification row limit") from exc


def _freshness_check(
    db: Session, manifest: AuditExportManifest
) -> tuple[AuditExportCheck, list[str]]:
    row = db.execute(
        text(
            """
            SELECT new_values->>'export_uuid'
            FROM wims.system_audit_trails
            WHERE action_type = 'AUDIT_SECURE_EXPORT'
              AND result = 'success'
              AND timestamp > CAST(:exported_at AS timestamptz)
              AND new_values->>'export_scope' = :export_scope
              AND new_values->>'filter_hash' = :filter_hash
              AND new_values->>'export_uuid' <> :export_uuid
            ORDER BY timestamp DESC, audit_id DESC
            LIMIT 1
            """
        ),
        {
            "exported_at": manifest.exported_at.isoformat(),
            "export_scope": manifest.export_scope,
            "filter_hash": manifest.filter_hash,
            "export_uuid": str(manifest.export_uuid),
        },
    ).fetchone()
    if not row or not row[0]:
        return _check("pass", "No newer matching export found"), []
    warning = f"A newer export ({row[0]}) exists for the same scope and filters"
    return _check("warn", warning, latest_export_uuid=row[0]), [warning]


def verify_online_package(
    zip_bytes: bytes,
    *,
    client: OpenBaoClient,
    db: Session,
) -> tuple[bool, list[str], dict[str, AuditExportCheck], AuditExportManifest]:
    """Verify a package with OpenBao and perform the online freshness lookup."""
    package = validate_zip_package(zip_bytes)
    try:
        manifest = AuditExportManifest.model_validate_json(package["export.audit.sig"])
    except Exception as exc:
        raise ArchiveValidationError("manifest is invalid or unsupported") from exc

    checks: dict[str, AuditExportCheck] = {"zip_structure": _check("pass")}
    expected_key = os.environ.get("WIMS_AUDIT_EXPORT_SIGNING_KEY", "audit-export-signer")
    if (
        manifest.signing_key.provider != "openbao_transit"
        or manifest.signing_key.key_name != expected_key
        or manifest.signing_key.algorithm != "sha2-256"
    ):
        checks["manifest"] = _check("fail", "manifest signing configuration is not accepted")
        return False, [], checks, manifest
    if compute_filter_hash(manifest.filters) != manifest.filter_hash:
        checks["manifest"] = _check("fail", "manifest filter hash does not match filters")
        return False, [], checks, manifest
    checks["manifest"] = _check("pass")

    try:
        signature_version, _ = parse_transit_signature(manifest.signature)
        signature_valid = client.verify(
            expected_key,
            canonical_manifest_bytes(manifest),
            manifest.signature,
        )
        public_key = client.public_key(expected_key, signature_version)
        fingerprint_valid = (
            public_key_fingerprint(public_key) == manifest.signing_key.key_fingerprint
        )
    except OpenBaoClientError:
        raise
    except Exception as exc:
        checks["signature"] = _check("fail", str(exc))
        return False, [], checks, manifest
    signature_passed = (
        signature_valid
        and signature_version == manifest.signing_key.key_version
        and fingerprint_valid
    )
    checks["signature"] = _check(
        "pass" if signature_passed else "fail",
        None if signature_passed else "signature, version, or fingerprint mismatch",
        key_version=signature_version,
    )

    csv_bytes = package["export.csv"]
    csv_hash = compute_csv_hash(csv_bytes)
    checks["csv_hash"] = _check(
        "pass" if csv_hash == manifest.csv_hash else "fail",
        None if csv_hash == manifest.csv_hash else "CSV byte hash mismatch",
        hash=csv_hash,
    )
    chain = _inspect_chain(csv_bytes, manifest)
    row_count_passed = chain.valid and chain.rows_verified == manifest.row_count
    checks["csv_hash_chain"] = _check(
        "pass" if chain.valid else "fail", chain.error, rows_verified=chain.rows_verified
    )
    checks["row_count"] = _check(
        "pass" if row_count_passed else "fail",
        None if row_count_passed else "CSV row count does not match the manifest",
    )
    pdf_hash = compute_pdf_hash(package["export.pdf"])
    checks["pdf_hash"] = _check(
        "pass" if pdf_hash == manifest.pdf_hash else "fail",
        None if pdf_hash == manifest.pdf_hash else "PDF byte hash mismatch",
        hash=pdf_hash,
    )
    integrity_checks = (
        signature_passed,
        csv_hash == manifest.csv_hash,
        row_count_passed,
        pdf_hash == manifest.pdf_hash,
    )
    if all(integrity_checks):
        freshness, warnings = _freshness_check(db, manifest)
    else:
        freshness, warnings = (
            _check("unavailable", "freshness runs only after integrity checks"),
            [],
        )
    checks["freshness"] = freshness
    return all(integrity_checks), warnings, checks, manifest


def verify_local_package(
    zip_bytes: bytes, public_key_pem: str | bytes
) -> tuple[bool, list[str], dict[str, AuditExportCheck], AuditExportManifest]:
    """Verify package integrity offline with a supplied P-256 public key."""
    package = validate_zip_package(zip_bytes)
    try:
        manifest = AuditExportManifest.model_validate_json(package["export.audit.sig"])
    except Exception as exc:
        raise ArchiveValidationError("manifest is invalid or unsupported") from exc
    checks: dict[str, AuditExportCheck] = {"zip_structure": _check("pass")}
    try:
        fingerprint_passed = (
            public_key_fingerprint(public_key_pem) == manifest.signing_key.key_fingerprint
        )
        signature_version = verify_local_signature(
            public_key_pem,
            canonical_manifest_bytes(manifest),
            manifest.signature,
        )
        signature_passed = (
            fingerprint_passed and signature_version == manifest.signing_key.key_version
        )
    except Exception as exc:
        checks["signature"] = _check("fail", str(exc))
        return False, ["offline signature verification failed"], checks, manifest
    checks["manifest"] = _check("pass")
    checks["signature"] = _check(
        "pass" if signature_passed else "fail",
        None if signature_passed else "public-key fingerprint or version mismatch",
        key_version=signature_version,
    )
    csv_bytes = package["export.csv"]
    csv_hash = compute_csv_hash(csv_bytes)
    csv_hash_passed = csv_hash == manifest.csv_hash
    checks["csv_hash"] = _check(
        "pass" if csv_hash_passed else "fail",
        None if csv_hash_passed else "CSV byte hash mismatch",
        hash=csv_hash,
    )
    chain = _inspect_chain(csv_bytes, manifest)
    chain_passed = chain.valid and chain.rows_verified == manifest.row_count
    checks["csv_hash_chain"] = _check(
        "pass" if chain.valid else "fail", chain.error, rows_verified=chain.rows_verified
    )
    checks["row_count"] = _check(
        "pass" if chain_passed else "fail",
        None if chain_passed else "CSV row count does not match the manifest",
    )
    pdf_hash = compute_pdf_hash(package["export.pdf"])
    pdf_passed = pdf_hash == manifest.pdf_hash
    checks["pdf_hash"] = _check(
        "pass" if pdf_passed else "fail",
        None if pdf_passed else "PDF byte hash mismatch",
        hash=pdf_hash,
    )
    checks["freshness"] = _check("unavailable", "offline verification cannot query freshness")
    verified = signature_passed and csv_hash_passed and chain_passed and pdf_passed
    warnings = ["Freshness unavailable in offline mode"]
    return verified, warnings, checks, manifest
