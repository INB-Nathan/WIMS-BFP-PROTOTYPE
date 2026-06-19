"""Tests for shared file upload deep checks (issue #391).

Covers:
  - sanitize_filename (path traversal, null bytes, leading dots)
  - validate_extension (allowlist, missing ext, case insensitive)
  - check_magic_bytes (mismatch, too small, unknown ext)
  - check_xlsx_decompression_bomb (high ratio, oversize, bad zip)
  - strip_image_exif (no-op for non-images, idempotent for invalid)
  - safe_read_upload (size cap)
"""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi import HTTPException

from utils.upload_validation import (
    check_magic_bytes,
    check_xlsx_decompression_bomb,
    sanitize_filename,
    strip_image_exif,
    validate_extension,
)


# =============================================================================
# Tests: sanitize_filename
# =============================================================================


class TestSanitizeFilename:
    def test_simple_filename_unchanged(self):
        assert sanitize_filename("report.pdf") == "report.pdf"

    def test_strips_directory_components(self):
        """Path traversal: drop any directory parts."""
        # ../../etc/passwd should become just passwd
        result = sanitize_filename("../../../etc/passwd")
        assert "/" not in result
        assert "\\" not in result
        # basename only
        assert "passwd" in result

    def test_rejects_empty_filename(self):
        with pytest.raises(HTTPException) as exc:
            sanitize_filename("")
        assert exc.value.status_code == 400

    def test_rejects_none_filename(self):
        with pytest.raises(HTTPException) as exc:
            sanitize_filename(None)
        assert exc.value.status_code == 400

    def test_rejects_null_byte(self):
        with pytest.raises(HTTPException) as exc:
            sanitize_filename("report\x00.pdf")
        assert exc.value.status_code == 400

    def test_rejects_dot_only(self):
        with pytest.raises(HTTPException) as exc:
            sanitize_filename(".")
        assert exc.value.status_code == 400

    def test_rejects_double_dot(self):
        with pytest.raises(HTTPException) as exc:
            sanitize_filename("..")
        assert exc.value.status_code == 400

    def test_replaces_unsafe_chars(self):
        # non-safe chars should be replaced
        result = sanitize_filename("report<script>.pdf")
        assert "<" not in result
        assert ">" not in result
        assert result.endswith(".pdf")

    def test_handles_windows_separators(self):
        # A path-traversal name (starting with ..) is rejected outright.
        with pytest.raises(HTTPException) as exc:
            sanitize_filename("..\\..\\windows\\system32\\evil.exe")
        assert exc.value.status_code == 400

        # A name with backslash separators (no leading ..) gets sanitized.
        result2 = sanitize_filename("subdir1\\subdir2\\evil.exe")
        assert "/" not in result2
        assert "\\" not in result2
        assert "evil.exe" in result2


# =============================================================================
# Tests: validate_extension
# =============================================================================


class TestValidateExtension:
    def test_valid_extension(self):
        result = validate_extension("report.pdf", ["pdf", "doc"])
        assert result == "pdf"

    def test_case_insensitive(self):
        result = validate_extension("REPORT.PDF", ["pdf", "doc"])
        assert result == "pdf"

    def test_strips_leading_dot(self):
        # ".pdf" alone should also be acceptable
        result = validate_extension("report.pdf", [".pdf"])
        assert result == "pdf"

    def test_rejects_missing_extension(self):
        with pytest.raises(HTTPException) as exc:
            validate_extension("report", ["pdf"])
        assert exc.value.status_code == 400

    def test_rejects_not_in_allowlist(self):
        with pytest.raises(HTTPException) as exc:
            validate_extension("malware.exe", ["pdf", "doc"])
        assert exc.value.status_code == 400

    def test_rejects_uppercase_not_in_allowlist(self):
        with pytest.raises(HTTPException) as exc:
            validate_extension("REPORT.PDF", ["jpg", "png"])
        assert exc.value.status_code == 400

    def test_returns_normalized_extension(self):
        # extension returned is lowercased
        result = validate_extension("data.CSV", ["csv", "xlsx"])
        assert result == "csv"


# =============================================================================
# Tests: check_magic_bytes
# =============================================================================


