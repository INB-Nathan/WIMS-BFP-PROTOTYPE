#!/usr/bin/env python3
"""
Backlog encryption migration — encrypt existing plaintext witness PII in citizen_reports (#429).

Encrypts witness_name, witness_phone, device_id, and ip_hash into the
witness_pii_blob_enc encrypted blob for all citizen_reports rows that have
plaintext PII but no encrypted blob yet.

Usage:
    cd src/backend
    WIMS_MASTER_KEY=<base64-key> python scripts/encrypt_citizen_reports_backlog.py

    Or via Docker:
    docker exec wims-backend python scripts/encrypt_citizen_reports_backlog.py

Idempotent: rows already migrated (witness_pii_blob_enc IS NOT NULL) are skipped.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# Ensure backend src is on the import path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from database import SessionLocal
from services.kms import get_crypto_provider
from utils.crypto import SecurityProviderError

logger = logging.getLogger("wims.encrypt-citizen-reports")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


def run(db) -> dict:
    """Encrypt plaintext witness PII in-place. Returns counts."""

    stats = {
        "total_rows": 0,
        "already_migrated": 0,
        "newly_encrypted": 0,
        "skipped_no_data": 0,
        "errors": 0,
    }

    rows = db.execute(
        text("""
            SELECT report_id, witness_name, witness_phone, device_id, ip_hash,
                   witness_pii_blob_enc
            FROM wims.citizen_reports
            WHERE (witness_name IS NOT NULL
                   OR witness_phone IS NOT NULL
                   OR device_id IS NOT NULL
                   OR ip_hash IS NOT NULL)
            ORDER BY report_id
        """)
    ).fetchall()

    for row in rows:
        stats["total_rows"] += 1
        report_id = row.report_id
        existing_blob = row.witness_pii_blob_enc

        if existing_blob:
            stats["already_migrated"] += 1
            continue

        # Build PII dict, skipping None values
        pii_for_blob = {}
        if row.witness_name:
            pii_for_blob["witness_name"] = row.witness_name
        if row.witness_phone:
            pii_for_blob["witness_phone"] = row.witness_phone
        if row.device_id:
            pii_for_blob["device_id"] = str(row.device_id)
        if row.ip_hash:
            pii_for_blob["ip_hash"] = row.ip_hash

        if not pii_for_blob:
            stats["skipped_no_data"] += 1
            continue

        try:
            aad = f"citizen_report:{report_id}".encode("utf-8")
            provider = get_crypto_provider()
            nonce_b64, ct_b64 = provider.encrypt_json(pii_for_blob, aad)
            crypto_provider_val = provider.crypto_provider
            enc_iv = nonce_b64 if crypto_provider_val == "env_aesgcm" else None
        except (SecurityProviderError, Exception) as exc:
            logger.error(
                "Encryption failed for report_id=%s: %s",
                report_id,
                exc,
            )
            stats["errors"] += 1
            continue

        db.execute(
            text("""
                UPDATE wims.citizen_reports SET
                    witness_pii_blob_enc    = :blob,
                    witness_encryption_iv   = :iv,
                    witness_crypto_provider = :crypto_provider,
                    witness_key_version     = :key_version,
                    witness_name            = NULL,
                    witness_phone           = NULL,
                    device_id               = NULL,
                    ip_hash                 = NULL
                WHERE report_id = :rid
            """),
            {
                "rid": report_id,
                "blob": ct_b64,
                "iv": enc_iv,
                "crypto_provider": crypto_provider_val,
                "key_version": provider.current_version,
            },
        )
        stats["newly_encrypted"] += 1

    db.commit()
    return stats


def main() -> None:
    """Entry point — requires WIMS_MASTER_KEY in environment."""
    db = SessionLocal()
    try:
        stats = run(db)
    except Exception as exc:
        db.rollback()
        logger.exception("Migration aborted with error: %s", exc)
        sys.exit(1)
    finally:
        db.close()

    logger.info(
        "Migration complete: total=%d, already_migrated=%d, "
        "newly_encrypted=%d, skipped_no_data=%d, errors=%d",
        stats["total_rows"],
        stats["already_migrated"],
        stats["newly_encrypted"],
        stats["skipped_no_data"],
        stats["errors"],
    )

    if stats["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
