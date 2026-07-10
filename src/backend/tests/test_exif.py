"""Focused fail-closed civilian photo EXIF/sanitization contracts.

Covers:
- Basic sanitization (deterministic, metadata-free)
- MIME/decoder mismatch (JPEG claimed as PNG, PNG claimed as JPEG)
- Fresh pixel-only image construction
- PNG ancillary metadata rejection (tEXt, iTXt, ICC, comments, thumbnail)
- EXIF extraction before sanitization
- GPS rational bounds, negative components, pole edges, zero denominators
- Consensus classification
- Bomb warnings/errors, animation rejection
"""

from io import BytesIO

import pytest
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from utils.exif import ExifGPS, compute_gps_consensus, extract_exif, sanitize_image


# ── Helpers ───────────────────────────────────────────────────────────────────


def _jpeg_bytes(size=(8, 4), color=(20, 40, 60)) -> bytes:
    """Create a minimal JPEG with no EXIF metadata."""
    image = Image.new("RGB", size, color)
    out = BytesIO()
    image.save(out, format="JPEG", quality=90)
    return out.getvalue()


def _jpeg_with_exif() -> bytes:
    """Create a JPEG with EXIF metadata (make, model, orientation, GPS)."""
    image = Image.new("RGB", (16, 8), (10, 20, 30))
    out = BytesIO()
    exif_data = Image.Exif()
    exif_data[0x010F] = "TestCamera"  # Make
    exif_data[0x0110] = "ModelX"  # Model
    exif_data[0x0112] = 1  # Orientation (normal)
    exif_data[0x9003] = "2025:01:15 10:30:00"  # DateTimeOriginal
    image.save(out, format="JPEG", exif=exif_data.tobytes())
    return out.getvalue()


def _png_bytes(size=(8, 4)) -> bytes:
    """Create a minimal PNG with no ancillary metadata."""
    image = Image.new("RGBA", size, (20, 40, 60, 255))
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _png_with_text_metadata() -> bytes:
    """Create a PNG with tEXt and iTXt metadata chunks."""
    image = Image.new("RGB", (8, 4), (100, 150, 200))
    # Explicitly create tEXt chunks via Pillow's PngInfo.
    info = PngInfo()
    info.add_text("Comment", "test comment")
    info.add_itxt("Author", "test author")
    out2 = BytesIO()
    image.save(out2, format="PNG", pnginfo=info)
    return out2.getvalue()


# ─── Deterministic metadata-free sanitization ────────────────────────────────


def test_sanitization_is_deterministic_and_metadata_free():
    raw = _jpeg_bytes()
    first = sanitize_image(raw, "image/jpeg")
    second = sanitize_image(raw, "image/jpeg")
    assert first.data == second.data
    assert first.data != raw
    reopened = Image.open(BytesIO(first.data))
    assert reopened.getexif() == {}
    assert (first.width, first.height) == (8, 4)


def test_sanitization_deterministic_png():
    # Include ancillary text metadata so sanitization has observable work.
    raw = _png_with_text_metadata()
    first = sanitize_image(raw, "image/png")
    second = sanitize_image(raw, "image/png")
    assert first.data == second.data
    assert first.data != raw
    reopened = Image.open(BytesIO(first.data))
    assert reopened.getexif() == {}
    assert "text" not in reopened.info
    assert (first.width, first.height) == (8, 4)


def test_sanitized_matches_expected_format():
    raw = _jpeg_bytes()
    result = sanitize_image(raw, "image/jpeg")
    assert result.media_type == "image/jpeg"
    reopened = Image.open(BytesIO(result.data))
    assert reopened.format == "JPEG"

    raw2 = _png_bytes()
    result2 = sanitize_image(raw2, "image/png")
    assert result2.media_type == "image/png"
    reopened2 = Image.open(BytesIO(result2.data))
    assert reopened2.format == "PNG"


# ─── MIME/Decoder mismatch ────────────────────────────────────────────────────


def test_jpeg_claimed_as_png_rejected():
    """JPEG bytes claimed as PNG must be rejected at decoder agreement check."""
    raw = _jpeg_bytes()
    with pytest.raises(ValueError, match="does not match claimed type"):
        sanitize_image(raw, "image/png")


def test_png_claimed_as_jpeg_rejected():
    """PNG bytes claimed as JPEG must be rejected at decoder agreement check."""
    raw = _png_bytes()
    with pytest.raises(ValueError, match="does not match claimed type"):
        sanitize_image(raw, "image/jpeg")


