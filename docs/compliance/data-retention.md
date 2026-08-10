# Data Retention Policy

- **Effective Date:** 2026-06-23
- **ASVS Reference:** V14.2.4 (MED)
- **Owner:** Platform Engineering
- **Applies to:** WIMS-BFP production and staging environments

## Scope

This policy defines retention periods and erasure strategies for all database tables
in the `wims` schema that accumulate operational, personal, or sensitive data over time.
Immutability-hardened tables (`incident_verification_history`, `system_audit_trails`)
are explicitly excluded from pruning — their append-only design is a hard constraint
of the repudiation (ASVS V7.3.1) and forensic-audit (ASVS V7.4.1) requirements.

## Per-Table Retention Strategy

| # | Table | Strategy | Retention Column | Default (days) | Default (years) |
|---|---|---|---|---|---|
| 1 | `fire_incidents` (VERIFIED) | Soft-archive (`is_archived=TRUE` in place) | `created_at` | 2,555 | 7 |
| 2 | `fire_incidents` (non-VERIFIED) | Hard DELETE | `created_at` | 2,555 | 7 |
| 3 | `incident_sensitive_details` | Blob-erasure (NULL all PII columns + encrypted blob + IV) | `fire_incidents.created_at` (via subquery) | 2,555 | 7 |
| 4 | `incident_verification_history` | No-op (append-only, hash-chain protected) | N/A | N/A | N/A |
| 5 | `system_audit_trails` | No-op (append-only, RULE-protected) | N/A | N/A | N/A |
| 6 | `security_threat_logs` | Hard DELETE | `timestamp` | 365 | 1 |
| 7 | `consent_log` | Hard DELETE | `recorded_at` | 1,095 | 3 |
| 8 | `kms_key_rotation_runs` | Hard DELETE | `started_at` | 1,095 | 3 |
| 9 | `ip_blocklist` | Hard DELETE (expired *or* older than threshold) | `blocked_at` / `expires_at` | 365 | 1 |

## Rationale

### Soft-archive (VERIFIED fire_incidents)
The `no_delete_verified` RULE (migration 17) blocks DELETE on VERIFIED incident rows.
Migration 41 carved out `is_archived` toggles, so we soft-archive in place rather than
moving to a separate table. The row remains accessible for repudiation-hash verification
and historical reference but is excluded from default UI queries.

### Blob-erasure (incident_sensitive_details)
PII columns are NULLed in place, including the encrypted blob (`pii_blob_enc`) and its
IV (`encryption_iv`). The FK‑preserving `sensitive_id` + `incident_id` stay intact so
the audit trail can reference the existence of sensitive details without holding the data.
A `data_retention_erased_at` timestamp records when the erasure occurred.

**Deferred — key-destruction crypto-shred:**
True crypto-shred (destroying derived per-record keys to make ciphertexts unrecoverable
even from backups) requires an encryption-architecture change to per-record key derivation.
This is tracked as a follow-up; the blob-erasure here is the shippable-now layer.

### No-op tables
- `incident_verification_history`: hash-chain integrity prevents any row removal.
- `system_audit_trails`: parent-level immutability triggers (`100_audit_trail_immutability.sql` / alembic 0031) raise an error on any UPDATE/DELETE, on current and future partitions.

These tables are append-only by design (ASVS V7.3.1 / V7.4.1). Size is bounded by
operational monitoring of the `system_audit_trails` table growth rate; a future
follow-up may implement log rotation via separate archival storage.

## Configuration

Retention periods are stored in `wims.system_config` and read at runtime by the
Celery task. Keys and their defaults:

| Config Key | Default | Description |
|---|---|---|
| `retention.fire_incidents_days` | 2555 | Fire incidents (soft-archive VERIFIED, hard-delete non-VERIFIED) |
| `retention.incident_sensitive_details_days` | 2555 | PII blob-erasure on incident_sensitive_details |
| `retention.security_threat_logs_days` | 365 | IDS alert log retention |
| `retention.consent_log_days` | 1095 | Consent log retention |
| `retention.kms_key_rotation_runs_days` | 1095 | KMS rotation history |
| `retention.ip_blocklist_days` | 365 | IP blocklist retention |

Change via `UPDATE wims.system_config SET config_value = '<new_value>' WHERE config_key = '<key>'`.
Celery reads the latest value on every task run; no restart required.

## Schedule

The Celery beat task `data-retention-daily` runs every day at **03:00 UTC** (off-peak).
It is self-registered into the beat schedule at module import time from
`tasks/data_retention.py`.

## Audit Trail Logging

Every prune action logs one row to `wims.system_audit_trails` with:

| Field | Value |
|---|---|
| `action_type` | `DATA_RETENTION_PRUNE` |
| `table_affected` | The table being pruned |
| `record_id` | `0` (batch operation, not a single row) |
| `new_values` | JSON with keys: `pruned_count`, `erased_count`, `strategy`, `retention_days`, `config_key` |
| `user_id` | `NULL` (system task, not a user action) |

## Residual Risk

1. **Key-destruction crypto-shred** is deferred (requires per-record key derivation).
   Blob-erasure protects the live database but not historical backups containing the
   old ciphertexts. See deferred follow-up note above.
2. **`system_audit_trails` and `incident_verification_history`** grow unboundedly. No
   retention-based pruning is possible by design. Monitor growth rate; plan for
   archival storage if size becomes an issue.
3. **No soft-delete for `consent_log`** — records are hard-DELETEd after the retention
   period. If regulatory requirements change, switch to a soft-delete strategy.
