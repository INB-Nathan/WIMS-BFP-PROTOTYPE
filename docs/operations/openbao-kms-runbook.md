# OpenBao KMS Operations Runbook

**Issue**: GH #152 Phase 8 — hardening, validation hooks, operator runbook  
**Last updated**: 2026-06-11 (credential persistence, health-unsealed guard, backend env plumbing, derived-key safe-delete warning)  
**Status**: Phase 1-7 code paths implemented; live ops drill pending; derived-key guard active

---

## Table of Contents

1. [Local Dev Bootstrap](#1-local-dev-bootstrap)
2. [Expected Environment Variables](#2-expected-environment-variables)
3. [Production Topology](#3-production-topology)
4. [Unseal Strategy](#4-unseal-strategy)
5. [Least-Privilege Policy](#5-least-privilege-policy)
6. [Migration Runbook](#6-migration-runbook)
7. [Rotation Runbook](#7-rotation-runbook)
8. [Backup Restore Drill](#8-backup-restore-drill)
9. [Incident Response](#9-incident-response)
10. [Secret Hygiene](#10-secret-hygiene)

---

## 1. Local Dev Bootstrap

### Prerequisites

- Docker and Docker Compose installed
- Repository root: `src/`

### Bring up OpenBao

```bash
cd src
docker compose up openbao openbao-bootstrap
```

This starts:
1. **`wims-openbao`** — OpenBao 2.2.0 server with `openbao.hcl` file storage backend
2. **`wims-openbao-bootstrap`** — one-shot container that handles the full lifecycle:
   - **First boot (uninitialised):** automatically initialises OpenBao with 1 key share / 1 threshold, unseals, then bootstraps Transit. Root token and unseal key are captured internally and never logged.
   - **Sealed after restart:** if `OPENBAO_UNSEAL_KEY` is provided, automatically unseals; otherwise fails fast with a manual-unseal message.
   - **Already initialised + unsealed:** authenticates using the token chain `OPENBAO_TOKEN` env > persisted root token > `OPENBAO_DEV_ROOT_TOKEN` (default `devroot`).
   - Enables the Transit secrets engine at the configured mount path (idempotent).
   - Creates `wims-incident-pii` Transit key (**derived=true**, AES-256-GCM-96, for PII encryption). If the key already exists and is *not* derived, bootstrap fails with an explicit operator message that warns about data loss before recommending key deletion.
   - Creates `wims-backup` Transit key (**derived=true**, AES-256-GCM-96, for backup encryption). Same derived-validation guard.
   - Persists the generated root token and unseal key to `openbao_data:/vault/file/.bootstrap-creds` (chmod 600) so subsequent restarts can auto-unseal and authenticate without manual operator capture. **Dev/single-VPS only** — production must use a secrets manager.
   - Writes the `wims-app` least-privilege policy

### Verify readiness

```bash
# Check health
curl -sf http://localhost:8200/v1/sys/health | jq .

# List transit keys (use the configured service/admin token; do not assume devroot after auto-init)
curl -sf -H "X-Vault-Token: ${OPENBAO_TOKEN:?set OPENBAO_TOKEN}" http://localhost:8200/v1/transit/keys | jq '.data.keys'
```

Expected output: `["wims-incident-pii", "wims-backup"]`.

### Tear down

```bash
cd src && docker compose down
# Add -v to remove volumes (including openbao_data) — use with caution
```

---

## 2. Expected Environment Variables

### OpenBao connection

| Variable | Default | Purpose |
|---|---|---|
| `OPENBAO_ADDR` | (required) | OpenBao API URL, e.g. `http://openbao:8200` |
| `OPENBAO_TOKEN` | — | Service token for backend/celery auth |
| `OPENBAO_ROLE_ID` | — | AppRole RoleID (future alternative to token) |
| `OPENBAO_SECRET_ID` | — | AppRole SecretID (future alternative to token) |
| `OPENBAO_TRANSIT_MOUNT` | `transit` | Transit engine mount path |
| `OPENBAO_TIMEOUT_SECONDS` | `2.0` | HTTP request timeout in seconds |

### Key names

| Variable | Default | Purpose |
|---|---|---|
| `OPENBAO_PII_KEY_NAME` | `wims-incident-pii` | Transit key for PII field encryption |
| `OPENBAO_BACKUP_KEY_NAME` | `wims-backup` | Transit key for backup file encryption |

### Provider selection

| Variable | Default | Purpose |
|---|---|---|
| `WIMS_CRYPTO_PROVIDER` | `env_aesgcm` | `env_aesgcm` or `openbao_transit` — controls PII encryption provider |
| `WIMS_BACKUP_CRYPTO_PROVIDER` | (falls back to `WIMS_CRYPTO_PROVIDER`) | `env_aesgcm` or `openbao_transit` — controls backup encryption provider |

### Rotation

| Variable | Default | Purpose |
|---|---|---|
| `OPENBAO_ROTATION_INTERVAL_DAYS` | `90` | Days between auto-rotation (FRS Module 6a.iv) |
| `KMS_REWRAP_BATCH_SIZE` | `500` | Rows per rewrap batch during rotation |

### Legacy decrypt (migration only)

| Variable | Default | Purpose |
|---|---|---|
| `WIMS_MASTER_KEY` | (required for migration) | Base64 32-byte AES-256 key for decrypting legacy env-AES blobs |

### Dev convenience

| Variable | Default | Purpose |
|---|---|---|
| `OPENBAO_DEV_ROOT_TOKEN` | `devroot` | Final fallback token for local dev/manual-init flows; auto-init persists a generated root token instead |
| `OPENBAO_UNSEAL_KEY` | — | Unseal key for automated unseal after restart (required only when OpenBao is sealed and you want scripted unseal) |

### Credential persistence (dev / single-VPS only)

On first boot, `bootstrap-openbao.sh` writes the generated root token and unseal key to
`/vault/file/.bootstrap-creds` (inside the `openbao_data` Docker volume, chmod 600).
On subsequent restarts the script reads this file as a fallback when
`OPENBAO_TOKEN` / `OPENBAO_UNSEAL_KEY` env vars are not set.

**This file is plaintext on disk inside a Docker volume.** It is acceptable for a
single-VPS prototype where the volume is only accessible to root on the host.
Production deployments MUST use a proper secrets manager (HashiCorp Vault KV v2,
Docker secrets, or cloud KMS) and MUST NOT rely on this persistence mechanism.

---

## 3. Production Topology

### Recommended architecture

- **Dedicated VPS / managed OpenBao cluster** on an internal-only network (not internet-facing)
- **TLS everywhere**: listener `tls_disable = false` with proper cert/key; set `BAO_SKIP_VERIFY=false`
- **HA / Raft**: use `storage "raft"` with 3–5 nodes for production resilience
- **Alternative**: managed HashiCorp Vault (HCP Vault) or OpenBao-compatible service — the `OpenBaoClient` adapter is API-compatible with standard Vault/OpenBao Transit endpoints
- **Network**: OpenBao binds on internal network only; backend and celery-worker connect via internal Docker network or VPC

### Docker Compose production stub

```yaml
openbao:
  image: openbao/openbao:2.2.0
  cap_add: [IPC_LOCK]
  networks:
    - wims_internal  # internal-only, no port mapping to host
  volumes:
    - openbao_data:/vault/file
    - /etc/openbao/config:/vault/config:ro  # production hcl
  environment:
    BAO_SKIP_VERIFY: "false"
  healthcheck:
    test: ["CMD-SHELL", "curl -ksf https://localhost:8200/v1/sys/health"]
```

---

## 4. Unseal Strategy

### Shamir M-of-N (recommended for self-managed OpenBao)

- Configure `secret_shares: 5` and `secret_threshold: 3` in the OpenBao config (or init args)
- Distribute unseal keys to **named owners** in a secure offline channel:
  - Owner 1: [NAME] — key shard 1
  - Owner 2: [NAME] — key shard 2
  - Owner 3: [NAME] — key shard 3
  - Owner 4: [NAME] — key shard 4
  - Owner 5: [NAME] — key shard 5
- **Root token**: generate two copies during init; store in separate physical safes. Named custodians; log access.

### Platform auto-unseal (managed / cloud KMS)

- Use cloud KMS auto-unseal (AWS KMS, GCP CKMS, Azure Key Vault) or a dedicated HSM
- Requires `seal "awskms"`, `seal "gcpckms"`, etc. in the OpenBao config
- No human unseal ceremony needed

### Post-restart unseal procedure (Shamir)

```bash
OPENBAO_ADDR=https://openbao.internal:8200
bao operator unseal  # enter key 1
bao operator unseal  # enter key 2
bao operator unseal  # enter key 3  # threshold met → unsealed
# Verify
curl -sf -H "X-Vault-Token: <root>" "${OPENBAO_ADDR}/v1/sys/health" | jq .sealed
# Expected: false
```

### Automated bootstrap lifecycle (dev / single-VPS)

The `openbao-bootstrap` container handles the full lifecycle via `bootstrap-openbao.sh`:

1. **First boot (uninitialised):** the script initialises OpenBao (1 key share, 1 threshold for dev), unseals, then bootstraps Transit. Root token and unseal key are persisted to `/vault/file/.bootstrap-creds` (chmod 600). No pre-existing tokens needed.
2. **Sealed restart:** the script tries `OPENBAO_UNSEAL_KEY` env var, falls back to the persisted file, otherwise fails fast with a clear manual-unseal message.
3. **Already unsealed:** the script authenticates using the token chain: `OPENBAO_TOKEN` env > persisted root token > `OPENBAO_DEV_ROOT_TOKEN` (default `devroot`).
4. **API reachability:** the script waits for OpenBao's status endpoint to return valid JSON (containing `"initialized"`), not for exit code 0, so sealed/uninitialized clusters can be detected before init/unseal branches.
5. **Healthcheck:** the `openbao` service healthcheck requires BOTH `initialized=true` AND `sealed=false`. Bootstrap depends on `service_started` (not `service_healthy`) so first-boot init is not deadlocked by the sealed=false requirement.

**Critical:** all Transit keys are created with `derived=true` (AES-256-GCM-96). This cryptographically binds encryption operations to a context/AAD value — wrong context decrypts will fail by design. If a key exists but is not derived, bootstrap fails with an operator message that warns about data loss before recommending deletion.

---

## 5. Least-Privilege Policy

The `wims-app` policy (`src/openbao/policies/wims-app.hcl`) grants exactly:

| Path | Capabilities | Purpose |
|---|---|---|
| `transit/encrypt/wims-incident-pii` | `create`, `update` | Encrypt PII fields |
| `transit/decrypt/wims-incident-pii` | `create`, `update` | Decrypt PII fields |
| `transit/rewrap/wims-incident-pii` | `create`, `update` | Rewrap during rotation |
| `transit/keys/wims-incident-pii` | `read` | Read key metadata (version, rotation state) |
| `transit/encrypt/wims-backup` | `create`, `update` | Encrypt backup files |
| `transit/decrypt/wims-backup` | `create`, `update` | Decrypt backup files |
| `transit/rewrap/wims-backup` | `create`, `update` | Rewrap backup key |
| `transit/keys/wims-backup` | `read` | Read backup key metadata |

**Important**: This policy does NOT grant `sudo`, `root`, `create-key`, `delete-key`, or mount management. Those operations require the root token or separate admin token — never the backend/celery service token.

### Creating a service token with the policy

```bash
# Using root token
curl -sf -H "X-Vault-Token: <root>" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"policies": ["wims-app"]}' \
  "${OPENBAO_ADDR}/v1/auth/token/create" | jq -r '.auth.client_token'
```

Set the output as `OPENBAO_TOKEN` in backend/celery env.

---

## 6. Migration Runbook

### 6.1 Scope

`src/backend/scripts/migrate_pii_to_openbao.py` converts existing `incident_sensitive_details` rows from legacy `env_aesgcm` to `openbao_transit`.

### 6.2 Prerequisites

```bash
export DATABASE_URL="postgresql://postgres:password@postgres:5432/wims"
export OPENBAO_ADDR="http://openbao:8200"
export OPENBAO_TOKEN="s.<service-token>"
export WIMS_MASTER_KEY="<base64-32-byte-key>"
```

### 6.3 Dry run (always first)

```bash
cd src/backend
python scripts/migrate_pii_to_openbao.py --dry-run
```

Output:
```
DRY RUN: 1234 candidate legacy env-AES rows would be processed
```

### 6.4 Production run

```bash
# Full migration in batches of 500
python scripts/migrate_pii_to_openbao.py --batch-size 500

# Bounded: process at most 1000 rows
python scripts/migrate_pii_to_openbao.py --batch-size 300 --limit 1000

# Resume after incident_id 4200 (keyset cursor)
python scripts/migrate_pii_to_openbao.py --batch-size 500 --resume-after 4200

# Single-row migration
python scripts/migrate_pii_to_openbao.py --incident-id 42
```

Exit code 0 = all rows migrated without errors. Exit code 1 = one or more errors; re-run (idempotent).

### 6.5 Rollback / resume guidance

- **Rollback**: not built in. The script does not delete legacy blobs — it only writes new `openbao_transit` rows. Original `env_aesgcm` blobs are overwritten in the same row. Restore from most recent backup to roll back.
- **Resume**: use `--resume-after` with the last successfully processed `incident_id` from logs.
- **Idempotent**: rows already `crypto_provider='openbao_transit'` are skipped silently.

### 6.6 Verification after migration

```sql
-- Count rows by provider
SELECT crypto_provider, COUNT(*) 
FROM wims.incident_sensitive_details 
GROUP BY crypto_provider;

-- Verify all migrated rows have a non-null pii_blob_enc
SELECT COUNT(*) AS null_blobs 
FROM wims.incident_sensitive_details 
WHERE crypto_provider = 'openbao_transit' AND pii_blob_enc IS NULL;
-- Expected: 0

-- Verify no rows have both crypto_provider='openbao_transit' AND non-null encryption_iv
SELECT COUNT(*) AS invalid_nonce
FROM wims.incident_sensitive_details
WHERE crypto_provider = 'openbao_transit' AND encryption_iv IS NOT NULL;
-- Expected: 0
```

---

## 7. Rotation Runbook

### 7.1 How it works

- Celery beat runs `ensure_pii_key_rotation` daily at 03:30 UTC
- The task:
  1. Checks for an active `RUNNING` row in `wims.kms_key_rotation_runs` (single-run guard)
  2. Reads OpenBao key metadata (current `latest_version`)
  3. Reads last `SUCCEEDED` rotation run from DB
  4. If `completed_at` is older than `OPENBAO_ROTATION_INTERVAL_DAYS` (default 90): triggers rotation
  5. Rotates the key via `OpenBaoClient.rotate()` → bumps latest_version
  6. Records a `RUNNING` run row
  7. Rewraps all `openbao_transit` rows in cursor-paginated batches
  8. Marks run `SUCCEEDED` or `FAILED`

### 7.2 Inspect rotation state

```sql
-- Last 5 rotation runs
SELECT run_id, key_name, status, from_version, to_version,
       rows_scanned, rows_rewrapped, rows_skipped, rows_failed,
       started_at, completed_at, error_message
FROM wims.kms_key_rotation_runs
ORDER BY started_at DESC
LIMIT 5;
```

### 7.3 Resume / triage after failure

If a run shows `FAILED`:
1. Read `error_message` — it describes the failure reason (rotate fail, rewrap errors, etc.)
2. **Key already rotated but rewrap failed**: the key version advanced; a new run will skip rotation (guard checks due based on time, not version). Manually restart the rewrap by:
   - Delete the failed run row (if you want a clean re-run), OR
   - Wait for the next scheduled check (task is idempotent — already-rewrapped rows skip)
3. **Rotate failed**: check OpenBao health (`curl /v1/sys/health`), token validity, connectivity
4. **All rewrapped but one row failed**: the `FAILED` status + `rows_failed > 0` indicates partial failure. Investigate the problematic `incident_id` in application logs (logged at ERROR level per row)

### 7.4 Manual rotation trigger

```python
# In a Python shell with backend src on path:
from tasks.kms_rotation import ensure_pii_key_rotation
result = ensure_pii_key_rotation()
print(result)
```

---

## 8. Backup Restore Drill

### 8.1 Legacy env-AES backup restore

```bash
# Encrypt (default provider = env_aesgcm)
WIMS_MASTER_KEY="<base64-32>" \
python -c "
from utils.backup_crypto import encrypt_backup
from pathlib import Path
encrypt_backup(Path('backup.sql'))
"

# Decrypt
WIMS_MASTER_KEY="<base64-32>" \
python -c "
from utils.backup_crypto import decrypt_backup
from pathlib import Path
decrypt_backup(Path('backup.sql.enc'))
"

# Verify
diff backup.sql backup.sql.sql && echo "PASS: roundtrip identical"
```

### 8.2 OpenBao-backed backup restore

```bash
# Encrypt with OpenBao Transit
OPENBAO_ADDR="http://openbao:8200" \
OPENBAO_TOKEN="<service-token>" \
WIMS_BACKUP_CRYPTO_PROVIDER="openbao_transit" \
python -c "
from utils.backup_crypto import encrypt_backup
from pathlib import Path
encrypt_backup(Path('backup.sql'))
"

# Decrypt (auto-detects WIMSBAO1 header)
OPENBAO_ADDR="http://openbao:8200" \
OPENBAO_TOKEN="<service-token>" \
python -c "
from utils.backup_crypto import decrypt_backup
from pathlib import Path
decrypt_backup(Path('backup.sql.enc'))
"

# Verify
diff backup.sql backup.sql.sql && echo "PASS: OpenBao roundtrip identical"
```

### 8.3 What must be validated before marking complete

- [ ] Legacy env-AES encrypt → decrypt roundtrip with production `WIMS_MASTER_KEY`
- [ ] OpenBao encrypt → decrypt roundtrip with production `OPENBAO_TOKEN`
- [ ] Decrypt of a WIMSBAO1 file produced by a different environment (key portability)
- [ ] Decrypt of a legacy env-AES file without WIMSBAO1 header (backward compatibility)
- [ ] Restored SQL loads successfully into PostgreSQL without errors
- [ ] Restored PII blobs decrypt correctly with both legacy and OpenBao providers

---

## 9. Incident Response

### 9.1 OpenBao down (unreachable)

**Symptoms**: `OpenBaoClientError` in backend/celery logs, HTTP 500 on PII read/write, backup encrypt/decrypt failures.

**Response**:
1. Check OpenBao container health: `docker compose ps openbao`
2. Check health endpoint: `curl -sf http://openbao:8200/v1/sys/health`
3. If container is down: `docker compose up -d openbao`
4. Wait for healthcheck pass (up to 50s with retries)
5. Verify backend recovers — `KmsSecurityProvider` constructs fresh on each operation, no persistent connections to leak

### 9.2 OpenBao sealed

**Symptoms**: `curl /v1/sys/health` returns `"sealed": true`. `OpenBaoClient` returns 503 on encrypt/decrypt.

**Response**:
1. Execute unseal procedure (Section 4)
2. Verify: `curl /v1/sys/health | jq .sealed` → `false`
3. Verify transit keys accessible: `curl -H "X-Vault-Token: <root>" /v1/transit/keys`

### 9.3 Auth failure (invalid token)

**Symptoms**: `OpenBaoClientError` with 403 status on HTTP requests.

**Response**:
1. Verify `OPENBAO_TOKEN` is correct in env / Docker secrets
2. Check token expiration: `curl -H "X-Vault-Token: <token>" /v1/auth/token/lookup-self`
3. If expired: create a new service token with `wims-app` policy (Section 5)
4. Update `OPENBAO_TOKEN` env var and restart backend/celery

### 9.4 Rotation failure

**Symptoms**: `wims.kms_key_rotation_runs` row with status `FAILED`.

**Response**: Follow Section 7.3 triage steps.

### 9.5 Backup decrypt failure

**Symptoms**: `RuntimeError` during `decrypt_backup()`, "Decryption failed" or "WIMSBAO1 metadata" errors.

**Response**:
1. **Legacy file**: verify `WIMS_MASTER_KEY` matches the key used at encryption time
2. **OpenBao file**: verify `OPENBAO_ADDR` + `OPENBAO_TOKEN` are correct and OpenBao is unsealed
3. **Corrupted file**: check file integrity; WIMSBAO1 header may be intact but ciphertext tampered
4. **Missing key**: if the OpenBao key was deleted/destroyed, the backup is irrecoverable. Key lifecycle policy should never delete keys with ancestor decryptable data

---

## 10. Secret Hygiene

### Never commit to the repository

| Secret Type | Examples |
|---|---|
| Root tokens | `hvs.xxxxxxxxxxxx`, `s.xxxxxxxxxxxx` |
| Unseal keys | Shamir shard values |
| AppRole secrets | `OPENBAO_ROLE_ID`, `OPENBAO_SECRET_ID` |
| Ciphertext bodies | OpenBao Transit ciphertext, WIMSBAO1 backup files |
| Plaintext backups | Unencrypted `.sql` dump files |
| WIMS_MASTER_KEY | Base64 AES-256 key (the `.env.example` placeholder is all-zeros — NOT a real key) |

### Safety checks before commit

```bash
# Search for potential secret patterns in working tree
git diff --cached | grep -iE 'hvs\.|s\.\w{20,}|root.token|unseal|approle.secret' && \
  echo "WARNING: Potential secret in staged changes — DO NOT COMMIT" || \
  echo "No secret patterns found in staged changes"

# Check for backup/sql files in repo
fd -t f '\.sql$|\.sql\.enc$' . && \
  echo "WARNING: Backup files in repo — remove before commit" || \
  echo "No backup files found"
```

### Production secret management (placeholder)

- Use Docker secrets, HashiCorp Vault KV v2, or a cloud secret manager for `OPENBAO_TOKEN`, `WIMS_MASTER_KEY`
- Rotate service tokens at least every 180 days
- Audit token usage via OpenBao audit log (`file` or `socket` audit device)
- Restrict unseal key access to named custodians only; log every access
