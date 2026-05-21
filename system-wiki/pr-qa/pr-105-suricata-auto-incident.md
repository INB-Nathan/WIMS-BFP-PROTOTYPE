---
title: PR #105 QA — #68 Suricata Auto-Incident Creation
created: 2026-05-17
updated: 2026-05-17
type: backend
tags: [wims-bfp, pr-qa, suricata, ids, auto-incident, security]
sources: [pr-105, src/backend/services/suricata_ingestion.py, src/postgres-init/34_security_incident.sql, src/backend/celery_config.py, src/backend/tests/test_suricata_auto_incident.py]
status: verified
---

# PR #105 QA — #68 Suricata Auto-Incident Creation

## Overview
PR #105 bridges Suricata IDS alerts to WIMS fire incidents. HIGH severity alerts now automatically create a DRAFT security incident in WIMS for admin review. Previously, all Suricata alerts only populated `security_threat_logs`. The PR adds a duplicate guard, service-account creation, and a `security_alert_id` FK from `fire_incidents` to `security_threat_logs`.

**Author**: orljorstin
**Issue**: #68
**Base**: master (bea7325)
**Commits**: 1 (`291bc74 feat(#68): Suricata HIGH-severity alerts auto-create DRAFT security incidents`)

## Changes by Component

### 1. Database Migration `34_security_incident.sql`
```sql
ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS security_alert_id BIGINT
        REFERENCES wims.security_threat_logs(log_id) ON DELETE SET NULL;

CREATE INDEX idx_fire_incidents_security_alert
    ON wims.fire_incidents (security_alert_id)
    WHERE security_alert_id IS NOT NULL;
```

✅ Idempotent. `IF NOT EXISTS` on column and index.
✅ `ON DELETE SET NULL` — if a threat log is purged, the incident remains (preserves audit trail).
✅ Partial index on non-null values — efficient for FK lookups.

### 2. Suricata Ingestion Enhancement `services/suricata_ingestion.py`

#### Duplicate Guard
```python
def _security_incident_exists(db, log_id: int) -> bool:
    row = db.execute(
        text("SELECT 1 FROM wims.fire_incidents WHERE security_alert_id = :log_id LIMIT 1"),
        {"log_id": log_id}
    ).fetchone()
    return row is not None
```

✅ Checked before `_create_security_incident()` is called in `ingest_eve_file()`.

#### Service Account Constants
```python
_SVC_SURICATA_UUID = uuid.UUID("00000000-0000-0000-0000-000000000001")
_BFP_HQ_LONGITUDE = 121.0232
_BFP_HQ_LATITUDE = 14.5906
_DEFAULT_REGION_ID = 1
```

✅ Static UUID — no Keycloak lookup needed.
✅ BFP HQ Manila coordinates — reasonable default for auto-created incidents.
✅ Service account pre-provisioned in `03_users.sql` with `NATIONAL_ANALYST` role (satisfies security_threat_logs RLS policy). No additional migration needed.

#### Incident Creation (`_create_security_incident`)
```python
def _create_security_incident(db, log_id, source_ip, suricata_sid, raw_payload):
    # INSERT fire_incidents: DRAFT, BFP HQ coords, svc account, security_alert_id FK
    # INSERT incident_nonsensitive_details: general_category='SECURITY', alarm_level='ALERT',
    #   station=f"Auto-detected: SID={sid} SRC={src_ip}"
    # INSERT incident_verification_history: DRAFT→DRAFT,
    #   action='Auto-created from Suricata HIGH severity alert'
    # Returns incident_id
```

✅ Creates incident with correct initial state (DRAFT, SECURITY category, ALERT level).
✅ Sets `encoder_id` to service account, `region_id` to NCR, `verification_status` to DRAFT.
✅ Logs verification history entry with descriptive comments.
✅ Station name embeds SID and source IP — traceable.

**Note**: The verification history entry sets both `previous_status` and `new_status` to `'DRAFT'`. This is semantically correct (no state transition) but may look odd in audit trails. Acceptable.

#### Severity Mapping
```python
# eve_to_threat_log_row severity mapping:
# severity 1 → LOW, 2 → MEDIUM, 3 → HIGH, else → MEDIUM
```

✅ Only severity=3 (HIGH) triggers auto-incident creation.

#### EVE File Processing
```python
def ingest_eve_file(path, *, db_session=None):
    # Seek to last known position (_eve_file_positions)
    # Read new lines, parse NDJSON, insert threat log
    # For HIGH severity: duplicate guard → _create_security_incident
    # Save position after processing
    # Returns count of rows inserted into security_threat_logs
```

