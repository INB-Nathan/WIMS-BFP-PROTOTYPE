"""Safe JPEG/PNG EXIF extraction and fail-closed deterministic sanitization.

This module is the security boundary for civilian photo uploads. Every
decode, verify, re-encode, and verification path must be fail-closed:
no exception path may return original bytes or write an artifact.

EXIF extraction occurs on raw image bytes *before* any sanitization,
so allowlisted metadata can be encrypted and stored alongside the
sanitized copy.

All distance calculations use PostGIS — not Python — so this module
provides only pure consensus classification.
"""

from __future__ import annotations

import dataclasses
import io
import logging
import math
import warnings
from typing import Literal

from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError, DecompressionBombWarning

logger = logging.getLogger("wims.exif")

# ── Constants ─────────────────────────────────────────────────────────────────

# Reviewed safe pixel limit. PIL.Image.MAX_IMAGE_PIXELS is set globally
# so that DecompressionBombWarning is converted to an error.
MAX_IMAGE_PIXELS = 178_956_970  # ~2^27.4 — safe for 20MP+ photos
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

# JPEG encoding constants for deterministic output
JPEG_QUALITY = 85
JPEG_SUBSAMPLING = 0  # 4:4:4 (no chroma subsampling)

# PNG encoding constants
PNG_COMPRESSION_LEVEL = 6  # default zlib level

# Safe EXIF tag allowlist — extracted before sanitization
_ALLOWED_EXIF_TAGS: set[int] = {
    0x010F,  # Make
    0x0110,  # Model
    0x0112,  # Orientation
    0x9003,  # DateTimeOriginal
    0x9010,  # OffsetTimeOriginal
    0xA002,  # PixelXDimension
    0xA003,  # PixelYDimension
}

# GPS IFD tag allowlist — extracted before sanitization
_ALLOWED_GPS_TAGS: set[int] = {
    0x0000,  # GPSVersionID
    0x0001,  # GPSLatitudeRef (N/S)
    0x0002,  # GPSLatitude (rational[3])
    0x0003,  # GPSLongitudeRef (E/W)
    0x0004,  # GPSLongitude (rational[3])
    0x0005,  # GPSAltitudeRef (0=sea level, 1=above)
    0x0006,  # GPSAltitude (rational)
    0x0007,  # GPSTimeStamp (rational[3])
    0x001D,  # GPSDateStamp (string YYYY:MM:DD)
}

# Supported image types for this module
_SUPPORTED_FORMATS: set[str] = {"JPEG", "PNG"}

# GPS convergence threshold — max of 100m or 3x browser accuracy
GPS_CONSENSUS_BASE_METERS = 100.0


# ── Types ─────────────────────────────────────────────────────────────────────


@dataclasses.dataclass
class ExifGPS:
    """Decoded EXIF GPS coordinates (decimal degrees)."""

    latitude: float
    longitude: float


@dataclasses.dataclass
class ExtractedExif:
    """Result of EXIF extraction from raw image bytes.

    All GPS values are in decimal degrees. Raw EXIF values are NOT
    stored here — they belong in the encrypted metadata blob.
    """

    gps: ExifGPS | None = None
    datetime_original: str | None = None
    offset_time: str | None = None
    make: str | None = None
    model: str | None = None
    orientation: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    has_exif: bool = False
    gps_present: bool = False

    @property
    def gps_status(self) -> str:
        """Derived status: 'present', 'unavailable'."""
        return "present" if self.gps_present else "unavailable"


@dataclasses.dataclass
class SanitizedImage:
    """Result of fail-closed image sanitization."""

    data: bytes
    width: int
    height: int
    media_type: str


GpsConsensus = Literal[
    "both_match",
    "both_disagree",
    "exif_only",
    "browser_only",
    "unavailable",
]

# ═══════════════════════════════════════════════════════════════════════════════
# EXIF Extraction — runs on raw bytes BEFORE sanitization
# ═══════════════════════════════════════════════════════════════════════════════


