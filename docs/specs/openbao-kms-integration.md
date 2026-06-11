# Implementation Plan

## Goal
Implement OpenBao-backed KMS for WIMS-BFP PII and backup encryption so Module 6a.iii/iv is satisfied: keys are managed by OpenBao and key rotation occurs every 90 days with auditable automated re-encryption/rewrap behavior.

## Context and Requirements

### Authoritative FRS requirement
`system-wiki/raw/frs/frs-cryptographicsecurity.md` says:
- Module 6a.iii: "Encryption keys managed by dedicated key management service (OpenBao) (OpenBao (Docker))"
- Module 6a.iv: "Key rotation performed every 90 days (OpenBao Auto-Rotate)"

### Current state to preserve
- `src/backend/utils/crypto.py` contains `SecurityProvider`, a local AES-256-GCM provider using env vars (`WIMS_MASTER_KEY`, `WIMS_MASTER_KEY_V2`...`V100`, `WIMS_KEY_CURRENT_VERSION`).
- `src/backend/scripts/rotate_pii_keys.py` performs operator-triggered row re-encryption using `SecurityProvider` and SQLAlchemy.
- `src/backend/scripts/encrypt_backlog.py` encrypts previously plaintext incident sensitive fields.
- `src/postgres-init/53_incident_pii_key_version.sql` adds `key_version SMALLINT` to `wims.incident_sensitive_details`.
- `src/backend/utils/backup_crypto.py` still encrypts database backups with `WIMS_MASTER_KEY` directly.
- `system-wiki/security/security-baseline.md` still marks OpenBao KMS + key rotation pending under Module 6.

### Recommended design decision
Use **OpenBao Transit secrets engine** as the KMS boundary. WIMS should not fetch raw long-lived AES master keys from OpenBao. Instead, WIMS calls Transit encrypt/decrypt/rotate endpoints for OpenBao-managed keys. This better satisfies "keys managed by dedicated KMS" than storing retrieved key bytes in process memory.

For performance-sensitive row reads, implement this in phases:
1. Start with direct Transit encrypt/decrypt for new writes and dual-read legacy support.
2. Add cache/connection pooling and latency tests.
3. If Transit-per-read is too slow, evolve to envelope encryption with OpenBao-generated data keys and stored encrypted DEKs.

## Tasks

1. **Spec and dependency baseline**: Add the formal spec and Python client dependency.
   - File: `docs/specs/openbao-kms-integration.md`
   - File: `src/backend/requirements.txt`
   - Changes: Save this plan as the spec; add `hvac` or a small `httpx`-based OpenBao client dependency after choosing client approach. Prefer `httpx` if the team wants minimal dependencies and explicit API contracts.
   - Acceptance: Spec exists; dependency choice documented; `pip install -r requirements.txt` works in a clean venv.

2. **Deploy OpenBao in Docker Compose**: Add development OpenBao service and init flow.
   - File: `src/docker-compose.yml`
   - File: `src/docker-compose.ci.yml` if CI integration tests run OpenBao.
   - File: `.env.example`
   - New File: `src/openbao/config/openbao.hcl`
   - New File: `src/openbao/policies/wims-app.hcl`
   - New File: `src/openbao/init/bootstrap-openbao.sh`
   - Changes: Add `openbao` container with pinned image tag, file/Raft storage volume, `wims_internal` network only, healthcheck, no public host port by default. Add bootstrap container/script that enables Transit, creates keys, policies, and AppRole/token for backend/celery.
   - Acceptance: `cd src && docker compose up openbao openbao-bootstrap` starts OpenBao, enables `transit/`, creates keys, and backend/celery can reach `http://openbao:8200` internally.

3. **Define unsealing strategy**: Separate local-dev standalone from production HA.
   - File: `docs/specs/openbao-kms-integration.md`
   - File: `system-wiki/security/security-baseline.md` after implementation begins.
   - Changes: Document local development as standalone OpenBao with file/Raft storage and bootstrap-only dev token. Document production as HA Raft cluster or managed deployment, TLS-enabled, Shamir unseal with M-of-N shares or platform auto-unseal. Explicitly forbid committing root token/unseal keys.
   - Acceptance: Runbook names who holds unseal shares, threshold, recovery process, and how backend authenticates without root token.