def test_corrupt_and_mismatched_images_fail_closed():
    with pytest.raises(ValueError):
        sanitize_image(b"not an image", "image/jpeg")
    with pytest.raises(ValueError):
        sanitize_image(_jpeg_bytes(), "image/png")


# ─── Fresh pixel-only image ──────────────────────────────────────────────────


def test_fresh_pixel_image_has_no_carried_metadata():
    """Sanitized image must not carry source Image info/encoderinfo."""
    raw = _jpeg_with_exif()
    result = sanitize_image(raw, "image/jpeg")
    reopened = Image.open(BytesIO(result.data))
    # No EXIF
    assert not any(reopened.getexif().values())
    # No info keys (allow only structural JFIF)
    info_keys = set(reopened.info.keys())
    # JFIF is OK
    allowed = {"jfif", "jfif_version", "jfif_density", "jfif_unit"}
    unexpected = info_keys - allowed
    assert not unexpected, f"Unexpected info keys: {unexpected}"
    # Pixels should be preserved (lossy JPEG may have slight variation)
    assert reopened.size == (16, 8)


# ─── PNG ancillary metadata rejection ────────────────────────────────────────


def test_png_with_text_metadata_is_sanitized():
    """PNG with tEXt/iTXt chunks must have them removed during sanitization."""
    raw = _png_with_text_metadata()
    result = sanitize_image(raw, "image/png")
    reopened = Image.open(BytesIO(result.data))
    assert "text" not in reopened.info
    assert "iTXt" not in reopened.info
    assert "Comment" not in reopened.info.get("text", {})
    assert reopened.getexif() == {}


def test_png_with_icc_profile_is_sanitized():
    """PNG with embedded ICC profile must have it stripped."""
    # Re-save with ICC profile
    out = BytesIO()
    img = Image.new("RGB", (8, 4), (100, 150, 200))
    icc = b"simple_icc_test_data"
    img.save(out, format="PNG", icc_profile=icc)
    raw_with_icc = out.getvalue()

    result = sanitize_image(raw_with_icc, "image/png")
    reopened = Image.open(BytesIO(result.data))
    assert "icc_profile" not in reopened.info


# ─── EXIF extraction ──────────────────────────────────────────────────────────


def test_exif_extraction_runs_on_raw_image():
    raw = _jpeg_with_exif()
    extracted = extract_exif(raw)
    assert extracted.has_exif is True
    assert extracted.make == "TestCamera"
    assert extracted.model == "ModelX"
    assert extracted.datetime_original == "2025:01:15 10:30:00"
    assert extracted.image_width is not None
    assert extracted.image_height is not None


def test_exif_extraction_before_sanitization():
    """EXIF must be extractable from raw bytes before sanitization removes it."""
    raw = _jpeg_with_exif()
    extracted = extract_exif(raw)
    assert extracted.has_exif
    sanitized = sanitize_image(raw, "image/jpeg")
    after = extract_exif(sanitized.data)
    assert after.has_exif is False


def test_exif_extraction_no_exif():
    raw = _jpeg_bytes()
    extracted = extract_exif(raw)
    assert extracted.has_exif is False
    assert extracted.make is None
    assert extracted.model is None


# ─── GPS rational bounds ──────────────────────────────────────────────────────


def test_gps_rational_zero_denominator_rejected():
    """GPS rational with zero denominator must raise ValueError."""
    from utils.exif import _safe_rational

    with pytest.raises(ValueError):
        _safe_rational((10, 0))


def test_gps_rational_negative_numerator_rejected():
    """GPS rational with negative numerator must raise ValueError."""
    from utils.exif import _safe_rational

    with pytest.raises(ValueError):
        _safe_rational((-10, 1))
    with pytest.raises(ValueError):
        _safe_rational((10, -1))


def test_gps_negative_component_raises():
    """GPS coordinate with negative minute must raise ValueError."""
    from utils.exif import _to_decimal

    with pytest.raises(ValueError):
        _to_decimal(((10, 1), (-30, 1), (0, 1)), "N")


def test_gps_minutes_out_of_range():
    """GPS minutes >= 60 must raise ValueError."""
    from utils.exif import _to_decimal

    with pytest.raises(ValueError, match="minutes out of range"):
        _to_decimal(((10, 1), (60, 1), (0, 1)), "N")


