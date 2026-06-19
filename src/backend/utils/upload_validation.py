"""Shared helpers for file upload deep checks (issue #391).

Used by:
  - src/backend/api/routes/incidents.py (upload_attachment)
  - src/backend/api/routes/regional/afor.py (import_afor_file)
  - src/backend/api/routes/admin/backups.py (restore_backup)

Provides:
  - sanitize_filename: strip path traversal chars, normalize name
  - validate_extension: check extension is in allowlist
  - check_magic_bytes: verify file content header matches claimed type
  - check_xlsx_decompression_bomb: reject XLSX with suspicious compression ratio
  - strip_image_exif: remove EXIF metadata from image bytes (defensive)
  - safe_read_upload: cap-aware async upload reader

All checks raise ``HTTPException`` with appropriate status codes:
  - 400 for malformed input (bad filename, bad extension, bad magic bytes)
  - 413 for oversize content
  - 422 for decompression bombs
"""

from __future__ import annotations

import io
import logging
import os
import re
import zipfile
from typing import Iterable

from fastapi import HTTPException, UploadFile

logger = logging.getLogger("wims.upload")

# ---------------------------------------------------------------------------
# Magic bytes for common file types
# ---------------------------------------------------------------------------

# XLSX and ZIP share the same magic bytes (PK\x03\x04)
_XLSX_MAGIC = b"PK\x03\x04"
# JPEG
_JPEG_MAGIC = b"\xff\xd8\xff"
# PNG
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# PDF
_PDF_MAGIC = b"%PDF-"

# Mapping from file extension to expected magic bytes
_MAGIC_BYTES: dict[str, tuple[bytes, ...]] = {
    "xlsx": (_XLSX_MAGIC,),
    "zip": (_XLSX_MAGIC,),
    "jpg": (_JPEG_MAGIC,),
    "jpeg": (_JPEG_MAGIC,),
    "png": (_PNG_MAGIC,),
    "pdf": (_PDF_MAGIC,),
}


# ---------------------------------------------------------------------------
# Decompression bomb thresholds
# ---------------------------------------------------------------------------

# Reject XLSX files that decompress to more than this many bytes
MAX_XLSX_DECOMPRESSED_BYTES = int(
    os.getenv("WIMS_MAX_XLSX_DECOMPRESSED_BYTES", str(100 * 1024 * 1024))
)

# Reject if compressed:decompressed ratio is below this (e.g. 1:100+ is suspicious)
MIN_COMPRESSION_RATIO = int(os.getenv("WIMS_MIN_COMPRESSION_RATIO", "100"))


# ---------------------------------------------------------------------------
# Filename sanitization
# ---------------------------------------------------------------------------

# Allow only safe filename chars: letters, digits, hyphen, underscore, dot, space
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._\- ]")

# Path traversal patterns to detect
_PATH_TRAVERSAL_PATTERNS = re.compile(r"(\.\.[\\/]|\\|/|^\.+$|^\s*$|\x00)")


def sanitize_filename(filename: str | None) -> str:
    """Sanitize a user-supplied filename.

    Strips path traversal characters, null bytes, and unsafe chars.
    Returns just the basename, replacing any non-safe characters with ``_``.

    Raises HTTPException(400) if the filename is empty or unfixable.
    """
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    # Strip any path components
    name = os.path.basename(filename).strip()
    if not name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if "\x00" in name:
        raise HTTPException(status_code=400, detail="Invalid filename (null byte)")
    # Replace path separators / traversal
    if "/" in name or "\\" in name:
        name = name.replace("\\", "_").replace("/", "_")
    # Replace non-safe chars
    name = _SAFE_FILENAME_RE.sub("_", name)
    if not name or name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


def validate_extension(
    filename: str,
    allowed_extensions: Iterable[str],
) -> str:
    """Validate that *filename* ends in one of the allowed extensions.

    Returns the normalized lowercased extension (without the dot).
    Raises HTTPException(400) if the extension is missing or not allowed.
    """
    ext = ""
    if "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
    allowed = {e.lower().lstrip(".") for e in allowed_extensions}
    if not ext or ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(f"File extension not allowed. Allowed: {sorted(allowed)}; got: {ext!r}"),
        )
    return ext


# ---------------------------------------------------------------------------
# Magic byte verification
# ---------------------------------------------------------------------------


