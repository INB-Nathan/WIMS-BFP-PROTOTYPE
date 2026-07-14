"""Pure integrity primitives for tamper-proof audit exports.

This module deliberately contains no FastAPI or database dependencies.  The
route/service orchestration added in the next delivery slice can reuse these
functions from both the API verifier and the offline auditor CLI.
"""

from __future__ import annotations

import base64
import binascii
import csv
import hashlib
import io
import json
import re
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from schemas.audit_export import AuditExportManifest


MAX_AUDIT_EXPORT_ROWS = 50_000
CSV_HASH_PREFIX = "sha256:"
EXPORT_ZIP_NAMES = ("export.csv", "export.pdf", "export.audit.sig")


class AuditExportTooLargeError(ValueError):
    """Raised when an export exceeds the hard row-count limit."""


class AuditExportCsvError(ValueError):
    """Raised when CSV input cannot satisfy the canonical export dialect."""


@dataclass(frozen=True)
class CsvHashChainResult:
    """Detailed result used by verifiers while retaining a boolean helper."""

    valid: bool
    rows_verified: int
    final_hash: str | None = None
    error: str | None = None


def _canonical_cell(value: Any) -> str:
    """Convert a supported database value to deterministic CSV text."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is not None and value.utcoffset() is not None:
            value = value.astimezone(timezone.utc)
            return value.isoformat().replace("+00:00", "Z")
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, bytes):
        return f"base64:{base64.b64encode(value).decode('ascii')}"
    return str(value)


def _csv_line(values: Sequence[Any]) -> bytes:
    """Serialize one CSV record with the export dialect and a final LF."""
    stream = io.StringIO(newline="")
    writer = csv.writer(
        stream,
        delimiter=",",
        quotechar='"',
        quoting=csv.QUOTE_MINIMAL,
        lineterminator="\n",
    )
    writer.writerow([_canonical_cell(value) for value in values])
    return stream.getvalue().encode("utf-8")


def _row_values(row: Mapping[str, Any] | Sequence[Any], columns: Sequence[str]) -> list[Any]:
    if isinstance(row, Mapping):
        return [row.get(column) for column in columns]
    values = list(row)
    if len(values) != len(columns):
        raise AuditExportCsvError(
            f"row has {len(values)} values but the export declares {len(columns)} columns"
        )
    return values


def _prefixed_hash(hex_digest: str) -> str:
    return f"{CSV_HASH_PREFIX}{hex_digest}"


class CanonicalCsvWriter:
    """Write a deterministic, hash-chained CSV export."""

    def __init__(
        self,
        columns: Sequence[str],
        *,
        max_rows: int = MAX_AUDIT_EXPORT_ROWS,
    ) -> None:
        normalized_columns = [str(column) for column in columns]
        if not normalized_columns or any(not column for column in normalized_columns):
            raise AuditExportCsvError("export columns must be a non-empty list of names")
        if len(set(normalized_columns)) != len(normalized_columns):
            raise AuditExportCsvError("export columns must be unique")
        if max_rows < 0:
            raise ValueError("max_rows must be non-negative")
        self.columns = tuple(normalized_columns)
        self.max_rows = max_rows

    def write(
        self,
        rows: Iterable[Mapping[str, Any] | Sequence[Any]],
    ) -> tuple[bytes, str, int]:
        """Return ``(csv_bytes, final_chain_hash, row_count)``."""
        header_data = _csv_line(self.columns)
        previous_hash = hashlib.sha256(header_data).digest()
        output = io.BytesIO()
        output.write(b"row_hash,")
        output.write(header_data)

        row_count = 0
        for row in rows:
            if row_count >= self.max_rows:
                raise AuditExportTooLargeError(
                    f"audit export exceeds the maximum of {self.max_rows} rows"
                )
            row_data = _csv_line(_row_values(row, self.columns))
            row_hash = hashlib.sha256(previous_hash.hex().encode("ascii") + row_data).digest()
            output.write(row_hash.hex().encode("ascii"))
            output.write(b",")
            output.write(row_data)
            previous_hash = row_hash
            row_count += 1

        final_hash = _prefixed_hash(hashlib.sha256(previous_hash.hex().encode("ascii")).hexdigest())
        return output.getvalue(), final_hash, row_count


def compute_csv_hash(csv_bytes: bytes) -> str:
    """Return the SHA-256 digest of complete canonical CSV bytes."""
    return _prefixed_hash(hashlib.sha256(csv_bytes).hexdigest())


def _sorted_json_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _sorted_json_value(value[key]) for key in sorted(value, key=str)}
    if isinstance(value, list):
        return [_sorted_json_value(item) for item in value]
    return value


def canonical_filter_bytes(filters: Mapping[str, Any]) -> bytes:
    """Serialize filter identity deterministically for the manifest hash."""
    return json.dumps(
        _sorted_json_value(filters), ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")


def compute_filter_hash(filters: Mapping[str, Any]) -> str:
    return _prefixed_hash(hashlib.sha256(canonical_filter_bytes(filters)).hexdigest())


def _manifest_dict(manifest: AuditExportManifest | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(manifest, AuditExportManifest):
        data = manifest.model_dump(mode="json")
    else:
        data = dict(manifest)
    ordered: dict[str, Any] = {}
    for field in (
        "version",
        "export_uuid",
        "exported_at",
        "exported_by",
        "export_scope",
        "filters",
        "filter_hash",
        "row_count",
        "csv_hash",
        "csv_chain_final_hash",
        "csv_dialect",
        "pdf_hash",
        "signing_key",
        "signature",
    ):
        if field in data:
            ordered[field] = data[field]
    exported_at = ordered.get("exported_at")
    if isinstance(exported_at, str) and exported_at.endswith("+00:00"):
        ordered["exported_at"] = exported_at[:-6] + "Z"
    ordered["filters"] = _sorted_json_value(ordered.get("filters", {}))
    if isinstance(ordered.get("exported_by"), Mapping):
        ordered["exported_by"] = {
            key: ordered["exported_by"][key]
            for key in ("user_id", "username", "role")
            if key in ordered["exported_by"]
        }
    if isinstance(ordered.get("csv_dialect"), Mapping):
        ordered["csv_dialect"] = {
            key: ordered["csv_dialect"][key]
            for key in ("delimiter", "quoting", "encoding", "newline", "columns")
            if key in ordered["csv_dialect"]
        }
    if isinstance(ordered.get("signing_key"), Mapping):
        ordered["signing_key"] = {
            key: ordered["signing_key"][key]
            for key in ("provider", "key_name", "key_version", "algorithm", "key_fingerprint")
            if key in ordered["signing_key"]
        }
    return ordered


def canonical_manifest_bytes(
    manifest: AuditExportManifest | Mapping[str, Any], *, include_signature: bool = False
) -> bytes:
    """Return the fixed-order compact JSON bytes used for signing/verifying."""
    data = _manifest_dict(manifest)
    if not include_signature:
        data.pop("signature", None)
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


_TRANSIT_SIGNATURE_RE = re.compile(r"(?:vault|bao):v([1-9][0-9]*):([A-Za-z0-9+/=_-]+)")


def parse_transit_signature(signature: str) -> tuple[int, bytes]:
    """Parse a Vault/OpenBao Transit signature envelope without contacting KMS."""
    match = _TRANSIT_SIGNATURE_RE.fullmatch(signature)
    if match is None:
        raise ValueError("malformed Transit signature envelope")
    try:
        return int(match.group(1)), base64.b64decode(match.group(2), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Transit signature contains invalid base64") from exc


def public_key_fingerprint(public_key_pem: str | bytes) -> str:
    """Fingerprint an EC public key using DER SubjectPublicKeyInfo bytes."""
    key = serialization.load_pem_public_key(
        public_key_pem.encode("utf-8") if isinstance(public_key_pem, str) else public_key_pem
    )
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("audit export signer public key must be EC P-256")
    der = key.public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return _prefixed_hash(hashlib.sha256(der).hexdigest())


def verify_local_signature(
    public_key_pem: str | bytes, manifest_bytes: bytes, signature: str
) -> int:
    """Verify a Transit ECDSA-P256 signature locally and return its key version."""
    version, signature_bytes = parse_transit_signature(signature)
    key = serialization.load_pem_public_key(
        public_key_pem.encode("utf-8") if isinstance(public_key_pem, str) else public_key_pem
    )
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("audit export signer public key must be EC P-256")
    key.verify(signature_bytes, manifest_bytes, ec.ECDSA(hashes.SHA256()))
    return version


def create_export_zip(csv_bytes: bytes, pdf_bytes: bytes, manifest_bytes: bytes) -> bytes:
    """Build a deterministic ZIP containing exactly the three export files."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, payload in zip(EXPORT_ZIP_NAMES, (csv_bytes, pdf_bytes, manifest_bytes)):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, payload)
    return output.getvalue()