def _safe_rational(value: tuple[int, int] | int) -> float:
    """Safely convert a rational (numerator, denominator) or int to float.

    Rejects:
      - zero denominator
      - negative numerator (GPS coordinates are unsigned before ref)
      - non-finite results
    """
    if isinstance(value, (int, float)):
        result = float(value)
        if not math.isfinite(result) or result < 0:
            raise ValueError(f"Invalid GPS rational value: {value!r}")
        return result
    if isinstance(value, (tuple, list)) and len(value) == 2:
        num, den = int(value[0]), int(value[1])
    elif hasattr(value, "numerator") and hasattr(value, "denominator"):
        num, den = int(value.numerator), int(value.denominator)
    else:
        raise ValueError(f"Unexpected rational format: {value!r}")
    if den <= 0:
        raise ValueError("GPS rational denominator must be > 0")
    if num < 0:
        raise ValueError(f"GPS rational numerator must be >= 0: {num}")
    result = num / den
    if not math.isfinite(result):
        raise ValueError(f"Non-finite GPS rational: {result}")
    return result


def _to_decimal(coord: tuple[int, ...] | list[int], ref: str) -> float:
    """Convert EXIF rational GPS coordinate to decimal degrees.

    ``coord`` is a tuple of three (degree, minute, second) rationals,
    each as (numerator, denominator).  Returns the decimal value.
    Raises ValueError on zero denominator, negative component, or
    out-of-range minute/second/degree values.
    """
    if len(coord) != 3:
        raise ValueError(f"GPS coordinate must have 3 parts, got {len(coord)}")

    deg = _safe_rational(coord[0])
    minutes = _safe_rational(coord[1])
    seconds = _safe_rational(coord[2])

    if ref not in ("N", "S", "E", "W"):
        raise ValueError(f"Invalid GPS reference: {ref!r}")

    # Enforce unsigned degree/minute/second bounds BEFORE applying ref sign.
    max_degree = 90.0 if ref in ("N", "S") else 180.0
    if deg > max_degree:
        raise ValueError(f"GPS degrees out of range [0,{max_degree:g}): {deg}")
    if not (0 <= minutes < 60):
        raise ValueError(f"GPS minutes out of range [0,60): {minutes}")
    if not (0 <= seconds < 60):
        raise ValueError(f"GPS seconds out of range [0,60): {seconds}")
    if deg == max_degree and (minutes != 0 or seconds != 0):
        raise ValueError("GPS pole/edge coordinate requires zero minutes and seconds")

    result = deg + minutes / 60.0 + seconds / 3600.0
    if ref in ("S", "W"):
        result = -result

    if not math.isfinite(result) or abs(result) > max_degree:
        raise ValueError(f"GPS coordinate {result} out of range for {ref}")

    return result


def _extract_gps(gps_ifd: dict) -> ExifGPS | None:
    """Extract and validate GPS coordinates from EXIF GPS IFD.

    Returns None when GPS data is absent; malformed present data raises.
    Enforces latitude <= 90, longitude <= 180, and at the poles (exactly
    ±90/±180) requires zero minutes and seconds.
    """
    lat_ref = gps_ifd.get(0x0001)
    lat_data = gps_ifd.get(0x0002)
    lon_ref = gps_ifd.get(0x0003)
    lon_data = gps_ifd.get(0x0004)

    if not all([lat_ref, lat_data, lon_ref, lon_data]):
        return None
    if lat_ref not in ("N", "S") or lon_ref not in ("E", "W"):
        raise ValueError("Invalid EXIF GPS reference")

    latitude = _to_decimal(lat_data, lat_ref)
    longitude = _to_decimal(lon_data, lon_ref)

    if not -90 <= latitude <= 90:
        raise ValueError("EXIF latitude out of range")
    if not -180 <= longitude <= 180:
        raise ValueError("EXIF longitude out of range")

    # Pole edge: require zero remainder at exactly ±90/±180
    if abs(latitude) == 90.0:
        # Check that the rational components are (90, 0, 0) or very close
        try:
            minutes = _safe_rational(lat_data[1])
            seconds = _safe_rational(lat_data[2])
            if minutes != 0.0 or seconds != 0.0:
                raise ValueError("Latitude at ±90 must have 0 minutes and 0 seconds")
        except (ValueError, TypeError, IndexError):
            raise ValueError("Latitude at ±90 must have 0 minutes and 0 seconds")

    if abs(longitude) == 180.0:
        try:
            minutes = _safe_rational(lon_data[1])
            seconds = _safe_rational(lon_data[2])
            if minutes != 0.0 or seconds != 0.0:
                raise ValueError("Longitude at ±180 must have 0 minutes and 0 seconds")
        except (ValueError, TypeError, IndexError):
            raise ValueError("Longitude at ±180 must have 0 minutes and 0 seconds")

    return ExifGPS(latitude=latitude, longitude=longitude)


