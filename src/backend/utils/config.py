"""DB-backed system configuration helper.

Read-only helper usable from any layer (routes, services, Celery tasks).
The wims.system_config SELECT policy is USING (TRUE) so calls via raw
_SessionLocal() sessions (no RLS GUC set) succeed without error.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def get_config(db: Session, key: str, default: str = "") -> str:
    """Return config_value for *key*, or *default* if the row does not exist."""
    row = db.execute(
        text("SELECT config_value FROM wims.system_config WHERE config_key = :key"),
        {"key": key},
    ).fetchone()
    return row[0] if row else default
