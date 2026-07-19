"""Capability-authorized public civilian-report tracking reads."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def get_capability_tracking_projection(
    db: Session, report_id: int, token_hash: str
) -> dict[str, Any] | None:
    """Return the minimal tracking projection authorized by one token hash.

    The database helper validates the bearer capability and reads the projection
    in one SECURITY DEFINER statement, so anonymous RLS never needs access to a
    contributor-linked citizen-report row.
    """
    row = (
        db.execute(
            text(
                """
            SELECT *
            FROM wims.get_capability_tracking_projection(:report_id, :token_hash)
            """
            ),
            {"report_id": report_id, "token_hash": token_hash},
        )
        .mappings()
        .first()
    )
    return dict(row) if row is not None else None
