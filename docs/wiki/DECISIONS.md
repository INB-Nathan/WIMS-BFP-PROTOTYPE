# Architectural Decisions Log

## ADR-001: Migration naming is lexicographic, not semantic
Files execute in lexicographic order. Currently 00-31 exist. Next is 32_.
Never rename existing files. Never use 002_ style prefixes.

## ADR-002: PII is always AES-256-GCM, never plaintext
Enforced via utils/crypto.py. pii_blob_enc column holds ciphertext.
Plaintext PII columns are always NULL for new writes.
Fail-closed read path: decryption failure logs CRITICAL and falls back to legacy columns.

## ADR-003: RLS requires SET LOCAL before every DB write
get_db_with_rls() sets wims.current_user_id GUC.
get_current_wims_user() must be listed BEFORE get_db_with_rls() in route deps.

## ADR-004: Validator actions are transactional with audit history
fire_incidents UPDATE and incident_verification_history INSERT are in the same transaction.
Rollback on either failure leaves no partial state.

## ADR-005: VERIFIED incidents are immutable at DB level
PostgreSQL RULEs in 17_immutable_records.sql block UPDATE/DELETE on VERIFIED rows.
Application-level 403 is a second layer, not the primary enforcement.

## ADR-006: Role strings were normalized in migration 15_validator_workflow.sql
VALIDATOR → NATIONAL_VALIDATOR. Do not revert.

## ADR-007: regional.py is 125KB — always Grep before reading
Use grep/search to find specific functions. Never read the whole file.

## ADR-008: Status terminology — use PENDING not PENDING_REVIEW
The DB CHECK constraint on fire_incidents.verification_status allows:
DRAFT, PENDING, PENDING_VALIDATION, VERIFIED, REJECTED

PENDING_REVIEW was used in early documentation but never implemented in code or DB.
PENDING_VALIDATION is written only by public_dmz.py for civilian-submitted reports.
All new code must write PENDING (not PENDING_REVIEW, not PENDING_VALIDATION) for encoder submits.

## ADR-009: verify_incident() must call sync_incident_to_analytics after commit
Bug #84: verify_incident() in regional.py commits the VERIFIED transition but never syncs to analytics_incident_facts.
The correct pattern is in triage.py promote_report() — call sync_incident_to_analytics(db, incident_id) then db.commit() after the status update commit.
Every new endpoint that changes verification_status to VERIFIED must include this call.

## ADR-010: Migration file count is now 31 (not 17)
As of 2026-05-16, src/postgres-init/ contains files 00-31 (31 SQL files total).
Nathan's system-wiki/database/sql-init-files.md is the authoritative schema reference.
Next migration prefix: check ls src/postgres-init/ | sort | tail -1 before writing any new migration.

## ADR-011: Backup encryption uses AES-256-GCM via backup_crypto.py
Backup files stored as .sql.enc (not .sql).
encrypt_backup() and decrypt_backup() in utils/backup_crypto.py.
Key from WIMS_MASTER_KEY env var (same key as PII encryption).
Trigger timeout: 120s hard limit on pg_dump subprocess.

## ADR-012: SessionManager revocation uses timestamp comparison
Redis revocation key: revoked_user:{keycloak_id}
Tokens rejected if issued_at (iat) < revocation_timestamp stored in Redis.
TTL: 12 hours. Pattern in utils/session.py SessionManager class.

## ADR-013: Duplicate detection thresholds
Spatial: ST_DWithin 1km radius
Text: ≥3 fields matched (fuzzy via duplicate_detection.py)
AFOR import uses multi-phase commit: DUPLICATE_CHECK_REQUIRED state before final commit.
