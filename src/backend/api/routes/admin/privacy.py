"""System Admin API — RA 10173 data-subject privacy rights (M6).

Export:  GET  /api/admin/privacy/export?subject_type=USER|REPORT&subject_id=...
Anonymize: POST /api/admin/privacy/anonymize

Both routes require SYSTEM_ADMIN. Export responses carry no-store headers.
Anonymization is IRREVERSIBLE — PII fields are nulled in-place to preserve FKs.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from schemas.privacy import (
    AnonymizeRequest,
    AnonymizeResponse,
    ConsentRecord,
    ExportResponse,
    SubjectType,
)
from services.kms import get_crypto_provider
from utils.audit import log_system_audit

router = APIRouter()
logger = logging.getLogger("wims.privacy")

_TERMINAL_STATUSES = frozenset(
    {
        "ACTIONED",
        "REJECTED_BOGUS",
        "REJECTED_DUPLICATE",
        "REJECTED_INSUFFICIENT",
        "REJECTED_TIMEOUT",
    }
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _row_to_dict(row) -> dict:
    if row is None:
        return {}
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row)


def _consent_history(db: Session, subject_type: str, subject_id: str) -> list[ConsentRecord]:
    rows = db.execute(
        text(
            "SELECT consent_id, subject_type, subject_id, consent_type, action, recorded_at "
            "FROM wims.consent_log "
            "WHERE subject_type = :st AND subject_id = :sid "
            "ORDER BY recorded_at DESC"
        ),
        {"st": subject_type, "sid": subject_id},
    ).fetchall()
    return [
        ConsentRecord(
            consent_id=r[0],
            subject_type=r[1],
            subject_id=r[2],
            consent_type=r[3],
            action=r[4],
            recorded_at=r[5],
        )
        for r in rows
    ]


def _decrypt_sensitive_details(sd_row) -> dict:
    """Decrypt pii_blob_enc → plaintext fields. Returns the full dict with PII injected."""
    sd = _row_to_dict(sd_row)
    incident_id = sd.get("incident_id")
    if sd.get("pii_blob_enc") and incident_id:
        try:
            aad = f"incident_id:{incident_id}".encode("utf-8")
            provider = get_crypto_provider(sd)
            enc_iv = sd.get("encryption_iv")
            pii = provider.decrypt_json(
                enc_iv if enc_iv else None, sd["pii_blob_enc"], aad, sd.get("key_version", 1)
            )
            sd["caller_name"] = pii.get("caller_name")
            sd["caller_number"] = pii.get("caller_number")
            sd["owner_name"] = pii.get("owner_name")
            sd["occupant_name"] = pii.get("occupant_name")
            sd["narrative_report"] = pii.get("narrative_report")
            sd["casualty_details"] = pii.get("casualty_details")
        except Exception:
            logger.error(
                "CRITICAL: PII blob decryption failed during privacy export — incident_id=%s",
                incident_id,
            )
    # Never expose raw blob columns
    for col in ("pii_blob_enc", "encryption_iv", "crypto_provider", "kms_key_name"):
        sd.pop(col, None)
    return sd


# ── Export ────────────────────────────────────────────────────────────────────


@router.get("/privacy/export")
def export_subject_data(
    subject_type: SubjectType = Query(...),
    subject_id: str = Query(...),
    request: Request = None,
    _admin: Annotated[dict, Depends(get_system_admin)] = None,
    db: Annotated[Session, Depends(get_db_with_rls)] = None,
):
    """Export all PII associated with a data subject as a portable JSON bundle.

    user subject  — returns the user's own profile row + their consent history.
                    Does NOT include incidents (third-party PII).
    report subject — returns the citizen_reports row (witness fields) + linked
                     incident_sensitive_details (decrypted) + consent history.

    Response carries Cache-Control: no-store.
    Access is audited (not the payload).
    """
    admin_id = _admin["user_id"]
    exported_at = datetime.now(timezone.utc)

    if subject_type == SubjectType.USER:
        user_row = db.execute(
            text(
                "SELECT user_id, username, role, contact_number, is_active, "
                "mfa_enabled, last_login, created_at "
                "FROM wims.users WHERE user_id = :uid"
            ),
            {"uid": subject_id},
        ).fetchone()
        if user_row is None:
            raise HTTPException(status_code=404, detail="User not found")

        profile = _row_to_dict(user_row)
        # Coerce non-serialisable types
        for k, v in list(profile.items()):
            if hasattr(v, "isoformat"):
                profile[k] = v.isoformat()
        consent = _consent_history(db, "USER", subject_id)

        log_system_audit(db, admin_id, "PII_EXPORT", "wims.users", None, request)
        db.commit()

        payload = ExportResponse(
            subject_type=subject_type,
            subject_id=subject_id,
            exported_at=exported_at,
            user_profile=profile,
            consent_history=consent,
        ).model_dump(mode="json")

    else:  # REPORT
        try:
            report_id = int(subject_id)
        except ValueError:
            raise HTTPException(
                status_code=422, detail="subject_id must be an integer for REPORT type"
            )

        report_row = db.execute(
            text(
                "SELECT report_id, witness_name, witness_phone, ip_hash, device_id, "
                "phone_latitude, phone_longitude, category, sub_category, "
                "reporting_context, safety_status, reported_at, created_at, status, "
                "verified_incident_id "
                "FROM wims.citizen_reports WHERE report_id = :rid"
            ),
            {"rid": report_id},
        ).fetchone()
        if report_row is None:
            raise HTTPException(status_code=404, detail="Report not found")

        report = _row_to_dict(report_row)
        for k, v in list(report.items()):
            if hasattr(v, "isoformat"):
                report[k] = v.isoformat()

        incident_id = report.get("verified_incident_id")
        sd_decrypted = None
        if incident_id:
            sd_row = db.execute(
                text(
                    "SELECT incident_id, caller_name, caller_number, owner_name, occupant_name, "
                    "narrative_report, street_address, landmark, prepared_by_officer, "
                    "noted_by_officer, remarks, pii_blob_enc, encryption_iv, "
                    "crypto_provider, kms_key_name, key_version "
                    "FROM wims.incident_sensitive_details WHERE incident_id = :iid"
                ),
                {"iid": incident_id},
            ).fetchone()
            if sd_row is not None:
                sd_decrypted = _decrypt_sensitive_details(sd_row)
                for k, v in list(sd_decrypted.items()):
                    if hasattr(v, "isoformat"):
                        sd_decrypted[k] = v.isoformat()

        consent = _consent_history(db, "REPORT", subject_id)

        log_system_audit(db, admin_id, "PII_EXPORT", "wims.citizen_reports", report_id, request)
        db.commit()

        payload = ExportResponse(
            subject_type=subject_type,
            subject_id=subject_id,
            exported_at=exported_at,
            citizen_report=report,
            incident_sensitive_details=sd_decrypted,
            consent_history=consent,
        ).model_dump(mode="json")

    response = JSONResponse(content=payload)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return response


# ── Anonymize ─────────────────────────────────────────────────────────────────


@router.post("/privacy/anonymize", response_model=AnonymizeResponse)
def anonymize_subject(
    body: AnonymizeRequest,
    request: Request = None,
    _admin: Annotated[dict, Depends(get_system_admin)] = None,
    db: Annotated[Session, Depends(get_db_with_rls)] = None,
):
    """Irreversibly erase PII for a data subject.

    WARNING: This operation is IRREVERSIBLE. Encrypted blobs are nulled — there
    is no recovery path. Call only after verifying the subject's identity and
    retaining the export bundle for legal records.

    user subject:
        - NULLs contact_number on wims.users.
        - Does NOT touch username (referenced in audit trails).

    report subject:
        - Refuses (409) if the report is not in a terminal status
          (ACTIONED / REJECTED_*).
        - NULLs witness fields on citizen_reports.
        - NULLs all PII columns + encrypted blob on incident_sensitive_details
          for the linked incident (if promoted).
        - NULLs full_name on all involved_parties rows for that incident.

    Idempotent — repeated calls on already-nulled rows succeed silently.
    """
    admin_id = _admin["user_id"]
    tables_affected: list[str] = []

    if body.subject_type == SubjectType.USER:
        result = db.execute(
            text("UPDATE wims.users SET contact_number = NULL WHERE user_id = :uid"),
            {"uid": body.subject_id},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
        tables_affected.append("wims.users")
        log_system_audit(db, admin_id, "PII_ANONYMIZE", "wims.users", None, request)

    else:  # REPORT
        try:
            report_id = int(body.subject_id)
        except ValueError:
            raise HTTPException(
                status_code=422, detail="subject_id must be an integer for REPORT type"
            )

        report_row = db.execute(
            text(
                "SELECT report_id, status, verified_incident_id "
                "FROM wims.citizen_reports WHERE report_id = :rid"
            ),
            {"rid": report_id},
        ).fetchone()
        if report_row is None:
            raise HTTPException(status_code=404, detail="Report not found")

        status_val = report_row[1]
        if status_val not in _TERMINAL_STATUSES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot anonymize report in non-terminal status '{status_val}'. "
                    f"Terminal statuses: {sorted(_TERMINAL_STATUSES)}"
                ),
            )

        db.execute(
            text(
                "UPDATE wims.citizen_reports SET "
                "witness_name = NULL, witness_phone = NULL, "
                "ip_hash = NULL, device_id = NULL, "
                "phone_latitude = NULL, phone_longitude = NULL "
                "WHERE report_id = :rid"
            ),
            {"rid": report_id},
        )
        tables_affected.append("wims.citizen_reports")
        log_system_audit(db, admin_id, "PII_ANONYMIZE", "wims.citizen_reports", report_id, request)

        incident_id = report_row[2]
        if incident_id:
            db.execute(
                text(
                    "UPDATE wims.incident_sensitive_details SET "
                    "caller_name = NULL, caller_number = NULL, "
                    "owner_name = NULL, occupant_name = NULL, narrative_report = NULL, "
                    "pii_blob_enc = NULL, encryption_iv = NULL, "
                    "kms_key_name = NULL, crypto_provider = NULL, key_version = NULL "
                    "WHERE incident_id = :iid"
                ),
                {"iid": incident_id},
            )
            tables_affected.append("wims.incident_sensitive_details")
            log_system_audit(
                db,
                admin_id,
                "PII_ANONYMIZE",
                "wims.incident_sensitive_details",
                incident_id,
                request,
            )

            db.execute(
                text("UPDATE wims.involved_parties SET full_name = NULL WHERE incident_id = :iid"),
                {"iid": incident_id},
            )
            tables_affected.append("wims.involved_parties")
            log_system_audit(
                db, admin_id, "PII_ANONYMIZE", "wims.involved_parties", incident_id, request
            )

    db.commit()
    return AnonymizeResponse(
        anonymized=True,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        tables_affected=tables_affected,
        warning="irreversible",
    )
