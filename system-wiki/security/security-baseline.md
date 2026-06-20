---
title: Security Baseline
created: 2026-05-14
updated: 2026-06-20
type: security
tags: [wims-bfp, security, auth, rbac, rls, audit-log, ids, xai, privacy, fail-closed]
sources: [raw/frs/frs-auth.md, raw/frs/frs-complianceanddataprivacy.md, raw/frs/frs-intrusiondetectionandnetworkingmonitoring.md, raw/frs/frs-threatdetectionwithexplainableai.md, raw/codebase/codebase-snapshot-2026-05-14.md, src/keycloak/demo-otp-provider, src/keycloak/bfp-realm.json, src/keycloak/import/bfp-realm.json]
status: draft
---

# Security Baseline

## Auth and RBAC
FRS Module 1 defines Keycloak-backed authentication, MFA for privileged roles, session timeout, password policy, and role-based access control. Relevant implementation surfaces: `admin.py`, `sessions.py`, `user.py`, frontend auth API routes, and Keycloak config.

Development Keycloak realm config in `src/keycloak/bfp-realm.json` enables the built-in `reset credentials` flow, `resetPasswordAllowed`, and MailHog SMTP defaults (`mailhog:1025`, `noreply@wims-bfp.local`) for local forgot-password testing. `src/docker-compose.yml` includes a MailHog service exposing SMTP on `1025` and the web/API UI on `8025`.

Temporary demo MFA shortcut (2026-06-11): browser OTP login uses `wims-demo-otp-form`, a custom Keycloak provider in `src/keycloak/demo-otp-provider` that accepts normal OTP codes and also accepts fixed code `123123` for accounts that reach the OTP step. This is presentation-only, logs `wims_demo_otp_bypass=true` on the Keycloak event, does not alter Direct Grant OTP, and must be removed before PR using `docs/agents/remove-demo-otp-bypass.md`.

### SKIP_MFA Role (2026-06-14)
A deliberate per-user MFA exemption via the `SKIP_MFA` realm role (`bfp-realm.json` → `roles.realm[]`). Users assigned this role bypass only the OTP sub-flow during browser login; all other accounts must still complete MFA.

**How it works:**
- Realm role `SKIP_MFA` with description "Exempts user from TOTP/OTP multi-factor authentication requirements".
- Authenticator config `otp-skip-mfa` checks `condUserRole=SKIP_MFA` (negate=false) using the `conditional-user-role` authenticator.
- In the `forms` authentication flow, the `conditional-user-role` step runs as an ALTERNATIVE at priority 20, before the existing `Browser - Conditional OTP` sub-flow (now ALTERNATIVE at priority 30).
- If the user has `SKIP_MFA`, the conditional-user-role check succeeds and the ALTERNATIVE chain is satisfied → OTP sub-flow never executes.
- If the user does NOT have `SKIP_MFA`, the conditional-user-role check is silently skipped and execution proceeds to `Browser - Conditional OTP` as before.
- The Direct Grant flow is unchanged — this exemption applies only to browser login.

**Seeded users with SKIP_MFA:** `validator_test`, `n-val`, `g-val`, `e-val`, `r-val` (all NATIONAL_VALIDATOR accounts).

**Config files:** `src/keycloak/import/bfp-realm.json` (source of truth) and `src/keycloak/bfp-realm.json` (sync copy) — both updated.

Self-service profile email edits (`PATCH /api/user/me`) treat email as a login identity: direct email changes via this endpoint are now blocked (400) with guidance redirecting users to the dedicated two-step verification flow (`POST /api/auth/change-email` → `POST /api/auth/verify-email`). Name/contact-only profile updates remain JWT-authenticated.