4. **Create OpenBao client module**: Isolate KMS API calls behind a small adapter.
   - New File: `src/backend/services/kms/openbao_client.py`
   - New File: `src/backend/services/kms/__init__.py`
   - Changes: Implement methods: `health()`, `encrypt(key_name, plaintext_b64, context_b64=None)`, `decrypt(key_name, ciphertext, context_b64=None)`, `rotate(key_name)`, `read_key_metadata(key_name)`, `rewrap(key_name, ciphertext)`. Use AppRole/token env vars and short HTTP timeouts.
   - Acceptance: Unit tests mock OpenBao responses; no route/task imports `httpx`/`hvac` directly.

5. **Add KMS provider abstraction**: Preserve legacy env AES provider and add OpenBao Transit provider.
   - File: `src/backend/utils/crypto.py`
   - New File: `src/backend/utils/kms_crypto.py` or integrate in `utils/crypto.py` with clean classes.
   - Changes: Introduce a provider interface returning structured encrypted payloads: `ciphertext`, `key_version`, `provider`, optional `nonce`. Add `KmsSecurityProvider` using OpenBao Transit. Keep `SecurityProvider` for legacy rows and local/test fallback.
   - Acceptance: Existing `SecurityProvider` tests pass; new `KmsSecurityProvider` unit tests cover encrypt/decrypt, key version parsing, OpenBao failure mapping, timeout behavior, and legacy fallback.

6. **Update schema for provider metadata**: Avoid overloading `encryption_iv` for Transit ciphertexts.
   - New File: next migration under `src/postgres-init/` after current highest prefix.
   - Changes: Add columns to `wims.incident_sensitive_details`: `crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'`, `kms_key_name TEXT`, and optionally `encrypted_dek TEXT` if envelope encryption is chosen. Relax or replace `incident_sensitive_details_pii_blob_consistency` so OpenBao Transit rows can have `pii_blob_enc IS NOT NULL` with `encryption_iv IS NULL` when provider is `openbao_transit`.
   - Acceptance: Migration is idempotent; bootstrap DB creates table with valid constraints; legacy rows remain valid.

7. **Dual-read migration path**: Decrypt legacy env-AES rows and OpenBao rows during transition.
   - File: `src/backend/api/routes/incidents.py`
   - File: `src/backend/api/routes/regional/encoder.py`
   - File: `src/backend/api/routes/regional/encoder_crud.py`
   - File: `src/backend/api/routes/regional/field_updates.py`
   - File: `src/backend/services/afor_import/commit.py`
   - File: `src/backend/services/regional_incidents/helpers.py`
   - File: `src/backend/scripts/encrypt_backlog.py`
   - Changes: Replace direct `_get_security_provider()` usage with a factory, e.g. `get_pii_crypto_provider(row_provider=None)`. New writes use OpenBao when `WIMS_CRYPTO_PROVIDER=openbao_transit`; reads dispatch by row `crypto_provider`.
   - Acceptance: Existing env-key tests pass; new tests prove env legacy row decrypts after OpenBao mode is enabled.

8. **Implement controlled migration from env vars to OpenBao**: Convert existing v1/v2 env-key rows to OpenBao Transit rows.
   - New File: `src/backend/scripts/migrate_pii_to_openbao.py` or extend `rotate_pii_keys.py` with a provider-aware mode.
   - Changes: Script scans rows, decrypts with legacy provider according to `key_version`, encrypts with OpenBao Transit key, updates `pii_blob_enc`, `crypto_provider`, `kms_key_name`, `key_version`, and clears/updates `encryption_iv` per schema. Support `--dry-run`, `--batch-size`, `--incident-id`, `--resume-after`, and error exit status.
   - Acceptance: Dry-run writes nothing; mixed legacy/OpenBao rows are idempotent; errors isolate per row; stats are logged.