def extract_exif(raw: bytes) -> ExtractedExif:
    """Extract allowlisted EXIF metadata from raw image bytes.

    This function runs on raw upload bytes BEFORE sanitization. The
    extracted values are intended for encrypted metadata storage.

    Returns an ``ExtractedExif`` with only allowlisted fields populated.
    Raises ``ValueError`` on corrupt/unparseable EXIF data (fail-closed).
    """
    result = ExtractedExif()

    if not raw or len(raw) < 16:
        return result

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", DecompressionBombWarning)
            img = Image.open(io.BytesIO(raw))
            exif_data = img.getexif()
    except (DecompressionBombError, DecompressionBombWarning, UnidentifiedImageError) as exc:
        raise ValueError("Unsafe or undecodable image metadata") from exc
    except Exception as exc:
        raise ValueError("Unable to inspect image metadata") from exc

    if not exif_data:
        result.image_width, result.image_height = img.size
        return result

    result.has_exif = bool(exif_data)

    # Extract allowlisted standard tags
    for tag in _ALLOWED_EXIF_TAGS:
        try:
            value = exif_data.get(tag)
            if value is not None:
                if tag == 0x0112:  # Orientation
                    if isinstance(value, int) and 1 <= value <= 8:
                        result.orientation = value
                elif tag == 0x9003:  # DateTimeOriginal
                    if isinstance(value, str):
                        result.datetime_original = value
                elif tag == 0x9010:  # OffsetTimeOriginal
                    if isinstance(value, str):
                        result.offset_time = value
                elif tag == 0x010F:  # Make
                    if isinstance(value, str):
                        result.make = value.strip()
                elif tag == 0x0110:  # Model
                    if isinstance(value, str):
                        result.model = value.strip()
                elif tag == 0xA002:  # PixelXDimension
                    if isinstance(value, int) and value > 0:
                        result.image_width = value
                elif tag == 0xA003:  # PixelYDimension
                    if isinstance(value, int) and value > 0:
                        result.image_height = value
        except (ValueError, TypeError, IndexError):
            logger.debug("Skipped malformed allowlisted EXIF tag")

    # Extract GPS IFD — safe coordinates only
    try:
        gps_ifd = exif_data.get_ifd(0x8825)  # GPSInfo
        if gps_ifd:
            gps = _extract_gps(gps_ifd)
            if gps is not None:
                result.gps = gps
                result.gps_present = True
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError("Unsafe EXIF GPS metadata") from exc

    # Fallback dimensions from image size if EXIF dimensions missing
    if result.image_width is None and img.size:
        result.image_width = img.size[0]
    if result.image_height is None and img.size:
        result.image_height = img.size[1]

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Fail-closed image sanitization — deterministic re-encoding
# ═══════════════════════════════════════════════════════════════════════════════


def _reject_animated(img: Image.Image) -> None:
    """Reject animated/multi-frame images.

    Raises ``ValueError`` if the image has multiple frames or is
    identified as animated.
    """
    try:
        is_animated = getattr(img, "n_frames", 1) > 1
    except Exception:
        is_animated = False
    if is_animated:
        raise ValueError("Animated images are not supported")


