# M6-D / FRS Module 4: Data Commit & Immutable Storage

**GitHub Issue:** #66
**Assignee:** Earl Justin Camama
**Priority:** High | **Status:** Done
**FRS Ref:** Module 4 Sections A, B

## What Already Exists (confirmed by code audit)
- wims.incident_verification_history table — created in 15_validator_workflow.sql
  Columns: history_id, target_type, target_id, action_by_user_id, previous_status, new_status, notes, action_timestamp
- verify_incident() in regional.py ~line 3279 — writes IVH row in same transaction as status update ✅
- Application-level 403 on editing VERIFIED incidents — exists in PUT /incidents ✅
- 17_immutable_records.sql — data_hash column, no_update_verified/no_delete_verified RULEs
- compute_incident_data_hash() inline function in verify_incident() and /correct endpoint
- PATCH /api/regional/incidents/{id}/correct — NSD partial update, hash recompute, IVH correction row, analytics sync
- 17a_fix_immutable_rule.sql — narrowed UPDATE rule (status changes only, does not block data_hash updates)
- 18_ivh_hash_chain.sql — old_data_hash, new_data_hash, corrected_fields columns on IVH
- 19_nsd_immutability_rules.sql — no_update_verified_nsd and no_delete_verified_nsd RULEs on incident_nonsensitive_details

## Status Terminology (CRITICAL — do not use PENDING_REVIEW)
- The DB CHECK constraint allows: DRAFT, PENDING, PENDING_VALIDATION, VERIFIED, REJECTED
- PENDING_REVIEW does not exist and will cause a DB constraint error
- verify_incident() uses _VALIDATOR_ACTION_MAP: accept→VERIFIED, pending→PENDING, reject→REJECTED

## Implementation Plan

### Step 1 — Write failing tests (wims-qa agent)
File: src/backend/tests/test_immutable_records.py
- test_verified_incident_has_data_hash — approve → data_hash is 64-char hex
- test_db_blocks_update_on_verified — raw SQL UPDATE on VERIFIED row → exception
- test_db_blocks_delete_on_ivh — raw SQL DELETE on IVH row → silently no-ops
- test_migration_idempotent — run 17_immutable_records.sql twice → no error

### Step 2 — Write migration (wims-db agent)
File: src/postgres-init/17_immutable_records.sql
- ALTER TABLE wims.fire_incidents ADD COLUMN IF NOT EXISTS data_hash VARCHAR(64)
- CREATE RULE to block UPDATE where OLD.verification_status = 'VERIFIED'
- CREATE RULE to block DELETE on wims.incident_verification_history

### Step 3 — Update verify_incident() (wims-backend agent)
File: src/backend/api/routes/regional.py
- Grep for verify_incident to find the exact location
- When action == "accept": compute SHA-256 hash of canonical incident JSON
- Store in incident.data_hash before db.commit()

## Success Criteria (all met — PRs #94 and #95 merged)
1. test_verified_incident_has_data_hash passes
2. test_db_blocks_update_on_verified passes
3. test_db_blocks_delete_on_ivh passes
4. test_migration_idempotent passes
5. pytest src/backend/tests/ -v — all existing tests still pass
6. Analyst dashboard shows verified incidents (confirms #84 fix)
