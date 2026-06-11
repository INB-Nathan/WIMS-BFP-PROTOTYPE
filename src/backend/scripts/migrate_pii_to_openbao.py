#!/usr/bin/env python3
"""
Phase 5 #152 — Legacy env-AES → OpenBao Transit migration tooling.

Migrates existing PII blobs encrypted with env_aesgcm to openbao_transit
in bounded, resumable batches.

Usage:
    cd src/backend

    DATABASE_URL=postgresql://postgres:pass@postgres:5432/wims \\
    OPENBAO_ADDR=http://openbao:8200 OPENBAO_TOKEN=s.xxx \\
    WIMS_MASTER_KEY=<base64-key> \\
    python scripts/migrate_pii_to_openbao.py

Options:
    --dry-run          Count candidates, report stats, no writes
    --batch-size N     Rows per transaction (default 500)
    --incident-id ID   Migrate a single row by incident_id
    --resume-after ID  Start after this incident_id (keyset cursor)
    --limit N          Max total rows to process

Idempotent: rows already ``crypto_provider='openbao_transit'`` are skipped.
Commit per batch; one bad row increments errors and continues.
Exit code 1 if errors > 0.
Never logs plaintext, ciphertext, nonces, keys, or tokens.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Any

# Ensure backend src is on the import path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from database import _AdminSessionLocal
from utils.crypto import SecurityProvider, SecurityProviderError
from services.kms.openbao_client import KmsSecurityProvider, OpenBaoClientError

logger = logging.getLogger("wims.migrate-to-openbao")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


# ── Column detection ──────────────────────────────────────────────────────────


def _has_key_version_column(db) -> bool:
    """Check if wims.incident_sensitive_details has a key_version column.

    This branch may not yet have PR #252 schema — detect dynamically.
    """
    row = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'wims'
                  AND table_name = 'incident_sensitive_details'
                  AND column_name = 'key_version'
            )
        """)
    ).scalar()
    return bool(row)


# ── CLI ───────────────────────────────────────────────────────────────────────


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate legacy env-AES PII blobs to OpenBao Transit"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count candidates, report stats, no writes",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows per transaction (default 500)",
    )
    parser.add_argument(
        "--incident-id",
        type=int,
        default=None,
        help="Migrate a single row by incident_id",
    )
    parser.add_argument(
        "--resume-after",
        type=int,
        default=None,
        help="Start after this incident_id (keyset cursor)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max total rows to process",
    )
    return parser.parse_args(argv)


# ── Core migration logic ─────────────────────────────────────────────────────


def run(
    db,
    legacy_sp: SecurityProvider,
    kms_sp: KmsSecurityProvider,
    args: argparse.Namespace,
) -> dict[str, int]:
    """Execute the migration and return stats dict.

    Parameters
    ----------
    db
        SQLAlchemy session (usually an admin session from _AdminSessionLocal).
    legacy_sp : SecurityProvider
        env_aesgcm provider for decrypting legacy blobs.
    kms_sp : KmsSecurityProvider
        OpenBao Transit provider for re-encrypting to the new scheme.
    args : argparse.Namespace
        Parsed CLI flags.

    Returns
    -------
    dict[str, int]
        Stats keys: total_scanned, migrated, already_openbao, skipped_no_blob,
        errors, dry_run.
    """
    stats: dict[str, int] = {
        "total_scanned": 0,
        "migrated": 0,
        "already_openbao": 0,
        "skipped_no_blob": 0,
        "errors": 0,
        "dry_run": 1 if args.dry_run else 0,
    }

    has_kv_col = _has_key_version_column(db)
    if has_kv_col:
        logger.info("key_version column detected — will update on migrated rows")

    # ── Build WHERE clause ────────────────────────────────────────────────
    where_parts = ["pii_blob_enc IS NOT NULL"]
    # Use COALESCE for the NULL = 'env_aesgcm' default
    where_parts.append("(crypto_provider IS NULL OR crypto_provider = 'env_aesgcm')")

    base_params: dict[str, Any] = {}

    if args.incident_id is not None:
        where_parts.append("incident_id = :incident_id")
        base_params["incident_id"] = args.incident_id

    where_sql = " AND ".join(where_parts)

    # ── Dry-run: count only ───────────────────────────────────────────────
    if args.dry_run:
        count_sql = f"SELECT COUNT(*) FROM wims.incident_sensitive_details WHERE {where_sql}"
        total = db.execute(text(count_sql), base_params).scalar()
        stats["total_scanned"] = total
        logger.info("DRY RUN: %d candidate legacy env-AES rows would be processed", total)
        return stats

    # ── Streaming / chunked migration ─────────────────────────────────────
    batch_size = max(1, args.batch_size)
    cursor = args.resume_after if args.resume_after is not None else 0
    processed_total = 0
    limit = args.limit

    while True:
        if limit is not None and processed_total >= limit:
            break

        remaining = None
        if limit is not None:
            remaining = limit - processed_total

        fetch_n = batch_size
        if remaining is not None and remaining < fetch_n:
            fetch_n = remaining

        # Build per-batch query with incident_id > cursor
        batch_where = f"{where_sql} AND incident_id > :cursor"
        batch_params: dict[str, Any] = {**base_params, "cursor": cursor, "batch_limit": fetch_n}

        rows = db.execute(
            text(
                f"SELECT incident_id, pii_blob_enc, encryption_iv, crypto_provider "
                f"FROM wims.incident_sensitive_details "
                f"WHERE {batch_where} "
                f"ORDER BY incident_id ASC "
                f"LIMIT :batch_limit"
            ),
            batch_params,
        ).fetchall()

        if not rows:
            break

        for row in rows:
            stats["total_scanned"] += 1
            incident_id: int = row.incident_id
            existing_blob: str | None = row.pii_blob_enc
            existing_iv: str | None = row.encryption_iv
            row_provider: str | None = getattr(row, "crypto_provider", None)

            # Idempotency guard — skip already-migrated rows
            if row_provider == "openbao_transit":
                stats["already_openbao"] += 1
                continue

            if not existing_blob:
                stats["skipped_no_blob"] += 1
                continue

            # ── Decrypt legacy blob ───────────────────────────────────
            try:
                aad = f"incident_id:{incident_id}".encode("utf-8")
                # legacy_sp is always SecurityProvider (env_aesgcm)
                plaintext_dict = legacy_sp.decrypt_json(existing_iv, existing_blob, aad)
            except (SecurityProviderError, OpenBaoClientError, Exception) as exc:
                logger.error(
                    "Decryption failed for incident_id=%s — skipping row. Error: %s",
                    incident_id,
                    exc,
                )
                stats["errors"] += 1
                continue

            # ── Re-encrypt with OpenBao Transit ────────────────────────
            try:
                nonce_b64, ct_b64 = kms_sp.encrypt_json(plaintext_dict, aad)
                # nonce_b64 is always the sentinel; we use NULL in DB
                _ = nonce_b64
            except (OpenBaoClientError, Exception) as exc:
                logger.error(
                    "OpenBao encrypt failed for incident_id=%s — skipping row. Error: %s",
                    incident_id,
                    exc,
                )
                stats["errors"] += 1
                continue

            # ── Update the row ────────────────────────────────────────
            set_parts = [
                "pii_blob_enc = :blob",
                "encryption_iv = NULL",
                "crypto_provider = :crypto_provider",
                "kms_key_name = :kms_key_name",
            ]
            update_params: dict[str, Any] = {
                "iid": incident_id,
                "blob": ct_b64,
                "crypto_provider": kms_sp.crypto_provider,
                "kms_key_name": kms_sp.kms_key_name,
            }

            if has_kv_col:
                set_parts.append("key_version = :key_version")
                update_params["key_version"] = kms_sp.current_version

            try:
                db.execute(
                    text(
                        f"UPDATE wims.incident_sensitive_details "
                        f"SET {', '.join(set_parts)} "
                        f"WHERE incident_id = :iid"
                    ),
                    update_params,
                )
            except Exception as exc:
                logger.error(
                    "UPDATE failed for incident_id=%s — row skipped. Error: %s",
                    incident_id,
                    exc,
                )
                stats["errors"] += 1
                continue

            stats["migrated"] += 1
            cursor = incident_id  # advance keyset cursor

        # ── Commit batch ────────────────────────────────────────────────
        try:
            db.commit()
            logger.info(
                "Batch committed — scanned=%d migrated=%d errors=%d",
                stats["total_scanned"],
                stats["migrated"],
                stats["errors"],
            )
        except Exception as exc:
            db.rollback()
            logger.error("Batch commit failed, rolling back: %s", exc)
            stats["errors"] += 1
            # Do not raise — continue with next batch if possible

        processed_total += len(rows)

    return stats