def sanitize_image(raw: bytes, media_type: str) -> SanitizedImage:
    """Deterministically re-encode an image with no metadata.

    Steps:
    1. Verify magic bytes match claimed type
    2. Open, verify, reject animated, apply orientation transpose
    3. Build fresh pixel-only image (new Image, copy pixels only)
    4. Re-encode with deterministic metadata-free settings
    5. Reopen output and verify no metadata remains

    Raises ``ValueError`` on any failure -- no fail-open path.
    """
    if not raw or not media_type:
        raise ValueError("Empty input or missing media type")

    # Verify format from media_type
    if media_type == "image/jpeg":
        expected_format = "JPEG"
    elif media_type == "image/png":
        expected_format = "PNG"
    else:
        raise ValueError(f"Unsupported media type: {media_type}")

    # Step 1: Verify magic bytes
    _verify_magic_bytes(raw, media_type)

    # Step 2: Open and verify
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", DecompressionBombWarning)
            img = Image.open(io.BytesIO(raw))
            img.verify()
    except (DecompressionBombError, DecompressionBombWarning, UnidentifiedImageError) as exc:
        raise ValueError("Image verification rejected unsafe image") from exc
    except Exception as exc:
        raise ValueError("Image verification failed") from exc

    # Re-open after verify (verify consumes the file-like object)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", DecompressionBombWarning)
            img = Image.open(io.BytesIO(raw))
    except (DecompressionBombError, DecompressionBombWarning, UnidentifiedImageError) as exc:
        raise ValueError("Image re-open rejected unsafe image") from exc
    except Exception as exc:
        raise ValueError("Image re-open failed") from exc

    # Step 3: Check format matches expected (decoder agreement)
    if img.format != expected_format:
        raise ValueError(
            f"Image decoder format {img.format} does not match claimed type {expected_format}"
        )
    if img.format not in _SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported image format: {img.format}")

    # Reject animated
    _reject_animated(img)

    # Step 4: Apply orientation transpose (before building fresh image)
    try:
        img = ImageOps.exif_transpose(img) or img
    except Exception as exc:
        raise ValueError(f"Orientation transpose failed: {exc}") from exc

    # Step 5: Load pixels and build fresh pixel-only image
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", DecompressionBombWarning)
            img.load()
    except (DecompressionBombError, DecompressionBombWarning) as exc:
        raise ValueError("Image load rejected decompression bomb") from exc
    except Exception as exc:
        raise ValueError("Image load failed") from exc

    # Determine target mode
    if expected_format == "JPEG":
        target_mode = "RGB"
    else:
        target_mode = (
            "RGBA"
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
            else "RGB"
        )

    # Convert mode if needed before extracting pixels
    if img.mode != target_mode:
        img = img.convert(target_mode)

    # Build fresh pixel-only image -- do NOT save/reuse the source Image
    # object or carry its info/encoderinfo.
    try:
        pixels = list(img.get_flattened_data())
        fresh = Image.new(target_mode, img.size)
        fresh.putdata(pixels)
    except Exception as exc:
        raise ValueError(f"Failed to build fresh pixel image: {exc}") from exc

    # Step 6: Deterministic metadata-free re-encode
    out_buf = io.BytesIO()
    try:
        if expected_format == "JPEG":
            fresh.save(
                out_buf,
                format="JPEG",
                quality=JPEG_QUALITY,
                subsampling=JPEG_SUBSAMPLING,
                optimize=False,
                progressive=False,
                exif=b"",  # explicitly strip all EXIF
            )
        else:  # PNG
            fresh.save(
                out_buf,
                format="PNG",
                compress_level=PNG_COMPRESSION_LEVEL,
                optimize=False,
                pnginfo=None,  # explicitly strip all PNG ancillary metadata
            )
    except Exception as exc:
        raise ValueError(f"Image re-encode failed: {exc}") from exc

    sanitized = out_buf.getvalue()

    # Step 7: Reopen and verify
    _verify_sanitized_output(sanitized, expected_format, fresh.size)

    return SanitizedImage(
        data=sanitized,
        width=fresh.size[0],
        height=fresh.size[1],
        media_type=media_type,
    )


def _verify_magic_bytes(raw: bytes, media_type: str) -> None:
    """Verify that raw bytes start with the expected magic bytes."""
    if media_type == "image/jpeg" and not raw.startswith(b"\xff\xd8\xff"):
        raise ValueError("Image content does not match claimed type image/jpeg")
    if media_type == "image/png" and not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Image content does not match claimed type image/png")


