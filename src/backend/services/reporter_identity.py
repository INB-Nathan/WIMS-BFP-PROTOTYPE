"""Resolve and encrypt immutable civilian reporter identity snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.kms import get_crypto_provider

LIFE_SAFETY_STATUSES = {"I_NEED_HELP", "SOMEONE_ELSE_NEEDS_HELP"}


@dataclass(frozen=True)
class ReporterIdentity:
    reporter_name: str
    reporter_phone: str | None
    contributor_user_id: str | None
    authenticated: bool

    def snapshot(self) -> dict[str, str | bool | None]:
        return {
            "reporter_name": self.reporter_name,
            "reporter_phone": self.reporter_phone,
            "contributor_user_id": self.contributor_user_id,
            "authenticated": self.authenticated,
        }


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _profile_name(user: dict[str, Any]) -> str | None:
    explicit = _clean(user.get("name"))
    if explicit:
        return explicit
    parts = [_clean(user.get("given_name")), _clean(user.get("family_name"))]
    joined = " ".join(part for part in parts if part)
    return joined or None


def resolve_reporter_identity(db: Session, body: Any, user: dict | None) -> ReporterIdentity:
    """Resolve anonymous input or authenticated server-side profile identity."""

    life_safety = body.safety_status in LIFE_SAFETY_STATUSES
    if user is None:
        reporter_name = _clean(body.reporter_name)
        reporter_phone = _clean(body.reporter_phone)
        missing = ["reporter_name"] if reporter_name is None else []
        if reporter_phone is None and not life_safety:
            missing.append("reporter_phone")
        if missing:
            raise HTTPException(
                status_code=422,
                detail={"code": "REPORTER_IDENTITY_REQUIRED", "missing_fields": missing},
            )
        return ReporterIdentity(
            reporter_name=reporter_name,
            reporter_phone=reporter_phone,
            contributor_user_id=None,
            authenticated=False,
        )

    if user.get("role") != "CIVILIAN_REPORTER":
        raise HTTPException(status_code=403, detail="CIVILIAN_REPORTER role required")

    profile = db.execute(
        text("SELECT contact_number FROM wims.users WHERE user_id = :user_id"),
        {"user_id": user["user_id"]},
    ).fetchone()
    reporter_name = _profile_name(user)
    reporter_phone = _clean(profile.contact_number) if profile is not None else None
    missing = []
    if reporter_name is None:
        missing.append("display_name")
    if reporter_phone is None and not life_safety:
        missing.append("contact_number")
    if missing:
        raise HTTPException(
            status_code=409,
            detail={"code": "PROFILE_INCOMPLETE", "missing_fields": missing},
        )

    return ReporterIdentity(
        reporter_name=reporter_name,
        reporter_phone=reporter_phone,
        contributor_user_id=str(user["user_id"]),
        authenticated=True,
    )


def persist_encrypted_reporter_identity(
    db: Session,
    report_id: int,
    identity: ReporterIdentity,
) -> None:
    """Encrypt and persist one immutable reporter snapshot, failing closed."""

    aad = f"civilian-report:{report_id}:reporter-identity:v1".encode("utf-8")
    try:
        provider = get_crypto_provider()
        nonce_b64, ciphertext = provider.encrypt_json(identity.snapshot(), aad)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Failed to protect reporter identity",
        ) from exc

    db.execute(
        text("""
            UPDATE wims.citizen_reports
            SET reporter_pii_blob_enc = :ciphertext,
                reporter_encryption_iv = :encryption_iv,
                reporter_crypto_provider = :crypto_provider,
                reporter_key_version = :key_version,
                reporter_kms_key_name = :kms_key_name
            WHERE report_id = :report_id
              AND reporter_pii_blob_enc IS NULL
        """),
        {
            "report_id": report_id,
            "ciphertext": ciphertext,
            "encryption_iv": nonce_b64,
            "crypto_provider": provider.crypto_provider,
            "key_version": provider.current_version,
            "kms_key_name": provider.kms_key_name,
        },
    )
