"""
Validation layer for GEOGRAPHY(POINT, 4326) inputs.
Catches non-WKT/non-geometry inputs before they hit the driver.
"""

from __future__ import annotations

import re
from typing import Any

from geoalchemy2.elements import WKBElement, WKTElement


# WKT POINT pattern: POINT(lon lat) or SRID=4326;POINT(lon lat)
# Supports optional whitespace, negative numbers, decimals
_WKT_POINT_RE = re.compile(
    r"^(SRID=\d+;)?\s*POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)$",
    re.IGNORECASE,
)


class InvalidLocationError(ValueError):
    """Raised when location input is not valid WKT POINT or geometry."""


def validate_location(value: Any) -> WKTElement | WKBElement:
    """
    Validate and normalize location input for GEOGRAPHY(POINT, 4326).

    Accepts:
        - WKT string: "POINT(120.9842 14.5995)" or "SRID=4326;POINT(120.9842 14.5995)"
        - (lon, lat) tuple
        - WKTElement or WKBElement (returned as-is)

    Rejects:
        - Plain strings (addresses, place names): "Manila", "123 Main St"
        - Comma-separated coords without POINT: "14.5995, 120.9842"
        - Non-geometry types

    Raises:
        InvalidLocationError: When input cannot be parsed as valid geometry.
    """
    if isinstance(value, (WKTElement, WKBElement)):
        return value

    if isinstance(value, (tuple, list)) and len(value) == 2:
        lon, lat = float(value[0]), float(value[1])
        return WKTElement(f"POINT({lon} {lat})", srid=4326)

    if isinstance(value, str):
        s = value.strip()
        if not s:
            raise InvalidLocationError("Empty location string")
        m = _WKT_POINT_RE.match(s)
        if m:
            lon, lat = m.group(2), m.group(3)
            return WKTElement(f"POINT({lon} {lat})", srid=4326)
        # Reject non-WKT strings (addresses, place names)
        raise InvalidLocationError(
            f"Location must be WKT POINT (e.g. 'POINT(lon lat)'), not plain text: {s[:50]!r}"
        )

    raise InvalidLocationError(
        f"Location must be WKT string, (lon, lat) tuple, or WKTElement/WKBElement; got {type(value).__name__}"
    )