def _verify_sanitized_output(
    data: bytes, expected_format: str, original_size: tuple[int, int]
) -> None:
    """Reopen sanitized output and verify format, dimensions, and metadata absence.

    Checks:
      - Expected format matches
      - Dimensions match (orientation-transposed if needed)
      - No EXIF entries remain
      - No unsafe info keys (EXIF, ICC profile, XMP, comment, Photoshop, DPI, thumbnail,
        PNG text, iTXt, or any non-structural key)

    Allows only encoder-required structural JFIF fields in ``info``.

    Raises ``ValueError`` on any failure -- no fail-open path.
    """
    if not data or len(data) < 64:
        raise ValueError("Sanitized output is too small")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", DecompressionBombWarning)
            reopened = Image.open(io.BytesIO(data))
            reopened.load()
    except (DecompressionBombError, DecompressionBombWarning, UnidentifiedImageError) as exc:
        raise ValueError("Sanitized output rejected unsafe image") from exc
    except Exception as exc:
        raise ValueError("Sanitized output reopen failed") from exc

    # Verify format matches expected
    if reopened.format != expected_format:
        raise ValueError(
            f"Sanitized output format {reopened.format} does not match expected {expected_format}"
        )
    if reopened.format not in _SUPPORTED_FORMATS:
        raise ValueError(f"Sanitized output format {reopened.format} is not supported")

    # Verify dimensions match (orientation-transposed)
    w, h = reopened.size
    expected_w, expected_h = original_size
    if w != expected_w or h != expected_h:
        # Allow transposed dimensions
        if w != expected_h or h != expected_w:
            raise ValueError(
                f"Sanitized output dimensions ({w}x{h}) "
                f"do not match input ({expected_w}x{expected_h})"
            )

    # Verify no EXIF remains
    exif = reopened.getexif()
    if exif:
        # Check all values -- if any are set, there's metadata
        if any(exif.values()):
            raise ValueError("Sanitized output still contains EXIF metadata")

    # Verify no unsafe metadata in info dict
    unsafe_keys = {
        "exif",
        "icc_profile",
        "xmp",
        "comment",
        "photoshop",
        "dpi",
        "thumbnail",
        "adobe",
        "adobe_transform",
    }
    # For PNG, also reject text/iTXt metadata
    if expected_format == "PNG":
        unsafe_keys.update({"text", "iTXt", "compression", "gamma", "srgb"})

    info = reopened.info
    found = {k for k in info if any(unsafe in k.lower() for unsafe in unsafe_keys)}
    if found:
        raise ValueError(f"Sanitized output contains unsafe metadata: {found}")

    # For JPEG, allow structural JFIF fields only (jj, jfif, jfif_version, etc.)
    if expected_format == "JPEG" and info:
        jfif_allowed = {"jfif", "jfif_version", "jfif_density", "jfif_unit"}
        extra = set(info.keys()) - jfif_allowed
        if extra:
            raise ValueError(f"JPEG sanitized output has unexpected info keys: {extra}")


def compute_gps_consensus(
    exif_gps: ExifGPS | None,
    browser_gps_lat: float | None,
    browser_gps_lon: float | None,
    browser_gps_accuracy: float | None,
    source_distance_m: float | None,
) -> str:
    """Classify GPS consensus from available sources and computed distance.

    Args:
        exif_gps: Extracted EXIF GPS coordinates (or None).
        browser_gps_lat: Browser GPS latitude (optional).
        browser_gps_lon: Browser GPS longitude (optional).
        browser_gps_accuracy: Browser GPS accuracy in meters (optional).
        source_distance_m: PostGIS-computed distance between EXIF and
            browser points, in meters (or None).

    Returns one of:
        'both_match'       — both sources agree within threshold
        'both_disagree'    — both sources disagree (beyond threshold)
        'exif_only'        — only EXIF GPS available
        'browser_only'     — only browser GPS available
        'unavailable'      — no GPS from either source
    """
    has_exif = exif_gps is not None
    has_browser = (
        browser_gps_lat is not None
        and browser_gps_lon is not None
        and browser_gps_accuracy is not None
    )

    if not has_exif and not has_browser:
        return "unavailable"

    if has_exif and not has_browser:
        return "exif_only"

    if not has_exif and has_browser:
        return "browser_only"

    # Both sources present — compare the two source points. If PostGIS
    # could not calculate the distance, fail closed as disagreement.
    if source_distance_m is None or not math.isfinite(source_distance_m):
        return "both_disagree"

    threshold = max(GPS_CONSENSUS_BASE_METERS, (browser_gps_accuracy or 0) * 3.0)
    if source_distance_m <= threshold:
        return "both_match"
    return "both_disagree"
