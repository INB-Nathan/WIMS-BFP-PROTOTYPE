"""Audited, fail-closed reveal of encrypted reporter identity."""

from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from schemas.triage_workspace import ContactRevealResponse
from services.kms import get_crypto_provider
from utils.audit import log_system_audit


def reveal_reporter_contact(
    db: Session,
    report_id: int,
    user: dict,
    request: Request,
) -> ContactRevealResponse:
    row = db.execute(
        text("""
            SELECT report_id, reporter_pii_blob_enc, reporter_encryption_iv,
                   reporter_crypto_provider, reporter_key_version,
                   reporter_kms_key_name
            FROM wims.citizen_reports
            WHERE report_id = :report_id
        """),
        {"report_id": report_id},
    ).fetchone()
    if row is None or not row.reporter_pii_blob_enc:
        raise HTTPException(status_code=404, detail="Report not found")

    try:
        provider = get_crypto_provider(
            {
                "crypto_provider": row.reporter_crypto_provider,
                "kms_key_name": row.reporter_kms_key_name,
            }
        )
        snapshot = provider.decrypt_json(
            row.reporter_encryption_iv,
            row.reporter_pii_blob_enc,
            f"civilian-report:{report_id}:reporter-identity:v1".encode("utf-8"),
            int(row.reporter_key_version),
        )
        reporter_name = str(snapshot["reporter_name"]).strip()
        reporter_phone = snapshot.get("reporter_phone")
        reporter_phone = str(reporter_phone).strip() if reporter_phone else None
        if not reporter_name:
            raise ValueError("empty reporter name")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Reporter contact is unavailable") from exc

    correlation_id = getattr(getattr(request, "state", None), "correlation_id", None)
    try:
        # Deliberately omit request so raw IP/user-agent are not written for a
        # contact reveal. The correlation id is retained explicitly.
        log_system_audit(
            db=db,
            user_id=user["user_id"],
            action_type="CIVILIAN_REPORT_CONTACT_REVEAL",
            table_affected="wims.citizen_reports",
            record_id=report_id,
            request=None,
            new_values={"report_id": report_id, "outcome": "revealed"},
            correlation_id=correlation_id,
            sensitive=True,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Contact reveal audit failed") from exc

    return ContactRevealResponse(
        report_id=report_id,
        reporter_name=reporter_name,
        reporter_phone=reporter_phone,
    )