def _parse_csv(csv_bytes: bytes) -> tuple[list[str], list[list[str]]]:
    if not csv_bytes or not csv_bytes.endswith(b"\n"):
        raise AuditExportCsvError("CSV must be non-empty and end with an LF")
    try:
        decoded = csv_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AuditExportCsvError("CSV is not valid UTF-8") from exc

    reader = csv.reader(io.StringIO(decoded, newline=""), strict=True)
    try:
        records = list(reader)
    except csv.Error as exc:
        raise AuditExportCsvError("CSV has invalid quoting or record structure") from exc
    if not records:
        raise AuditExportCsvError("CSV has no header row")
    if not records[0] or records[0][0] != "row_hash":
        raise AuditExportCsvError("CSV must begin with a row_hash column")
    columns = records[0][1:]
    if not columns or len(set(columns)) != len(columns) or any(not column for column in columns):
        raise AuditExportCsvError("CSV header columns must be non-empty and unique")
    rows = records[1:]
    expected_width = len(columns) + 1
    if any(len(row) != expected_width for row in rows):
        raise AuditExportCsvError("CSV contains a row with the wrong number of columns")
    if any(not row[0] for row in rows):
        raise AuditExportCsvError("CSV data rows must contain row hashes")
    return columns, rows


def inspect_csv_hash_chain(
    csv_bytes: bytes,
    expected_final_hash: str,
    *,
    max_rows: int = MAX_AUDIT_EXPORT_ROWS,
    expected_columns: Sequence[str] | None = None,
) -> CsvHashChainResult:
    """Validate canonical bytes, row hashes, row count, and final chain hash."""
    try:
        columns, records = _parse_csv(csv_bytes)
        if expected_columns is not None and columns != list(expected_columns):
            raise AuditExportCsvError("CSV columns do not match the manifest dialect")
        if len(records) > max_rows:
            raise AuditExportTooLargeError(f"CSV contains more than the maximum of {max_rows} rows")

        header_data = _csv_line(columns)
        previous_hash = hashlib.sha256(header_data).digest()
        canonical_output = io.BytesIO()
        canonical_output.write(b"row_hash,")
        canonical_output.write(header_data)

        for index, record in enumerate(records, start=1):
            supplied_hash = record[0]
            if len(supplied_hash) != 64 or any(
                character not in "0123456789abcdef" for character in supplied_hash
            ):
                raise AuditExportCsvError(f"row {index} has an invalid row hash")
            row_data = _csv_line(record[1:])
            row_hash = hashlib.sha256(previous_hash.hex().encode("ascii") + row_data).digest()
            expected_row_hash = row_hash.hex()
            if supplied_hash != expected_row_hash:
                raise AuditExportCsvError(f"row {index} hash does not match canonical data")
            canonical_output.write(expected_row_hash.encode("ascii"))
            canonical_output.write(b",")
            canonical_output.write(row_data)
            previous_hash = row_hash

        final_hash = _prefixed_hash(hashlib.sha256(previous_hash.hex().encode("ascii")).hexdigest())
        if final_hash != expected_final_hash:
            raise AuditExportCsvError("CSV final chain hash does not match the manifest")
        if canonical_output.getvalue() != csv_bytes:
            raise AuditExportCsvError("CSV bytes are not in the canonical export dialect")
        return CsvHashChainResult(True, len(records), final_hash)
    except AuditExportTooLargeError:
        raise
    except (AuditExportCsvError, UnicodeError) as exc:
        return CsvHashChainResult(False, 0, error=str(exc))


def verify_csv_hash_chain(
    csv_bytes: bytes,
    expected_final_hash: str,
    *,
    max_rows: int = MAX_AUDIT_EXPORT_ROWS,
    expected_columns: Sequence[str] | None = None,
) -> bool:
    """Return whether a CSV satisfies the canonical hash-chain contract.

    Oversized input is treated as invalid here; callers that need to distinguish
    a policy-limit violation can use :func:`inspect_csv_hash_chain` directly.
    """
    try:
        return inspect_csv_hash_chain(
            csv_bytes,
            expected_final_hash,
            max_rows=max_rows,
            expected_columns=expected_columns,
        ).valid
    except AuditExportTooLargeError:
        return False