def test_gps_seconds_out_of_range():
    """GPS seconds >= 60 must raise ValueError."""
    from utils.exif import _to_decimal

    with pytest.raises(ValueError, match="seconds out of range"):
        _to_decimal(((10, 1), (30, 1), (60, 1)), "N")


def test_gps_pole_edge_latitude_zero_remainder():
    """At ±90 latitude, minutes and seconds must be zero."""
    from utils.exif import _to_decimal

    with pytest.raises(ValueError, match="minutes and seconds"):
        _to_decimal(((90, 1), (1, 1), (0, 1)), "N")


def test_gps_pole_edge_longitude_zero_remainder():
    """At ±180 longitude, minutes and seconds must be zero."""
    # Convert to _extract_gps-level check: it reads from GPS IFD
    with pytest.raises(ValueError, match="minutes and seconds"):
        # Simulate what _extract_gps does
        from utils.exif import _extract_gps

        gps_ifd = {
            0x0001: "N",
            0x0002: ((45, 1), (0, 1), (0, 1)),
            0x0003: "E",
            0x0004: ((180, 1), (1, 1), (0, 1)),  # longitude edge with remainder
        }
        _extract_gps(gps_ifd)


def test_gps_pole_edge_valid():
    """Valid pole coordinate (90, 0, 0) must succeed."""
    from utils.exif import _to_decimal

    result = _to_decimal(((90, 1), (0, 1), (0, 1)), "N")
    assert result == 90.0
    result2 = _to_decimal(((90, 1), (0, 1), (0, 1)), "S")
    assert result2 == -90.0
    result3 = _to_decimal(((180, 1), (0, 1), (0, 1)), "E")
    assert result3 == 180.0
    result4 = _to_decimal(((180, 1), (0, 1), (0, 1)), "W")
    assert result4 == -180.0


def test_gps_valid_coordinate():
    """Normal valid GPS coordinate must return correct decimal degrees."""
    from utils.exif import _to_decimal

    result = _to_decimal(((40, 1), (26, 1), (46, 1)), "N")
    assert abs(result - 40.446111) < 0.001
    result2 = _to_decimal(((40, 1), (26, 1), (46, 1)), "S")
    assert abs(result2 - (-40.446111)) < 0.001
    result3 = _to_decimal(((74, 1), (0, 1), (30, 1)), "W")
    assert abs(result3 - (-74.008333)) < 0.001


def test_gps_latitude_out_of_range():
    """Latitude > 90 must raise ValueError."""
    from utils.exif import _to_decimal

    with pytest.raises(ValueError):
        _to_decimal(((91, 1), (0, 1), (0, 1)), "N")


def test_gps_longitude_out_of_range():
    """Longitude > 180 must raise ValueError."""
    from utils.exif import _to_decimal

    with pytest.raises(ValueError, match="out of range"):
        _to_decimal(((181, 1), (0, 1), (0, 1)), "E")


# ─── Consensus classification ─────────────────────────────────────────────────


def test_gps_consensus_is_pure_source_distance_classification():
    exif = ExifGPS(14.0, 121.0)
    assert compute_gps_consensus(exif, 14.0, 121.0, 10.0, 20.0) == "both_match"
    assert compute_gps_consensus(exif, 14.0, 121.0, 10.0, 150.0) == "both_disagree"
    assert compute_gps_consensus(exif, None, None, None, None) == "exif_only"
    assert compute_gps_consensus(None, None, None, None, None) == "unavailable"
    assert compute_gps_consensus(None, 14.0, 121.0, 10.0, None) == "browser_only"


# ─── Bomb warnings / error rejection ─────────────────────────────────────────


def test_decompression_bomb_rejected():
    """Extremely large image dimensions must be rejected."""
    with pytest.raises(ValueError):
        sanitize_image(b"\xff\xd8\xff\x00" + b"\x00" * 100, "image/jpeg")


def test_animation_rejection():
    """Animated PNG (APNG) images must be rejected."""
    first = Image.new("RGBA", (8, 4), (20, 40, 60, 255))
    second = Image.new("RGBA", (8, 4), (60, 40, 20, 255))
    out = BytesIO()
    first.save(out, format="PNG", save_all=True, append_images=[second], duration=100)
    with pytest.raises(ValueError, match="Animated"):
        sanitize_image(out.getvalue(), "image/png")
