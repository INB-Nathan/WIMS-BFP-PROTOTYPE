"""Shared validation helpers for analytics — CSV escaping, ISO date validation.

Implements D15 (CSV/Excel formula injection) from docs/specs/api-validation-hardening.md.
"""

from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException, status

# Characters that trigger formula execution in spreadsheet applications
# when they appear at the start of a cell value.
# Escaping prefix: single quote (') — neutralized by Excel/Google Sheets.
_FORMULA_TRIGGERS = frozenset({"=", "+", "-", "@"})
# Control characters to strip from cell values
_CONTROL_CHARS = {"\t", "\r", "\n"}

# ISO 8601 date format: YYYY-MM-DD
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def escape_csv_cell(value: str) -> str:
    """Escape a single cell value to prevent CSV/Excel formula injection.

    Prefixes cells starting with =, +, -, @ with a single quote ('),
    which neutralizes formula execution in Excel, Google Sheets, and
    LibreOffice Calc. Strips tab, carriage return, and newline characters
    which can be used to inject additional rows/formulas.

    Per D15, this is applied at the export layer. PDF exports are exempt
    (not spreadsheet-parsed). The sanitization does not alter stored data.
    """
    if not value:
        return value

    # Strip control characters (tab, CR, LF) that can inject rows
    cleaned = value
    for ch in _CONTROL_CHARS:
        cleaned = cleaned.replace(ch, "")

    # Escape formula triggers at start of cell
    if cleaned and cleaned[0] in _FORMULA_TRIGGERS:
        return "'" + cleaned

    return cleaned


def validate_iso_date(value: str | None, field_name: str) -> None:
    """Validate that a string is in ISO 8601 date format (YYYY-MM-DD).

    Raises HTTPException 422 if the value is provided but not a valid date.

    Args:
        value: The date string to validate (None is silently skipped).
        field_name: Name of the field for the error message.
    """
    if value is None:
        return

    if not _ISO_DATE_RE.match(value):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} must be in ISO 8601 format (YYYY-MM-DD)",
        )

    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} is not a valid calendar date: {value}",
        )


def validate_date_range(start_date: str | None, end_date: str | None) -> None:
    """Validate that start_date <= end_date when both are provided.

    Raises HTTPException 422 if the range is inverted.
    Assumes dates have already been validated as ISO format.
    """
    if start_date is None or end_date is None:
        return

    try:
        sd = date.fromisoformat(start_date)
        ed = date.fromisoformat(end_date)
    except ValueError:
        return  # Individual validation handles this

    if sd > ed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"start_date ({start_date}) must be before or equal to end_date ({end_date})",
        )