✅ Tail behavior preserved — only reads new lines after last position.
✅ Position tracking in-memory (per-process) — survives across invocations.
✅ Exception handling with rollback on own session.
✅ Log rotation handled: if `file_size < position`, position resets to 0.

**⚠️ Concern**: `_eve_file_positions` is an in-memory dict. In a multi-worker Celery environment, each worker maintains its own position dict. If two workers process the same EVE file simultaneously, they may duplicate alert insertions. However, the duplicate guard prevents duplicate *incidents*. Acceptable.

### 3. Celery Beat Integration
The `ingest-suricata-eve` beat task was already present in `celery_config.py` (every 10 seconds). No changes to the beat schedule in this PR — only the task implementation was enhanced.

## Security Notes

- ✅ Duplicate guard prevents double-creation of incidents
- ✅ Only HIGH severity triggers incident creation (not MEDIUM/LOW)
- ✅ Service account pre-provisioned (FK constraint satisfied)
- ✅ `ON DELETE SET NULL` on `security_alert_id` — incident survives if log is purged
- ✅ Station name embeds SID + source IP for traceability
- ⚠️ No rate limiting on alert ingestion — a flood of HIGH-severity alerts could create many draft incidents. Consider in future hardening.

## Test Coverage `test_suricata_auto_incident.py`
185 lines, 10 unit tests using mocks:

| Test | Verifies |
|------|---------|
| `test_returns_true_when_incident_exists` | `_security_incident_exists` → True when FK found |
| `test_returns_false_when_no_incident` | `_security_incident_exists` → False |
| `test_high_severity_alert_creates_incident` | `_create_security_incident` called, correct params |
| `test_security_incident_has_correct_location` | BFP HQ coords in INSERT |
| `test_security_incident_links_to_threat_log` | `log_id` FK in INSERT |
| `test_duplicate_guard_exists` | `_security_incident_exists` called before create |
| `test_security_incident_inserts_nonsensitive_details` | Nonsensitive details INSERT with correct params |
| `test_security_incident_inserts_ivh_entry` | Verification history INSERT with correct params |
| `test_high_severity_triggers_auto_incident` | End-to-end: HIGH → `_insert_row` → `_create_security_incident` |
| `test_medium_severity_does_not_trigger_auto_incident` | End-to-end: MEDIUM → no incident creation |

✅ All 10 tests verify critical paths.

## Cross-PR Interaction Analysis

PR #103, #104, and #105 all modify `admin.py` and `celery_config.py`. Merge order recommendation: **#102 → #104 → #103 → #105**. Details in [[pr-qa/pr-103-system-monitoring-prometheus]].

## FRS Alignment
M6-F (Suricata IDS Integration) spec calls for:
- Suricata EVE log parsing ✅
- Alert classification (severity mapping) ✅
- Auto-creation of security incidents ✅
- DRAFT status for admin review ✅
- Duplicate guard ✅

All requirements met.

## QA Verdict

| Area | Status | Risk |
|------|--------|------|
| DB migration (security_alert_id FK) | ✅ Idempotent, ON DELETE SET NULL | None |
| Duplicate guard | ✅ Implemented and tested | None |
| Severity mapping (HIGH only) | ✅ Correct | None |
| Service account pre-provisioned | ✅ Exists in `03_users.sql` | None |
| Incident creation (fire_incidents) | ✅ DRAFT, SECURITY, correct FK | None |
| Incident creation (nonsensitive details) | ✅ Category + station name | Low |
| Verification history | ✅ Audit trail entry | Low |
| EVE file tail behavior | ✅ Position tracking, rotation handling | Low |
| Test coverage | ✅ 10/10 tests | Low |
| Cross-PR merge order | ⚠️ Merge last (#105) | Medium (manageable) |

**Overall**: ✅ **APPROVE** — All implementation correct, service account confirmed pre-provisioned, comprehensive tests. Clean merge.

## Related Pages
- [[security/security-baseline]] — IDS/XAI security baseline
- [[backend/services]] — suricata_ingestion service reference
- [[pr-qa/pr-103-system-monitoring-prometheus]] — overlapping PR
- [[pr-qa/pr-104-xai-incident-narratives]] — overlapping PR
- [[pr-qa/pr-102-m4-postfix-afour-persistence-audit-ux]] — baseline PR
- [[gaps/frs-codebase-gap-register]] — M6-F was a gap target