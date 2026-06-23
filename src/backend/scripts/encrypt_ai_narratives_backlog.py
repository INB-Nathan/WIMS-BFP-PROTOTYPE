#!/usr/bin/env python3
"""
Backlog encryption migration — encrypt existing plaintext AI narratives in fire_incidents (#429).

Encrypts ai_narrative text into the ai_narrative_enc encrypted blob for all
fire_incident rows that have plaintext narratives but no encrypted blob yet.

Usage:
    cd src/backend
    WIMS_MASTER_KEY=<base64-key> python scripts/encrypt_ai_narratives_backlog.py

    Or via Docker:
    docker exec wims-backend python scripts/encrypt_ai_narratives_backlog.py

Idempotent: rows already migrated (ai_narrative_enc IS NOT NULL) are skipped.
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

logger = logging.getLogger("wims.encrypt-ai-narratives")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


def run(db) -> dict:
    """Encrypt plaintext AI narratives in-place. Returns counts."""

    stats = {
        "total_rows": 0,
        "already_migrated": 0,
        "newly_encrypted": 0,
        "skipped_no_data": 0,
        "errors": 0,
    }

    rows = db.execute(
        text("""
            SELECT incident_id, ai_narrative, ai_narrative_enc
            FROM wims.fire_incidents
            WHERE ai_narrative IS NOT NULL
            ORDER BY incident_id
        """)
    ).fetchall()

    for row in rows:
        stats["total_rows"] += 1
        incident_id = row.incident_id
        existing_enc = row.ai_narrative_enc
        narrative = row.ai_narrative

        if existing_enc:
            stats["already_migrated"] += 1
            continue

        if not narrative:
            stats["skipped_no_data"] += 1
            continue

        try:
            aad = f"incident_id:{incident_id}:ai_narrative".encode("utf-8")
            provider = get_crypto_provider()
            nonce_b64, ct_b64 = provider.encrypt_json({"narrative": narrative}, aad)
            crypto_provider_val = provider.crypto_provider
            enc_iv = nonce_b64 if crypto_provider_val == "env_aesgcm" else None
        except (SecurityProviderError, Exception) as exc:
            logger.error(
                "Encryption failed for incident_id=%s: %s",
                incident_id,
                exc,
            )
            stats["errors"] += 1
            continue

        db.execute(
            text("""
                UPDATE wims.fire_incidents SET
                    ai_narrative_enc              = :blob,
                    ai_narrative_encryption_iv     = :iv,
                    ai_narrative_crypto_provider   = :crypto_provider,
                    ai_narrative_key_version       = :key_version,
                    ai_narrative                   = NULL
                WHERE incident_id = :iid
            """),
            {
                "iid": incident_id,
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