def check_magic_bytes(content: bytes, expected_extension: str) -> None:
    """Verify that *content* starts with magic bytes matching *expected_extension*.

    The expected magic bytes are looked up in ``_MAGIC_BYTES`` by extension.
    Extensions not in the map are accepted (no-op) since we have no known
    magic bytes for them.

    Raises HTTPException(400) when the magic bytes don't match.
    """
    expected = _MAGIC_BYTES.get(expected_extension.lower())
    if not expected:
        # No known magic bytes for this extension; skip check.
        return
    if not content or len(content) < 4:
        raise HTTPException(
            status_code=400,
            detail="File is too small to verify content type",
        )
    header = content[:8]
    if not any(header.startswith(m) for m in expected):
        raise HTTPException(
            status_code=400,
            detail=(f"File content does not match claimed extension '.{expected_extension}'"),
        )


# ---------------------------------------------------------------------------
# Decompression bomb defense
# ---------------------------------------------------------------------------


def check_xlsx_decompression_bomb(content: bytes) -> None:
    """Reject XLSX (ZIP) files that decompress to a suspicious size.

    Opens the archive, sums the uncompressed sizes of all entries, and:
      - raises HTTPException(422) if the total exceeds ``MAX_XLSX_DECOMPRESSED_BYTES``
      - raises HTTPException(422) if compressed:decompressed ratio is below
        ``MIN_COMPRESSION_RATIO`` (signals a zip bomb)
    """
    if not content:
        raise HTTPException(status_code=400, detail="XLSX file is empty")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            # Quick check: refuse to read entries with absurd reported sizes
            total_uncompressed = 0
            total_compressed = len(content)
            for info in zf.infolist():
                total_uncompressed += info.file_size
                if total_uncompressed > MAX_XLSX_DECOMPRESSED_BYTES:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"XLSX decompressed size exceeds maximum "
                            f"({MAX_XLSX_DECOMPRESSED_BYTES // (1024 * 1024)} MB)"
                        ),
                    )
            if total_compressed > 0 and total_uncompressed > 0:
                ratio = total_uncompressed // total_compressed
                if ratio >= MIN_COMPRESSION_RATIO and total_uncompressed > 10 * 1024 * 1024:
                    # 10MB+ compressed archive that expands 100x+ is suspicious
                    raise HTTPException(
                        status_code=422,
                        detail="XLSX compression ratio suggests a decompression bomb",
                    )
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400, detail="File is not a valid XLSX/ZIP archive"
        ) from None


# ---------------------------------------------------------------------------
# EXIF stripping (image attachments)
# ---------------------------------------------------------------------------


def strip_image_exif(content: bytes) -> bytes:
    """Best-effort EXIF stripping for image uploads.

    Only attempts strip when the ``piexif`` or ``Pillow`` library is available;
    otherwise returns the original bytes unchanged (defensive — we don't want
    upload to fail when EXIF stripping is not installed).
    """
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        return content

    # Only operate on JPEG/PNG; other formats pass through unchanged.
    if not (content.startswith(_JPEG_MAGIC) or content.startswith(_PNG_MAGIC)):
        return content
    try:
        img = Image.open(io.BytesIO(content))
        # Remove EXIF by saving without it
        out = io.BytesIO()
        fmt = img.format or "PNG"
        if fmt == "JPEG":
            img = img.convert("RGB")  # ensure JPEG-compatible
            img.save(out, format="JPEG", exif=b"")
        else:
            img.save(out, format=fmt)
        return out.getvalue()
    except Exception:
        logger.exception("Failed to strip EXIF; passing content unchanged")
        return content


# ---------------------------------------------------------------------------
# Cap-aware upload reader
# ---------------------------------------------------------------------------


async def safe_read_upload(
    file: UploadFile,
    max_bytes: int,
    *,
    chunk_size: int = 1024 * 1024,
) -> bytes:
    """Read the full content of *file* but stop and 413 when *max_bytes* is exceeded.

    Reads in *chunk_size* chunks to keep memory bounded. Raises HTTPException(413)
    the first time the running total exceeds *max_bytes*. The full payload is
    returned only when it fits.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=(f"File exceeds maximum allowed size of {max_bytes // (1024 * 1024)} MB"),
            )
        chunks.append(chunk)
    return b"".join(chunks)
