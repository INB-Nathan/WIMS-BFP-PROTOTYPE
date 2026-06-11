"""
rotate_pii_keys.py — Re-encrypt PII blobs from any old key version to the current key version.

Usage:
    python scripts/rotate_pii_keys.py [--dry-run] [--target-version N] [--batch-size N]

Safety rules:
    - Reads each row's stored key_version to pick the correct decryption key.
    - Re-encrypts with WIMS_KEY_CURRENT_VERSION (or --target-version override).
    - Skips rows already at the target version.
    - Per-row try/except: a single decryption failure skips that row and continues.
    - --dry-run prints what would change without touching the database.
    - No data is written until db.commit() — a crash mid-run leaves the DB consistent.
"""

import argparse
import logging
import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.crypto import SecurityProvider, SecurityProviderError

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Re-encrypt PII blobs to the current key version.")
    p.add_argument(
        "--target-version",
        type=int,
        default=None,
        help="Key version to rotate TO. Defaults to WIMS_KEY_CURRENT_VERSION env var.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without writing to the database.",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows to process per transaction (default 500).",
    )
    return p.parse_args()


def rotate(dry_run: bool, target_version: int | None, batch_size: int) -> dict:
    sp = SecurityProvider()
    effective_target = target_version if target_version is not None else sp.current_version

    if effective_target not in sp._keyring:  # noqa: SLF001
        raise SystemExit(
            f"Target version {effective_target} is not loaded — "
            f"set WIMS_MASTER_KEY_V{effective_target} in env."
        )

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL env var is required.")

    engine = create_engine(database_url)
    stats = {"total": 0, "rotated": 0, "already_current": 0, "errors": 0, "dry_run": dry_run}

    with Session(engine) as db:
        result = db.execute(
            text("""
                SELECT incident_id, pii_blob_enc, encryption_iv, key_version
                FROM wims.incident_sensitive_details
                WHERE pii_blob_enc IS NOT NULL
            """)
        )

        logger.info(
            "Starting rotation scan. Target version: %d (batch_size=%d).",
            effective_target,
            batch_size,
        )

        pending: list[dict] = []

        for row in result.yield_per(batch_size):
            stats["total"] += 1
            incident_id = row.incident_id
            stored_version = row.key_version or 1

            if stored_version == effective_target:
                stats["already_current"] += 1
                continue

            aad = f"incident_id:{incident_id}".encode("utf-8")

            try:
                pii = sp.decrypt_json(
                    row.encryption_iv, row.pii_blob_enc, aad, key_version=stored_version
                )
            except SecurityProviderError:
                logger.error(
                    "Decryption failed for incident_id=%s (stored key_version=%d) — skipping.",
                    incident_id,
                    stored_version,
                )
                stats["errors"] += 1
                continue

            # Re-encrypt with target key, restoring _current_version on failure
            original_version = sp._current_version  # noqa: SLF001
            try:
                sp._current_version = effective_target  # noqa: SLF001
                nonce_b64, ct_b64 = sp.encrypt_json(pii, aad)
            except SecurityProviderError:
                logger.error("Re-encryption failed for incident_id=%s — skipping.", incident_id)
                stats["errors"] += 1
                continue
            finally:
                sp._current_version = original_version  # noqa: SLF001

            if dry_run:
                logger.info(
                    "[DRY RUN] Would rotate incident_id=%s from key_version=%d to %d.",
                    incident_id,
                    stored_version,
                    effective_target,
                )
                stats["rotated"] += 1
                continue

            pending.append(
                {
                    "iid": incident_id,
                    "blob": ct_b64,
                    "nonce": nonce_b64,
                    "key_ver": effective_target,
                }
            )
            stats["rotated"] += 1

            if len(pending) >= batch_size:
                _flush(db, pending)
                pending.clear()

        if not dry_run and pending:
            _flush(db, pending)

        if not dry_run:
            db.commit()

    return stats


def _flush(db: Session, pending: list[dict]) -> None:
    for p in pending:
        db.execute(
            text("""
                UPDATE wims.incident_sensitive_details
                SET pii_blob_enc = :blob,
                    encryption_iv = :nonce,
                    key_version   = :key_ver
                WHERE incident_id = :iid
            """),
            p,
        )
    logger.info("Flushed %d rows.", len(pending))


def main() -> None:
    args = _parse_args()
    stats = rotate(
        dry_run=args.dry_run, target_version=args.target_version, batch_size=args.batch_size
    )

    label = "[DRY RUN] " if stats["dry_run"] else ""
    logger.info(
        "%sRotation complete: total=%d, rotated=%d, already_current=%d, errors=%d",
        label,
        stats["total"],
        stats["rotated"],
        stats["already_current"],
        stats["errors"],
    )
    if stats["errors"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