9. **Automated 90-day rotation scheduler**: Add Celery beat driven rotation orchestration.
   - File: `src/backend/celery_config.py`
   - New File: `src/backend/tasks/kms_rotation.py`
   - New Migration/File: migration creating `wims.kms_key_rotation_runs` and/or `wims.kms_key_state`.
   - Changes: Add scheduled task `tasks.kms_rotation.ensure_pii_key_rotation` daily. It checks OpenBao key metadata and local `last_rotated_at`; when due (>=90 days), calls OpenBao Transit rotate endpoint, records run state, then starts batch re-encryption/rewrap until all eligible rows are on latest version.
   - Acceptance: Unit tests prove no-op before due date, rotate when due, no duplicate active run, and failed run is recorded.

10. **Choose rotation mechanics**: Prefer rewrap when possible; otherwise decrypt/re-encrypt row payloads.
    - File: `src/backend/tasks/kms_rotation.py`
    - File: `src/backend/scripts/rotate_pii_keys.py`
    - Changes: If using direct Transit ciphertexts, use OpenBao `rewrap` endpoint to update ciphertext to latest key version without exposing plaintext to WIMS. For legacy env rows, perform decrypt-with-legacy then encrypt-with-Transit. If using envelope encryption later, rotate by rewrapping DEKs.
    - Acceptance: Rotation updates ciphertext/key version; plaintext roundtrip matches before/after; old OpenBao key versions remain decryptable until retention policy says otherwise.

11. **Integrate backup encryption with OpenBao**: Replace `WIMS_MASTER_KEY` usage in `backup_crypto.py`.
    - File: `src/backend/utils/backup_crypto.py`
    - File: `src/backend/api/routes/admin/backups.py`
    - Changes: Encrypt backup files with a distinct OpenBao Transit key, e.g. `wims-backup`. Store OpenBao ciphertext metadata in a small header or sidecar JSON: provider, key name, OpenBao ciphertext version, created_at. Preserve restore for legacy `.sql.enc` backups encrypted with `WIMS_MASTER_KEY` during transition.
    - Acceptance: New backup/restore tests cover OpenBao-backed backup encryption and legacy backup restore.

12. **Audit logging and observability**: Record every KMS lifecycle event.
    - File: `src/backend/utils/audit.py` if helper changes are needed.
    - File: `src/backend/tasks/kms_rotation.py`
    - File: `src/backend/api/routes/admin/backups.py`
    - Changes: Log `KMS_KEY_ROTATE_REQUESTED`, `KMS_KEY_ROTATED`, `KMS_REWRAP_STARTED`, `KMS_REWRAP_COMPLETED`, `KMS_REWRAP_FAILED`, `BACKUP_ENCRYPTED_WITH_KMS`, and `BACKUP_DECRYPTED_WITH_KMS`. Never log plaintext, raw keys, tokens, ciphertext, or nonce values.
    - Acceptance: Tests assert audit helper called with action types and no secret values in log messages.

13. **Rollback and failure safety**: Ensure failed rotations do not break decryptability.
    - File: `docs/specs/openbao-kms-integration.md`
    - File: `src/backend/tasks/kms_rotation.py`
    - Changes: Keep all prior OpenBao key versions enabled for decryption. Rotation runs must be resumable and idempotent. Do not disable/delete old key versions in the same release. Use transaction-per-batch and run-state rows to resume after worker crash.
    - Acceptance: Tests simulate mid-batch failure and rerun; rows already updated are skipped; old rows still decrypt.

14. **Integration test environment**: Add OpenBao container tests for CI-safe paths.
    - File: `src/docker-compose.ci.yml`
    - New File: `src/backend/tests/integration/test_openbao_kms.py`
    - New File: `src/backend/tests/integration/test_kms_rotation_task.py`
    - Changes: Provide a dev OpenBao service in CI compose or mark tests requiring OpenBao. Tests should bootstrap Transit, issue app token, run encrypt/decrypt/rotate/rewrap, and verify WIMS provider behavior.
    - Acceptance: `pytest tests/integration/test_openbao_kms.py` passes with compose OpenBao service; tests skip cleanly when OpenBao is unavailable outside integration mode.