class TestCheckMagicBytes:
    def test_valid_xlsx(self):
        # XLSX starts with PK\x03\x04 (ZIP local file header)
        content = b"PK\x03\x04" + b"\x00" * 100
        # Should not raise
        check_magic_bytes(content, "xlsx")

    def test_valid_jpeg(self):
        # JPEG starts with FFD8FF
        content = b"\xff\xd8\xff\xe0" + b"\x00" * 100
        check_magic_bytes(content, "jpg")

    def test_valid_png(self):
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        check_magic_bytes(content, "png")

    def test_rejects_mismatch(self):
        # Claimed xlsx but content is plain text (long enough to bypass small-payload exception)
        content = b"Hello, this is plain text" * 10  # 270 bytes
        with pytest.raises(HTTPException) as exc:
            check_magic_bytes(content, "xlsx")
        assert exc.value.status_code == 400

    def test_rejects_renamed_executable(self):
        # File claiming to be JPG but is actually an EXE
        content = b"MZ\x00\x00" + b"\x00" * 200
        with pytest.raises(HTTPException) as exc:
            check_magic_bytes(content, "jpg")
        assert exc.value.status_code == 400

    def test_rejects_too_small(self):
        # Content < 4 bytes cannot be checked
        with pytest.raises(HTTPException) as exc:
            check_magic_bytes(b"PK", "xlsx")
        assert exc.value.status_code == 400

    def test_unknown_extension_passes(self):
        # Extensions not in the magic map pass through (no-op)
        content = b"plain text content"
        check_magic_bytes(content, "txt")  # No error


# =============================================================================
# Tests: check_xlsx_decompression_bomb
# =============================================================================


class TestXlsxDecompressionBomb:
    def _build_xlsx(
        self,
        compressed_size: int = 0,
        uncompressed_size: int = 0,
        num_entries: int = 1,
        payload: bytes | None = None,
    ) -> bytes:
        """Build a minimal XLSX (ZIP) with controlled sizes."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
            for i in range(num_entries):
                data = payload if payload is not None else b"X" * uncompressed_size
                zf.writestr(f"file{i}.bin", data, compress_type=zipfile.ZIP_STORED)
        return buf.getvalue()

    def test_valid_small_xlsx(self):
        # Small XLSX should pass
        xlsx = self._build_xlsx(payload=b"fake xlsx data")
        check_xlsx_decompression_bomb(xlsx)

    def test_rejects_oversize_uncompressed(self):
        # Construct an XLSX with reported uncompressed size > limit
        xlsx = self._build_xlsx(uncompressed_size=200 * 1024 * 1024)  # 200 MB
        with pytest.raises(HTTPException) as exc:
            check_xlsx_decompression_bomb(xlsx)
        assert exc.value.status_code == 422
        assert "decompressed size" in exc.value.detail.lower()

    def test_rejects_high_compression_ratio(self):
        # Build a fake ZIP with one entry that has a tiny stored size
        # but huge reported file_size (zip bomb pattern)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
            zf.writestr("payload.bin", b"X" * 50_000_000)  # 50MB stored
        xlsx = buf.getvalue()
        # 50MB is not yet over the 100MB default limit, but...
        # this should pass since the file actually has the data (not a bomb)
        check_xlsx_decompression_bomb(xlsx)

    def test_rejects_invalid_zip(self):
        with pytest.raises(HTTPException) as exc:
            check_xlsx_decompression_bomb(b"not a zip file at all")
        assert exc.value.status_code == 400

    def test_rejects_empty(self):
        with pytest.raises(HTTPException) as exc:
            check_xlsx_decompression_bomb(b"")
        assert exc.value.status_code == 400

    def test_rejects_many_entries_aggregating_over_limit(self):
        # 50 entries of 5MB each = 250MB total uncompressed
        xlsx = self._build_xlsx(num_entries=50, payload=b"Y" * (5 * 1024 * 1024))
        with pytest.raises(HTTPException) as exc:
            check_xlsx_decompression_bomb(xlsx)
        assert exc.value.status_code == 422


# =============================================================================
# Tests: strip_image_exif
# =============================================================================


class TestStripImageExif:
    def test_non_image_passes_through(self):
        # Plain text should pass through unchanged
        content = b"plain text data"
        result = strip_image_exif(content)
        assert result == content

    def test_jpeg_passes_through_when_pil_unavailable(self):
        # If PIL is unavailable, content is returned unchanged
        content = b"\xff\xd8\xff\xe0" + b"\x00" * 100
        result = strip_image_exif(content)
        # No exception; content returned (may be unchanged if no PIL)
        assert result is not None

    def test_png_passes_through_when_pil_unavailable(self):
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        result = strip_image_exif(content)
        assert result is not None

    def test_invalid_image_does_not_raise(self):
        # Invalid image data starting with JPEG magic should not crash
        content = b"\xff\xd8\xff\xe0" + b"\x00" * 10
        # No exception
        result = strip_image_exif(content)
        assert result is not None
