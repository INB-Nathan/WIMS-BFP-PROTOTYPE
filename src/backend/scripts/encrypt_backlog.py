#!/usr/bin/env python3
"""
Backlog encryption migration — M6a AES-256-GCM scope expansion (#150).

Encrypts existing plaintext narrative_report, casualty_details, and
estimated_damage_php into the pii_blob_enc encrypted blob for all
incident_sensitive_details rows that pre-date the encryption expansion.

Usage:
    cd src/backend
    WIMS_MASTER_KEY=<base64-key> python scripts/encrypt_backlog.py

    Or via Docker:
    docker exec wims-backend python scripts/encrypt_backlog.py

Idempotent: rows already migrated are skipped.
"""

from __future__ import annotations

import os
import sys
import logging
from pathlib import Path

# Ensure backend src is on the import path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from database import SessionLocal
from utils.crypto import SecurityProvider, SecurityProviderError

logger = logging.getLogger("wims.encrypt-backlog")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

PII_FIELDS_ORIGINAL = {"caller_name", "caller_number", "owner_name", "occupant_name"}
PII_FIELDS_EXPANDED = PII_FIELDS_ORIGINAL | {
    "narrative_report",
    "casualty_details",
    "estimated_damage_php",
}


def run(db, sp: SecurityProvider) -> dict:
    """Encrypt backlog plaintext data in-place. Returns counts."""

    stats = {
        "total_rows": 0,
        "already_migrated": 0,
        "newly_encrypted": 0,
        "skipped_no_data": 0,
        "errors": 0,
    }

    # ── Find all incident_sensitive_details rows ──────────────────────────
    rows = db.execute(
        text("""
            SELECT
                incident_id,
                narrative_report,
                casualty_details,
                pii_blob_enc,
                encryption_iv
            FROM wims.incident_sensitive_details
        """)
    ).fetchall()

    # Also fetch estimated_damage_php from nonsensitive_details
    damage_map: dict[int, object] = {}
    damage_rows = db.execute(
        text("""
            SELECT incident_id, estimated_damage_php
            FROM wims.incident_nonsensitive_details
            WHERE estimated_damage_php IS NOT NULL
        """)
    ).fetchall()
    for dr in damage_rows:
        damage_map[dr.incident_id] = dr.estimated_damage_php

    for row in rows:
        stats["total_rows"] += 1
        incident_id = row.incident_id
        plaintext_narrative = row.narrative_report
        plaintext_casualty = row.casualty_details
        existing_blob = row.pii_blob_enc
        existing_iv = row.encryption_iv

        # ── Decrypt existing blob if present ──────────────────────────────
        existing_pii: dict = {}
        needs_reencrypt = False

        if existing_blob and existing_iv:
            try:
                aad = f"incident_id:{incident_id}".encode("utf-8")
                existing_pii = sp.decrypt_json(existing_iv, existing_blob, aad)
            except SecurityProviderError:
                logger.error(
                    "Decryption failed for incident_id=%s — skipping (possible key mismatch or tampering)",
                    incident_id,
                )
                stats["errors"] += 1
                continue

        # ── Check if already migrated ─────────────────────────────────────
        has_narrative = "narrative_report" in existing_pii
        has_casualty = "casualty_details" in existing_pii
        has_damage = "estimated_damage_php" in existing_pii

        if has_narrative and has_casualty and has_damage:
            # All expanded fields already in blob — skip
            stats["already_migrated"] += 1
            continue

        # ── Populate missing fields from plaintext columns ─────────────────
        if not has_narrative and plaintext_narrative:
            existing_pii["narrative_report"] = plaintext_narrative
            needs_reencrypt = True

        if not has_casualty and plaintext_casualty is not None:
            # casualty_details is JSONB — it may be a dict/list already
            existing_pii["casualty_details"] = plaintext_casualty
            needs_reencrypt = True

        if not has_damage and incident_id in damage_map:
            existing_pii["estimated_damage_php"] = damage_map[incident_id]
            needs_reencrypt = True

        if not needs_reencrypt:
            stats["skipped_no_data"] += 1
            continue

        # ── Re-encrypt the updated blob ────────────────────────────────────
        try:
            aad = f"incident_id:{incident_id}".encode("utf-8")
            nonce_b64, ct_b64 = sp.encrypt_json(existing_pii, aad)
        except SecurityProviderError as exc:
            logger.error(
                "Encryption failed for incident_id=%s: %s",
                incident_id,
                exc,
            )
            stats["errors"] += 1
            continue

        # ── Update the row — encrypt blob, NULL the migrated plaintext ─────
        set_clauses = [
            "pii_blob_enc = :blob",
            "encryption_iv = :nonce",
        ]
        params = {
            "iid": incident_id,
            "blob": ct_b64,
            "nonce": nonce_b64,
        }

        # NULL out plaintext columns that are now encrypted
        if not has_narrative and plaintext_narrative:
            set_clauses.append("narrative_report = NULL")
        if not has_casualty and plaintext_casualty is not None:
            set_clauses.append("casualty_details = NULL")

        db.execute(
            text(
                f"UPDATE wims.incident_sensitive_details "
                f"SET {', '.join(set_clauses)} "
                f"WHERE incident_id = :iid"
            ),
            params,
        )

        # NULL estimated_damage_php in the nonsensitive table separately
        if not has_damage and incident_id in damage_map:
            db.execute(
                text(
                    "UPDATE wims.incident_nonsensitive_details "
                    "SET estimated_damage_php = NULL "
                    "WHERE incident_id = :iid"
                ),
                {"iid": incident_id},
            )

        stats["newly_encrypted"] += 1

    db.commit()
    return stats


def main() -> None:
    """Entry point — requires WIMS_MASTER_KEY in environment."""
    if not os.environ.get("WIMS_MASTER_KEY"):
        logger.error(
            "WIMS_MASTER_KEY env var is required. Set it to the base64-encoded 32-byte AES-256 key."
        )
        sys.exit(1)

    try:
        sp = SecurityProvider()
    except SecurityProviderError as exc:
        logger.error("SecurityProvider init failed: %s", exc)
        sys.exit(1)

    db = SessionLocal()
    try:
        stats = run(db, sp)
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