15. **Deployment runbook and environment variables**: Document how operators deploy and rotate.
    - File: `.env.example`
    - File: `docs/specs/openbao-kms-integration.md`
    - File: `system-wiki/operations/local-dev-deploy-guide.md` after implementation.
    - Changes: Add `OPENBAO_ADDR`, `OPENBAO_TOKEN` or AppRole vars, `OPENBAO_TRANSIT_MOUNT`, `OPENBAO_PII_KEY_NAME`, `OPENBAO_BACKUP_KEY_NAME`, `WIMS_CRYPTO_PROVIDER`, rotation interval vars, timeout vars. Include runbook for first boot, unseal, policy bootstrap, migration dry-run, enabling OpenBao mode, and rollback.
    - Acceptance: A new developer can run local OpenBao-backed encryption from docs without using production secrets.

16. **System-wiki updates after implementation**: Keep agent knowledgebase current.
    - File: `system-wiki/security/security-baseline.md`
    - File: `system-wiki/gaps/frs-codebase-gap-register.md`
    - File: `system-wiki/log.md`
    - Changes: Update M6 data-at-rest section and gap register. Only close OpenBao/KMS gap after OpenBao-backed PII and backup encryption plus automated 90-day rotation are implemented and tested. Leave attachment encryption (#151) open unless separately completed.
    - Acceptance: Wiki states exact implemented behavior and remaining gaps.

## OpenBao Deployment Spec

### Local development
- Add one `openbao` service on `wims_internal` only.
- Use pinned image, e.g. `openbao/openbao:<pinned-version>` after confirming current stable tag.
- Store dev data in a named Docker volume, e.g. `openbao_data`.
- Expose `127.0.0.1:8200:8200` only if local debugging requires it; otherwise keep internal-only.
- Bootstrap script enables Transit at `transit/`, creates keys:
  - `wims-incident-pii`
  - `wims-backup`
- Bootstrap creates a least-privilege policy allowing backend/celery to encrypt/decrypt/rewrap with those keys and allowing rotation only to the celery rotation task identity if token separation is implemented.

### Production
- Use HA OpenBao with integrated Raft or external storage, TLS enabled, and no public exposure.
- Backend/celery access only over Docker/VPC private network.
- Use AppRole, Kubernetes/Docker secret injection, or another machine-auth method; do not use root tokens for WIMS.
- Unseal choices:
  - Preferred production: platform auto-unseal if a trusted external KMS/HSM exists.
  - Acceptable manual: Shamir unseal with M-of-N shares, e.g. 3-of-5; shares held by named security/data owners.
- Root token and unseal shares must never be committed, logged, mounted into app containers, or stored in `.env` files committed to git.

## Key Lifecycle Spec

1. **Creation**: Bootstrap creates `wims-incident-pii` and `wims-backup` Transit keys.
2. **Current version**: OpenBao metadata is source of truth for latest key version.
3. **New writes**: WIMS encrypts new incident PII and backup files using latest OpenBao Transit key.
4. **Rotation due check**: Daily Celery beat checks if latest rotation is >=90 days old.
5. **Rotate key**: Task calls OpenBao Transit rotate endpoint for `wims-incident-pii` and `wims-backup` when due.
6. **Rewrap/re-encrypt existing data**:
   - OpenBao Transit rows: rewrap ciphertext to latest key version.
   - Legacy env AES rows: decrypt with env provider, encrypt with OpenBao Transit provider.
7. **Retention**: Old OpenBao key versions remain enabled for decrypt until all rows/backups are migrated and retention policy explicitly permits retiring old versions.
8. **Audit**: Every lifecycle event is audit-logged with counts and run IDs, not secrets.

## WIMS ↔ OpenBao API Contract

### Environment
- `WIMS_CRYPTO_PROVIDER=openbao_transit|env_aesgcm`
- `OPENBAO_ADDR=http://openbao:8200`
- `OPENBAO_TOKEN` for dev only, or AppRole vars for production:
  - `OPENBAO_ROLE_ID`
  - `OPENBAO_SECRET_ID_FILE` or injected secret
- `OPENBAO_TRANSIT_MOUNT=transit`
- `OPENBAO_PII_KEY_NAME=wims-incident-pii`
- `OPENBAO_BACKUP_KEY_NAME=wims-backup`
- `OPENBAO_TIMEOUT_SECONDS=2.0`
- `OPENBAO_ROTATION_INTERVAL_DAYS=90`

### Client methods
- `health() -> KmsHealth`
- `encrypt(key_name, plaintext: bytes, context: bytes | None) -> KmsCiphertext`
- `decrypt(key_name, ciphertext: str, context: bytes | None) -> bytes`
- `rotate(key_name) -> KeyMetadata`
- `rewrap(key_name, ciphertext: str, context: bytes | None) -> KmsCiphertext`
- `metadata(key_name) -> KeyMetadata`

### Provider output
- `ciphertext`: OpenBao Transit ciphertext string or legacy base64 ciphertext.
- `key_version`: parsed OpenBao Transit version or legacy env version.
- `crypto_provider`: `openbao_transit` or `env_aesgcm`.
- `kms_key_name`: OpenBao key name for KMS rows.
- `nonce`: only required for legacy env AES rows.

## Migration Path

1. Ship OpenBao service and client behind disabled flag (`WIMS_CRYPTO_PROVIDER=env_aesgcm`).
2. Bootstrap OpenBao in dev and staging; verify health endpoint and client tests.
3. Enable dual-read while keeping env AES for new writes.
4. Enable OpenBao for new writes in staging.
5. Run migration dry-run from env AES rows to OpenBao Transit rows.
6. Run migration in batches with audit and run-state tracking.
7. Enable OpenBao for production new writes.
8. Complete migration of existing production rows.
9. Keep legacy env keys available until all rows/backups prove migrated.
10. Remove env-key write path only after one full release cycle and successful restore drills.

## Automated Rotation Design

Use Celery beat rather than relying on an unspecified OpenBao-native scheduler unless the deployed OpenBao version is verified to support native auto-rotation. Celery beat is already used in `src/backend/celery_config.py` for periodic operational tasks, making it a natural fit.

- Daily task: `tasks.kms_rotation.ensure_pii_key_rotation`
- Steps:
  1. Acquire DB advisory lock or check `kms_key_rotation_runs` for active run.
  2. Read OpenBao key metadata and local last-success timestamp.
  3. If not due, exit.
  4. Call OpenBao rotate for PII and backup keys.
  5. Process rows in bounded batches.
  6. Commit per batch and update run counters.
  7. Mark run success/failure and audit-log result.
- Failure behavior:
  - Failed run does not disable old keys.
  - Subsequent task resumes by selecting rows with old `key_version`/provider.
  - Operators can run a manual resume command using the same code path.

## `backup_crypto.py` Integration

`src/backend/utils/backup_crypto.py` currently loads `WIMS_MASTER_KEY` directly. Under #152 it should use OpenBao Transit with a separate `wims-backup` key.

Recommended encrypted backup format:

```text
WIMSBAO1\n
{"provider":"openbao_transit","key_name":"wims-backup","created_at":"...","ciphertext_version":N}\n
<OpenBao Transit ciphertext or encrypted payload bytes>
```

Acceptance requirements:
- New backups encrypt through OpenBao.
- Restore supports both OpenBao-backed backup files and legacy `WIMS_MASTER_KEY` `.sql.enc` files during transition.
- Backup key rotation is included in the same 90-day lifecycle or a separately documented backup-key lifecycle.
- Backup encryption/decryption failures never log backup plaintext or key material.

## Rollback Safety

- OpenBao old key versions must remain decryptable after rotation.
- Migration scripts must be idempotent and resumable.
- Batch updates must commit in small transactions.
- Rotation run state must record counts: scanned, rewrapped, migrated, skipped, failed.
- Rollback from OpenBao mode to env mode is only supported for legacy rows not yet migrated; once a row is OpenBao-encrypted, rollback requires OpenBao availability unless a controlled export/re-encrypt procedure is implemented.
- Do not delete or retire old OpenBao versions in the same release that rotates them.

## Test Strategy

### Unit tests
- `tests/test_openbao_client.py`: mock OpenBao HTTP success/failure/timeouts.
- `tests/test_kms_crypto.py`: provider encrypt/decrypt, context/AAD mismatch, key version parsing, legacy fallback.
- `tests/test_kms_rotation_task.py`: due-date logic, advisory lock/no duplicate active run, success/failure audit, batch resume.
- Existing `tests/test_crypto.py` remains for env AES legacy provider.

### Integration tests
- `tests/integration/test_openbao_kms.py`: run against dev OpenBao container; enable Transit; encrypt/decrypt/rotate/rewrap.
- `tests/integration/test_pii_openbao_migration.py`: seed legacy env row, migrate to OpenBao, verify API read contract unchanged.
- `tests/integration/test_backup_openbao.py`: backup encrypt/restore through OpenBao and legacy fallback restore.

### CI strategy
- Keep unit tests in default pytest path.
- Mark OpenBao integration tests with `@pytest.mark.integration` and skip when `OPENBAO_ADDR` is not available.
- Add CI compose service only when acceptable for runtime; otherwise document manual integration gate.

## Implementation Phases

1. **Phase 0 — Spec and runbook**: Add docs/spec and issue acceptance criteria.
2. **Phase 1 — OpenBao dev deployment**: Docker service, bootstrap, policies, healthcheck.
3. **Phase 2 — Client and provider abstraction**: OpenBao client and `KmsSecurityProvider` behind feature flag.
4. **Phase 3 — Schema metadata and dual-read**: Provider metadata columns and read dispatch.
5. **Phase 4 — New writes via OpenBao**: Enable OpenBao for new incident PII in staging, then production.
6. **Phase 5 — Migration tooling**: Provider-aware migration of legacy env rows to OpenBao.
7. **Phase 6 — Automated 90-day rotation**: Celery beat rotation and rewrap/resume logic.
8. **Phase 7 — Backup encryption**: `backup_crypto.py` OpenBao integration and restore compatibility.
9. **Phase 8 — Hardening**: HA/unseal runbook, audit verification, latency/load tests, restore drill.
10. **Phase 9 — Gap closure**: Update system-wiki gap register only after OpenBao-backed PII/backup keys and automated 90-day rotation are verified.

## Files to Modify

- `src/docker-compose.yml` - add OpenBao service and dependency wiring.
- `src/docker-compose.ci.yml` - optional OpenBao integration-test service.
- `.env.example` - document OpenBao/KMS env vars and remove production reliance on raw `WIMS_MASTER_KEY` for new deployments.
- `src/backend/requirements.txt` - add OpenBao client dependency if needed.
- `src/backend/utils/crypto.py` - introduce provider abstraction or legacy provider naming.
- `src/backend/utils/backup_crypto.py` - use OpenBao Transit for backup encryption/decryption while preserving legacy restore.
- `src/backend/api/routes/incidents.py` - route writes through provider factory.
- `src/backend/api/routes/regional/encoder.py` - decrypt by row provider metadata.
- `src/backend/api/routes/regional/encoder_crud.py` - write OpenBao metadata for new rows.
- `src/backend/api/routes/regional/field_updates.py` - decrypt/re-encrypt by provider metadata.
- `src/backend/services/afor_import/commit.py` - write OpenBao metadata for AFOR import rows.
- `src/backend/services/regional_incidents/helpers.py` - provider-aware decrypt/re-encrypt.
- `src/backend/scripts/encrypt_backlog.py` - provider-aware backlog encryption.
- `src/backend/scripts/rotate_pii_keys.py` - evolve into provider-aware rotation/rewrap or call shared rotation service.
- `src/backend/celery_config.py` - add daily KMS rotation beat task.
- `src/backend/api/routes/admin/backups.py` - audit backup OpenBao crypto behavior.
- `system-wiki/security/security-baseline.md` - update after implementation.
- `system-wiki/gaps/frs-codebase-gap-register.md` - update gap status after verified implementation.
- `system-wiki/log.md` - append implementation log entries.

## New Files

- `docs/specs/openbao-kms-integration.md` - canonical implementation spec and runbook.
- `src/openbao/config/openbao.hcl` - OpenBao server config for local/dev.
- `src/openbao/policies/wims-app.hcl` - least-privilege WIMS app policy.
- `src/openbao/init/bootstrap-openbao.sh` - dev bootstrap for Transit, keys, and policy.
- `src/backend/services/kms/__init__.py` - KMS service package.
- `src/backend/services/kms/openbao_client.py` - OpenBao API adapter.
- `src/backend/utils/kms_crypto.py` - optional OpenBao provider implementation if not kept in `crypto.py`.
- `src/backend/tasks/kms_rotation.py` - Celery rotation and rewrap/resume orchestration.
- `src/backend/scripts/migrate_pii_to_openbao.py` - explicit legacy-to-OpenBao migration script if not merged into `rotate_pii_keys.py`.
- `src/postgres-init/<next>_kms_key_rotation.sql` - rotation run-state and provider metadata migration.
- `src/backend/tests/test_openbao_client.py` - unit tests for client.
- `src/backend/tests/test_kms_crypto.py` - unit tests for provider abstraction.
- `src/backend/tests/test_kms_rotation_task.py` - unit tests for scheduler/orchestrator.
- `src/backend/tests/integration/test_openbao_kms.py` - live OpenBao integration test.
- `src/backend/tests/integration/test_pii_openbao_migration.py` - migration/read compatibility integration test.
- `src/backend/tests/integration/test_backup_openbao.py` - backup OpenBao integration tests.

## Dependencies

- Task 1 precedes all implementation tasks.
- Task 2 and Task 3 must complete before OpenBao client integration can be validated end-to-end.
- Task 4 must complete before Tasks 5, 7, 8, 9, and 11.
- Task 6 must precede provider-aware row writes in Task 7.
- Task 7 must precede migration and automated rotation.
- Task 8 must precede production rollout of OpenBao-only mode.
- Task 9 depends on OpenBao client, schema metadata, and migration/rewrap logic.
- Task 11 depends on OpenBao client and backup-format decision.
- Task 16 is last and should only close #152 after tests and runbooks are complete.

## Risks

- **OpenBao native auto-rotation ambiguity:** Verify whether the selected OpenBao version supports native scheduled auto-rotation. If not, Celery beat is the scheduling layer while OpenBao remains key authority.
- **Latency/regression risk:** Direct Transit decrypt on every incident read may add latency or make incident reads dependent on OpenBao availability. Mitigate with timeout, metrics, HA, and consider envelope encryption if needed.
- **Availability risk:** If OpenBao is down, OpenBao-encrypted rows cannot decrypt. Decide whether reads fail closed or return redacted data with operator alert.
- **Unseal risk:** Poor unseal-key handling can compromise all encrypted data. Production unseal/runbook needs explicit owner sign-off.
- **Migration risk:** Existing env-encrypted rows and legacy backups require dual-read/restore until migration completes and restore drills pass.
- **Rollback risk:** After rows migrate to OpenBao, rollback to env-only deployment is not safe without OpenBao or a re-export/re-encrypt process.
- **Schema compatibility risk:** Current `incident_sensitive_details_pii_blob_consistency` requires `pii_blob_enc` and `encryption_iv` together. OpenBao Transit storage needs either schema relaxation or a clearly documented metadata storage pattern.
- **Secret sprawl risk:** Do not add root tokens, unseal keys, or real AppRole secrets to `.env.example`, compose files, logs, tests, or wiki.
- **FRS gap closure risk:** #152 should not be marked CLOSED until PII keys, backup keys, automated 90-day rotation, tests, and operational runbook are all implemented. Attachment encryption (#151) remains separate unless completed.

## Acceptance Criteria for Issue #152

- OpenBao runs in Docker for local/dev with Transit enabled and least-privilege WIMS policy.
- WIMS can encrypt/decrypt incident PII through OpenBao Transit for new rows.
- Legacy env-var encrypted rows remain decryptable during transition.
- Existing rows can be migrated or rewrapped in bounded, resumable batches.
- A daily Celery task enforces 90-day rotation and records auditable run state.
- `backup_crypto.py` encrypts new backups through OpenBao and can restore legacy backups.
- Rotation failure preserves decryptability through old key versions and produces actionable audit/log records.
- Integration tests validate OpenBao encrypt/decrypt/rotate/rewrap against a dev OpenBao container.
- `system-wiki/security/security-baseline.md`, `system-wiki/gaps/frs-codebase-gap-register.md`, and `system-wiki/log.md` are updated after implementation.