**Email verification flow (2026-06-17, #225):** Users initiate an email change via `POST /api/auth/change-email` (password verified against Keycloak's Direct Grant with optional TOTP support), a 6-digit cryptographically-random code is stored in Redis with 10-minute TTL, and a verification email is sent. The user then confirms via `POST /api/auth/verify-email`. On success the email is updated in both Keycloak and `wims.users`. Both endpoints have per-user Redis-based rate limiting (3 requests/10 min for change-email, 5 requests/10 min for verify-email) to deter brute-force and email bombing. Keycloak remains configured with `verifyEmail: false` in the development realm (the custom flow replaces built-in verification).

## Fail-Closed Rule
Any missing authentication context defaults to deny. Public unauthenticated behavior is limited to explicit public routes; all adjacent APIs should require valid role context.

### Public Abuse Controls (2026-06-20, PR #428)
Implements D18 (Public abuse controls), D5 (Public audit logging), and D6 (Redis fail-open policy) for all Tier-0 public/no-auth endpoints:

- **Redis sliding-window throttles** (fail-closed per D6): All public write endpoints rate-limited per-IP via atomic Lua-script ZSET with Retry-After header. Consent (5/IP/hr), public DMZ (3/IP/hr), notification registration (5/IP/hr). Redis down → 503 (not allow-through).
- **Neutral 404 responses**: All public /{id} GET/POST/PATCH endpoints return identical "Not found" for missing vs. wrong-owner to prevent report existence leakage.
- **Notification spam limits**: Max 10 FCM tokens per report; 5 registrations per IP per hour.
- **Privacy-preserving audit logging**: `log_public_audit()` stores IP hash (SHA-256 + rotating salt, 24h rotation) and user-agent hash (truncated SHA-256) in `wims.system_audit_trails`. Never logs plaintext IP, request body, or PII.
- Shared helpers in `utils/public_abuse.py`: `rate_limit_public()`, `neutral_404()`, `log_public_audit()`.

## RLS and Data Privacy
FRS Module 10 requires minimization, purpose limitation, rectification/erasure handling, breach notification, DPIA, and RoPA. Database enforcement must be verified in `src/postgres-init/09_rls_helpers.sql`, `10_rls_policies.sql`, and route dependencies.

## Audit and Immutability
FRS Module 4 requires SHA-256 data hashes, append-only audit logs, and immutable commit records. Verification/correction workflow remains a high-risk area; see [[gaps/frs-codebase-gap-register]].

- `17_immutable_records.sql` now includes `no_delete_audit` and `no_update_audit` RULEs on `wims.system_audit_trails` (GH #240) — DELETE and UPDATE silently no-op at DB level for full audit trail immutability. (Future migrations that need to UPDATE/DELETE rows must temporarily drop these rules.)
- `wims.system_audit_trails` now has `old_values` and `new_values` JSONB columns (GH #242, migration `60_audit_forensics_columns.sql`) for forensic completeness per ASVS V7.3.1.
- `log_system_audit()` accepts optional `old_values`/`new_values` params; UPDATE call sites in `users.py` and `config.py` populate them. Non-JSON-serializable types (UUID, datetime, Decimal) are safely coerced via `default=str`.

## IDS/XAI
FRS Modules 7 and 8 define Suricata network monitoring and Qwen2.5-3B explainability. Relevant code/config: `src/suricata/`, admin security-log routes, and AI service paths. Real-time security event push via SSE (`GET /api/events/stream`) notifies SYSTEM_ADMIN clients of threat detection, AI analysis completion, and HITL confirmations.

### Network Topology (M7a)

Suricata runs with `network_mode: "host"` — directly attached to the host's network stack.
This allows it to sniff all ingress traffic arriving at the VPS public IP through nginx
(ports 80/443). Port 80 yields cleartext HTTP (requests, auth attempts, file uploads);
port 443 yields only TLS handshake metadata (SNI, cipher suite) since nginx terminates TLS internally.
Previously Suricata was limited to the `wims_internal` Docker bridge (inter-container
traffic and mDNS); sniffing only `eth0` does not include Docker-bridge traffic
(e.g., backend ↔ Postgres). Host network mode requires `cap_add: [NET_ADMIN, NET_RAW]` for
promiscuous capture. AF_PACKET zero-copy capture (`--af-packet=${SURICATA_INTERFACE:-eth0}`) with workers runmode
replaces the previous pcap mode for higher throughput and lower CPU overhead.

**Note:** Host network mode only functions on Linux (VPS). Docker Desktop on Windows/Mac
does not expose host traffic to containers in host network mode.

### Suricata Detection Rules (M7b)

All rules combined in `src/suricata/rules/suricata.rules` (~136k lines). Loaded via the base image's
default `rule-files` configuration — no custom suricata.yaml override needed.

| Tier | Source | SID Range | Lines | Update Cadence |
|---|---|---|---|---|
| 1 | ET Open (full ruleset) | 2000000+ | ~68k | Weekly via suricata-update (Sun 03:00 UTC) |
| 2 | OWASP Top 10 | 1000001–1000010 | 10 | Manual, committed to repo |
| 3 | BFP-specific | 1000020–1000024 | 5 | Manual, committed to repo |

Weekly update: Celery beat task `update-suricata-rules-weekly` (Sunday 03:00 UTC) executes
`suricata-update` inside the Suricata container via Docker SDK, sends `kill -USR2` for
live rule reload. Rules before/after counts logged and compared for regressions.
Docker socket mounted in celery-worker for container exec access.

## Real-Time Notifications (SSE)
FRS Module 13 defines a notification system. The SSE event stream (`GET /api/events/stream`) provides real-time push via Redis pub/sub. Channels: `incident` (status changes/corrections), `verification` (triage cluster workflow), `security` (threat/HITL events), `system` (maintenance). Role-based channel authorization enforced at connect time. Publishers injected at: `verify_incident`, `update_incident`, `correct_verified_incident`, `claim_cluster_command`, `apply_terminal_action_command`, `ingest_eve_file` (Suricata), `analyze_threat_log` (AI), and `update_security_log` (HITL). Frontend consumer hook: `useEventStream.ts`. Nginx configured with `proxy_buffering off` for the SSE location block.

## Transport Security (TLS)
FRS Module 6 requires TLS 1.3-only for all network communication. **Enforced 2026-05-30:** `src/nginx/nginx.conf` restricts `ssl_protocols` to `TLSv1.3`, dropping TLS 1.2 support. **Cipher suite hardened 2026-05-30 (GH #154):** AES-128-GCM ciphers removed. TLS 1.2 cipher list restricted to AES-256-GCM + ChaCha20-Poly1305 only (`ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305`). TLS 1.3 ciphersuites restricted to `TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256` via `ssl_conf_command`. ChaCha20-Poly1305 provides efficient encryption on mobile devices without AES-NI hardware acceleration.

## Data-at-Rest Encryption
FRS Module 6 requires AES-256-GCM encryption for sensitive incident fields. **Expanded 2026-05-30 (GH #150):** The `SecurityProvider` (AES-256-GCM, AAD-bound per `incident_id:N`) now encrypts:
- PII fields: `caller_name`, `caller_number`, `owner_name`, `occupant_name`
- Narrative: `narrative_report` (plaintext column now NULL; decrypted on read)
- Casualties: `casualty_details` (plaintext JSONB column now NULL; decrypted on read)
- Property damage: `estimated_damage_php` (also stored in encrypted blob; plaintext column retained for backward compatibility)

All write paths updated: `services/afor_import/commit.py` (AFOR commit), `api/routes/regional.py` (manual create/edit), `api/routes/incidents.py` (`upload_incident_bundle`). Read path in `api/routes/regional.py` decrypts blob and injects fields into API responses.

**Remaining GH #150 gaps:** `wims.incident_attachments` filesystem storage unencrypted (GH #151). OpenBao KMS + key rotation partially implemented — Phase 3 done (GH #152).

## OpenBao KMS Provider Metadata (GH #152 Phase 3)

**Implemented 2026-06-11:** Provider metadata schema and dual-read dispatch for multi-KMS support.

- **Migration** `54_openbao_provider_metadata.sql` adds `crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'` and `kms_key_name TEXT` to `wims.incident_sensitive_details`. The PII blob consistency constraint is relaxed: OpenBao Transit rows allow `pii_blob_enc IS NOT NULL` with `encryption_iv IS NULL`.
- **Provider dispatch:** `services/kms/__init__.py` exports `get_crypto_provider(row=None)`. Row `crypto_provider` wins over `WIMS_CRYPTO_PROVIDER` env var (defaults `env_aesgcm`). Unknown providers raise a clear error.
- **KmsSecurityProvider:** `services/kms/openbao_client.py` provides a `SecurityProvider`-compatible wrapper around `OpenBaoClient`. `encrypt_json` returns sentinel nonce `"OPENBAO_TRANSIT"` + Transit ciphertext; `decrypt_json` ignores nonce. Key name from `OPENBAO_PII_KEY_NAME` > `OPENBAO_TRANSIT_KEY_NAME` > `wims-incident-pii`.
- **Write paths:** All 5 write paths (`incidents.py` bundle, `encoder_crud.py` create, `field_updates.py`/`helpers.py` re-encrypt, `commit.py` AFOR) now store `crypto_provider` and `kms_key_name` on INSERT/UPDATE. For `env_aesgcm` rows, `encryption_iv` contains the real nonce; for `openbao_transit` rows, `encryption_iv` is NULL.
- **Read paths:** `encoder.py` detail view, `field_updates.py` conflict fetch, `helpers.py` field update, and `encrypt_backlog.py` all dispatch `decrypt_json` by row `crypto_provider`. Legacy rows default to `env_aesgcm` — no migration needed.
- **Tests:** 45 unit tests pass (17 crypto + 9 openbao client + 19 provider dispatch), 3 skipped (requires live OpenBao).
- **Remaining (Phase 6-7):** rewrap-on-rotation, Celery 90-day key rotation, and backup_crypto.py integration are NOT yet implemented. (Phase 5 migration tooling now implemented.)

## OpenBao KMS Flag-Gated New Writes (GH #152 Phase 4)

**Implemented 2026-06-11:** When `WIMS_CRYPTO_PROVIDER=openbao_transit`, new incident PII writes use `KmsSecurityProvider.encrypt_json()` via OpenBao Transit. All write paths now dispatch through `services.kms.get_crypto_provider()`.

- **AFOR commit wiring:** `api/routes/regional/afor.py` and `__init__.py` now wire `get_crypto_provider()` instead of the legacy `helpers.get_security_provider()` singleton. This ensures the AFOR import path (`commit.py`) respects `WIMS_CRYPTO_PROVIDER`.
- **Write behaviour:** When `WIMS_CRYPTO_PROVIDER` is unset or `env_aesgcm`, new rows store `crypto_provider='env_aesgcm'`, `encryption_iv=<real nonce>`, `kms_key_name=NULL` — unchanged legacy behaviour. When `openbao_transit`, new rows store `crypto_provider='openbao_transit'`, `kms_key_name='wims-incident-pii'` (default), `pii_blob_enc=<Transit ciphertext>`, `encryption_iv=NULL`.
- **Response contract:** API/detail responses strip `crypto_provider`, `kms_key_name`, `pii_blob_enc`, `encryption_iv` (encoder detail view already did; conflict fetch `_fetch_incident_edit_fields` now additionally strips `crypto_provider`/`kms_key_name`).
- **Tests:** 10 new unit tests in `tests/test_openbao_new_writes.py` covering env-AES metadata, OpenBao Transit metadata, nonce sentinel guarding, response metadata stripping, and wiring verification. All 57 tests pass (54 passed + 3 skipped for live OpenBao).
- **Non-goals:** No legacy-row migration (Phase 5), no Celery 90-day rotation (Phase 6), no backup_crypto.py (Phase 7), no frontend changes.

## OpenBao KMS Migration Tooling (GH #152 Phase 5)

**Implemented 2026-06-11:** Controlled migration script to convert existing legacy env-AES PII blobs to OpenBao Transit rows in bounded, resumable batches.

- **Script:** `src/backend/scripts/migrate_pii_to_openbao.py` — reads `incident_sensitive_details` rows with `pii_blob_enc IS NOT NULL` and `crypto_provider IS NULL OR crypto_provider = 'env_aesgcm'`. Supports `--dry-run`, `--batch-size N` (default 500), `--incident-id ID`, `--resume-after ID`, `--limit N`.
- **Idempotent:** rows already `crypto_provider='openbao_transit'` are skipped.
- **Error isolation:** one bad row increments errors, logs `incident_id`, continues to next row.
- **Transaction policy:** commit per batch; rollback only current batch on fatal flush error.
- **Key version:** detects `key_version` column dynamically via `information_schema`; updates it from `kms_provider.current_version` when the column exists.
- **Requires:** `DATABASE_URL` (or `SQLALCHEMY_DATABASE_URL`), `WIMS_MASTER_KEY` (legacy decrypt), `OPENBAO_ADDR` + token (OpenBao encrypt).
- **Tests:** `tests/test_migrate_pii_to_openbao.py` — 23 unit tests (no live OpenBao). Covers dry-run, successful migration, idempotent skip, decryption/encryption/update error isolation, CLI flag behavior, key version column detection, and exit codes.
- **Non-goals:** Does NOT implement Celery 90-day rotation (Phase 6 — now implemented). Does NOT implement backup encryption (Phase 7). Does NOT migrate live data automatically. Does NOT alter frontend.

## OpenBao KMS Automated Key Rotation (GH #152 Phase 6)

**Implemented 2026-06-11:** Scheduled daily 90-day OpenBao Transit key rotation + resumable rewrap orchestration.

- **Migration** `55_kms_key_rotation_runs.sql`: creates `wims.kms_key_rotation_runs` table with UUID PK, status enum (RUNNING/SUCCEEDED/FAILED), from/to version tracking, row counters (`rows_scanned`, `rows_rewrapped`, `rows_skipped`, `rows_failed`), and error message. Indexes support active-run guard and last-success lookup. RLS restricts to SYSTEM_ADMIN.
- **Rotation task** `tasks/kms_rotation.py`: Celery task `ensure_pii_key_rotation` checks active RUNNING guard, reads OpenBao key metadata, determines if 90-day rotation is due via `is_rotation_due()`, rotates key, records run row, rewraps `openbao_transit` rows to new key version via `rewrap_openbao_rows()`, and marks run SUCCEEDED or FAILED. Rewrap uses cursor-paginated batches with per-batch commit. Per-row errors increment failure counter and continue. AAD is `incident_id:{id}`.
- **Celery beat** `celery_config.py`: daily schedule entry `ensure-pii-key-rotation-daily` at 03:30 UTC.
- **Env configuration:** `OPENBAO_ROTATION_INTERVAL_DAYS` (default 90), `KMS_REWRAP_BATCH_SIZE` (default 500).
- **Tests:** `tests/test_kms_rotation_task.py` — 17 unit tests (no live OpenBao). Covers rotation-due boundary logic, single-run guard, rotate + run row recording, rewrap row updates, skip already-at-target, per-row rewrap error isolation, UPDATE failure isolation, SUCCEEDED/FAILED status transitions, start_run UUID return, and Celery beat entry verification.
- **Non-goals:** Does NOT delete/disable old OpenBao key versions. Does NOT implement backup_crypto.py integration (Phase 7). Does NOT run live migration/rotation against real data. Does NOT touch frontend.
- **Overall GH #152 status:** Phases 1-7 code paths implemented; #152 remains PARTIAL until live OpenBao integration/ops are complete (live restore drill pending).

## OpenBao KMS Backup Encryption (GH #152 Phase 7)

**Implemented 2026-06-11:** `backup_crypto.py` integrated with OpenBao Transit for new backup encryption, with legacy restore compatibility preserved.

- **Feature flag:** `WIMS_BACKUP_CRYPTO_PROVIDER` (new backup-specific env var) overrides `WIMS_CRYPTO_PROVIDER`. Default: `env_aesgcm` (legacy AES-256-GCM with `WIMS_MASTER_KEY`). Opt in via `WIMS_BACKUP_CRYPTO_PROVIDER=openbao_transit`.
- **Key name:** `OPENBAO_BACKUP_KEY_NAME` env var, default `wims-backup`.
- **New OpenBao format (WIMSBAO1):** versioned envelope with `WIMSBAO1\n` magic header, JSON metadata line (`provider`, `key_name`, `created_at`, `ciphertext_version`), then OpenBao Transit ciphertext as UTF-8 bytes. Header contains no plaintext, raw keys, tokens, or secrets. Files retain `.enc` extension.
- **Legacy compatibility:** `decrypt_backup()` auto-detects format — reads first 8 bytes for `WIMSBAO1\n` magic. If detected, dispatches to OpenBao Transit decrypt. Otherwise treats file as legacy env-AES nonce+ciphertext. `encrypt_backup()` and `decrypt_backup()` signatures unchanged.
- **Context/AAD:** OpenBao Transit encrypt/decrypt uses `b"wims-backup"` as AAD context for encryption binding.
- **Admin routes:** No changes needed — `src/backend/api/routes/admin/backups.py` calls `encrypt_backup()` / `decrypt_backup()` without modification.
- **Tests:** `tests/test_backup_crypto_openbao.py` — 34 unit tests (no live OpenBao). Covers legacy env-AES roundtrip, OpenBao WIMSBAO1 header write/parse, OpenBao roundtrip, header auto-detection on decrypt, legacy decrypt without header, missing/invalid metadata, `OPENBAO_BACKUP_KEY_NAME` honoring, unknown provider error, and signature/output-path preservation.
- **Non-goals:** Does NOT run live OpenBao backup/restore drill. Does NOT remove legacy env-AES restore. Does NOT change frontend.

## OpenBao KMS Phase 8 — Hardening, Runbook, Live Validation Hooks (GH #152)

**Implemented 2026-06-11:** Phase 8 adds production-readiness artifacts and validation hooks for OpenBao KMS operations.

- **Operations runbook:** `docs/operations/openbao-kms-runbook.md` — covers local dev bootstrap, env var reference, production topology, unseal strategy (Shamir M-of-N / platform auto-unseal), least-privilege policy summary, migration runbook (dry run, production run, rollback/resume), rotation runbook (scheduled beat, inspection, triage), backup restore drill (legacy + OpenBao), incident response (down/sealed/auth failure/rotation failure/backup decrypt failure), and explicit secret hygiene rules.
- **Live integration tests:** `src/backend/tests/integration/test_openbao_kms_live.py` — 5 live tests (health, encrypt/decrypt roundtrip, wrong-context rejection, rewrap ciphertext-change + plaintext-preservation, backup encrypt/decrypt roundtrip with WIMSBAO1 header verification). All tests skip cleanly when OpenBao is unavailable or unconfigured. No hard Docker dependency.
- **Smoke script:** intentionally skipped — the integration tests cover the same surface and can be invoked with a single `pytest` command; a separate smoke script would be redundant.
- **No-secret logging verified:** all existing code paths (client, rotation, migration, backup_crypto, rewrap) log only operation metadata; no ciphertext, plaintext, nonces, keys, or tokens appear in log statements.
- **Overall GH #152 status:** Phases 1-8 code paths, runbook, and test hooks implemented. **Live environment validation remains pending** — until live OpenBao is available in this environment and the integration tests pass against it, #152 is PARTIAL. Do not claim #152 or FRS Module 6 fully closed until the live backup restore drill and integration tests are executed in the target environment.

## OpenBao KMS Production Lifecycle Fixes (2026-06-11)

**Health routing fix:** `OpenBaoClient._url_for()` helper ensures sys API paths (e.g. `/sys/health`) bypass the Transit mount prefix. Health calls now correctly hit `/v1/sys/health` instead of the invalid `/v1/transit/sys/health`. Unit tests (`TestOpenBaoClientRouting`) validate URL construction for health, encrypt, decrypt, rewrap, rotate, and metadata endpoints.

**Bootstrap lifecycle rewrite:** `src/openbao/init/bootstrap-openbao.sh` now handles three states:
1. Uninitialised → init (1/1 Shamir for dev), unseal, bootstrap Transit
2. Initialised + sealed → unseal only if `OPENBAO_UNSEAL_KEY` is provided; fail-fast with manual-unseal message otherwise
3. Initialised + unsealed → authenticate with `OPENBAO_TOKEN` env, then persisted root token, then `OPENBAO_DEV_ROOT_TOKEN`

Never prints root token or unseal key to logs. Idempotent for Transit enable and key creation.

**Derived Transit key enforcement:** `wims-incident-pii` and `wims-backup` keys are created with `derived=true` (AES-256-GCM-96). This cryptographically binds every encrypt/decrypt operation to its context/AAD. If a key already exists but is *not* derived, bootstrap fails with an explicit operator message — destructive recreation is forbidden, but silent weakening of context enforcement is also forbidden. `convergent_encryption` is never set.

**Compose healthcheck fix:** `openbao` healthcheck now requires BOTH `initialized=true` AND `sealed=false` — previously only checked `initialized=true`, which passed initialized-but-sealed clusters (the VPS failure state). Bootstrap depends on `service_started` (not `service_healthy`) so first-boot init is not deadlocked by the sealed=false requirement.

**Credential persistence:** On first boot, the bootstrap script persists the generated root token and unseal key to `/vault/file/.bootstrap-creds` (chmod 600) inside the `openbao_data` Docker volume. Subsequent restarts read this file as a fallback when env vars are unset. Token fallback chain for bootstrap auth: env `OPENBAO_TOKEN` > persisted `OPENBAO_ROOT_TOKEN` > `OPENBAO_DEV_ROOT_TOKEN` (default `devroot`). Unseal key fallback chain: env `OPENBAO_UNSEAL_KEY` > persisted. **Dev/single-VPS only** — production must use a proper secrets manager.

**Backend/celery token-file auth:** After writing the `wims-app` policy, bootstrap verifies any existing app token in `/vault/file/.wims-app-token`; if missing or invalid, it creates a replacement policy-scoped orphan token and persists the token value to that file. `backend` and `celery-worker` mount `openbao_data` read-only at `/openbao-creds`, set `OPENBAO_TOKEN_FILE=/openbao-creds/.wims-app-token`, and explicitly clear `OPENBAO_TOKEN` so stale `.env.production` tokens do not override the regenerated token file after an OpenBao volume reset. `OpenBaoClient` supports direct `OPENBAO_TOKEN` first, then `OPENBAO_TOKEN_FILE`, then future AppRole envs.

**Backend/celery env plumbing:** `OPENBAO_ADDR`, `OPENBAO_TOKEN_FILE`, and `OPENBAO_TRANSIT_MOUNT` env vars are plumbed into `backend` and `celery-worker` compose services with safe defaults (default addr/token-file path, empty direct token). `WIMS_CRYPTO_PROVIDER` defaults to `env_aesgcm` — OpenBao is only used when explicitly opted in. No dependency on `openbao` or `openbao-bootstrap` is added to backend/celery (avoids forcing optional infrastructure on default env-aesgcm boot).

**Safe key-delete warning:** The non-derived-key error message now explicitly warns that deleting the key destroys decryptability of any data encrypted with it, and lists migration/restore/reset as prerequisites before deletion.

**Tests:** 8 new unit tests in `TestOpenBaoClientRouting` proving sys paths bypass mount. Existing `test_decrypt_wrong_context_fails_live` remains correct under derived keys — wrong context = decrypt failure by design.

## CSRF Protection

FRS Module 11b requires Cross-Site Request Forgery testing. The following layers are enforced:

- **SameSite=Strict cookies:** Auth cookies (`__Host-access_token`, `__Host-refresh_token`) are set with `Secure; HttpOnly; SameSite=Strict; Path=/`. No `Domain` attribute. Implemented in `src/frontend/src/app/api/auth/sync/route.ts`, `refresh/route.ts`, and `logout/route.ts`.
- **`__Host-` cookie prefix:** Prevents subdomain cookie injection — compliant browsers reject `__Host-` cookies set from any context that does not match the origin exactness requirements (HTTPS, no Domain, Path=/).
- **Origin/Referer validation middleware:** `src/backend/utils/csrf.py` — `csrf_middleware` is registered on the FastAPI app via `app.middleware("http")`. GET/HEAD/OPTIONS bypass (safe methods). POST/PUT/PATCH/DELETE without a valid Origin or Referer matching the configured allowlist are rejected with 403. Allowlist from `CSRF_TRUSTED_ORIGINS` env var, falling back to localhost defaults. **Exemption:** the zero-trust public DMZ path prefix `/api/v1/public/` is explicitly excluded from CSRF validation because these endpoints are unauthenticated (no Keycloak JWT, no cookie dependency) and are protected by rate limiting + Pydantic validation instead.
- **Nginx CORS restricted:** Production `Access-Control-Allow-Origin` uses a deny-by-default `$cors_origin` map (whitelisted origins: `https://wimsbfp.tech`, `https://wims.bfp.gov.ph`). Local dev config uses `$scheme://$host`. Neither echoes `$http_origin`.
- **Pen-test checklist:** `docs/pentest/CSRF-CHECKLIST.md` documents all manual verification procedures.
- **Test coverage:** `src/backend/tests/test_csrf_middleware.py` covers safe methods, invalid/missing Origin, valid Origin, Referer fallback, PUT/PATCH/DELETE variants, and VPS production origin scenarios.

## Related
- [[database/schema-overview]]
- [[backend/api-route-map]]
- [[gaps/frs-codebase-gap-register]]
- `docs/pentest/CSRF-CHECKLIST.md`

## Hash-Chain Integrity (Incident Verification History)

**Status:** Implemented (#241)

- **Write path:** `PATCH /api/regional/incidents/{id}/correct` (validator.py) computes and stores `ivh_row_hash`, `prev_ivh_hash`, `new_data_hash`, `old_data_hash`, `corrected_fields` in `wims.incident_verification_history`.
- **Read-path verification:** `verify_incident_hash_chain()` in `services/regional_incidents/helpers.py` recomputes row hashes, verifies chain linking, and checks anchor (`new_data_hash` vs `fire_incidents.data_hash`). Returns `integrity_status`: `"valid"`, `"tampered"`, or `"unverified"` (for legacy rows without hash-chain data).
- **Integration:** Called from `GET /api/regional/incidents/{id}`, `GET /api/regional/validator/incidents/{id}/history`, and `GET /api/incidents/analyst/{id}`. The `integrity_status` field is included in API responses.
- **Audit:** Tampered chains log `INTEGRITY_VIOLATION` rows to `wims.system_audit_trails`.
- **Limitation:** Only correction operations write hash-chain data. Regular verify/approve transitions do not (those rows show `"unverified"`).