# ── Main entry point ─────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> None:
    """Entry point — validates env, creates providers, runs migration."""

    args = _parse_args(argv)

    # Validate DATABASE_URL
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("SQLALCHEMY_DATABASE_URL")
    if not db_url:
        logger.error(
            "DATABASE_URL env var is required. "
            "Set it to the PostgreSQL connection string "
            "(e.g. postgresql://postgres:pass@postgres:5432/wims)."
        )
        sys.exit(2)

    # Validate WIMS_MASTER_KEY for legacy decryption
    if not os.environ.get("WIMS_MASTER_KEY"):
        logger.error(
            "WIMS_MASTER_KEY env var is required for decrypting legacy env-AES blobs. "
            "Set it to the base64-encoded 32-byte AES-256 key."
        )
        sys.exit(2)

    # Validate OpenBao env for KMS encryption
    if not os.environ.get("OPENBAO_ADDR"):
        logger.error(
            "OPENBAO_ADDR env var is required for OpenBao Transit encryption. "
            "Set it to the OpenBao API address (e.g. http://openbao:8200)."
        )
        sys.exit(2)
    if not os.environ.get("OPENBAO_TOKEN") and not (
        os.environ.get("OPENBAO_ROLE_ID") and os.environ.get("OPENBAO_SECRET_ID")
    ):
        logger.error(
            "OpenBao auth is required — set OPENBAO_TOKEN or OPENBAO_ROLE_ID + OPENBAO_SECRET_ID."
        )
        sys.exit(2)

    # Create providers
    try:
        legacy_sp = SecurityProvider()
    except SecurityProviderError as exc:
        logger.error("Failed to initialise SecurityProvider: %s", exc)
        sys.exit(2)

    try:
        kms_sp = KmsSecurityProvider()
    except OpenBaoClientError as exc:
        logger.error("Failed to initialise KmsSecurityProvider: %s", exc)
        sys.exit(2)

    # Run migration
    db = _AdminSessionLocal()
    try:
        stats = run(db, legacy_sp, kms_sp, args)
    except Exception as exc:
        db.rollback()
        logger.exception("Migration aborted with fatal error: %s", exc)
        sys.exit(2)
    finally:
        db.close()

    # Print stats
    dry_label = " [DRY RUN — no writes]" if args.dry_run else ""
    logger.info(
        "Migration complete%s: total_scanned=%d, migrated=%d, "
        "already_openbao=%d, skipped_no_blob=%d, errors=%d",
        dry_label,
        stats["total_scanned"],
        stats["migrated"],
        stats["already_openbao"],
        stats["skipped_no_blob"],
        stats["errors"],
    )

    if stats["errors"] > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
