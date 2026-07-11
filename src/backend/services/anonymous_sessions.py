"""Database-backed anonymous session capability adapter.

Raw bearer capabilities are accepted only at this boundary.  Issuance returns
one raw token for the caller to deliver once; validation and revocation return
only derived state.  This module deliberately does not log or persist bearer
values in Python.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class IssuedAnonymousSession:
    """The one-time issuance result; ``raw_token`` must not be stored or logged."""

    anonymous_session_id: UUID
    raw_token: str


def issue_anonymous_session(
    db: Session,
    device_id_hash: str | None = None,
) -> IssuedAnonymousSession:
    """Issue a capability through the SECURITY DEFINER SQL helper.

    ``device_id_hash`` is optional analytics data and must already be hashed by
    the caller.  The raw bearer is returned only in this issuance result.
    """
    try:
        row = db.execute(
            text(
                "SELECT anonymous_session_id, raw_token "
                "FROM wims.issue_anonymous_session(:device_id_hash)"
            ),
            {"device_id_hash": device_id_hash},
        ).one()
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise

    session_id, raw_token = row[0], row[1]
    if session_id is None or not isinstance(raw_token, str):
        raise RuntimeError("Anonymous session helper returned an invalid issuance")
    return IssuedAnonymousSession(anonymous_session_id=UUID(str(session_id)), raw_token=raw_token)


def validate_anonymous_session(db: Session, raw_token: str) -> UUID | None:
    """Validate a bearer and return only its derived session UUID.

    The SQL helper enforces token shape, idle/absolute expiry, and revocation.
    The caller owns the surrounding transaction; validation's last-seen update
    is therefore committed with the protected operation.
    """
    result = db.execute(
        text("SELECT wims.validate_anonymous_session(:raw_token)"),
        {"raw_token": raw_token},
    )
    value = result.scalar_one_or_none()
    return UUID(str(value)) if value is not None else None


def revoke_anonymous_session(db: Session, raw_token: str) -> bool:
    """Revoke a bearer through the SQL helper without exposing an owner ID."""
    try:
        result = db.execute(
            text("SELECT wims.revoke_anonymous_session(:raw_token)"),
            {"raw_token": raw_token},
        )
        revoked = bool(result.scalar_one_or_none())
        db.commit()
        return revoked
    except SQLAlchemyError:
        db.rollback()
        raise


def authorize_pending_photo(
    db: Session,
    raw_token: str,
    photo_id: UUID,
) -> bool:
    """Authorize one pending photo using the capability SQL helper.

    This is intentionally kept as a service-only adapter.  HTTP dependencies
    must use ``validate_anonymous_session`` and expose only the UUID to routes.
    """
    result = db.execute(
        text("SELECT wims.authorize_anonymous_pending_photo(:raw_token, :photo_id)"),
        {"raw_token": raw_token, "photo_id": photo_id},
    )
    return bool(result.scalar_one_or_none())


def resolve_pending_photo_owner(
    *,
    registered_user: dict[str, Any] | None,
    anonymous_session_id: UUID | None,
) -> tuple[UUID | None, UUID | None]:
    """Return ``(uploader_user_id, anonymous_session_id)`` for a pending row.

    A pending row has exactly one owner.  Caller-supplied device IDs are not
    accepted as an anonymous ownership mechanism.
    """
    if registered_user is not None:
        if registered_user.get("role") != "CIVILIAN_REPORTER":
            raise ValueError("registered user is not a civilian reporter")
        try:
            return UUID(str(registered_user["user_id"])), None
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise ValueError("registered user has no valid UUID") from exc
    if anonymous_session_id is None:
        raise ValueError("anonymous pending photo requires a validated session")
    return None, UUID(str(anonymous_session_id))
