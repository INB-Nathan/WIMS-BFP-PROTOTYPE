---
title: Architecture Refactor Phase 2 AFOR Commit Extraction
created: 2026-05-23
updated: 2026-05-23
type: operations
tags: [wims-bfp, architecture, refactor, afor, regional, persistence, security]
sources: [src/backend/api/routes/regional.py, src/backend/tests/integration/test_regional_afor_unified_import.py, system-wiki/security/security-baseline.md]
status: completed
---

# Architecture Refactor Phase 2 AFOR Commit Extraction

Prerequisite: [[plans/architecture-refactor-phase-1-afor-parser-extraction]]
Next phase: [[plans/architecture-refactor-phase-3-regional-incident-lifecycle]]

## Purpose

Move AFOR commit behavior behind a command Interface while preserving `POST /api/regional/afor/commit`.

This phase extracts database-writing AFOR import Implementation but does not yet generalize the full regional incident lifecycle.

## Goal

Create a dedicated AFOR commit Module that owns validated-row persistence, import duplicate resolution, WGS84 validation, AFOR import audit/history, and analytics sync for AFOR-created incidents.

Agents should stop this phase when AFOR commit behavior is behind the new Module Interface and route behavior is unchanged.

## Proposed Module Shape

Create:
- `src/backend/services/afor_import/commit.py`
- `src/backend/services/afor_import/region_policy.py`

Own inside the AFOR Import Module:
- form-kind validation
- WGS84 validation
- import duplicate pre-check and row resolutions
- import batch creation
- structural AFOR persistence
- wildland AFOR persistence
- PII encryption call path
- incident verification history insert
- analytics sync after commit

## Interface

Target Interface:
- `commit_afor_import(db, actor, command) -> AforCommitResult`
- `validate_import_region(db, encoder_region_id, parse_result) -> None`

`regional.py` remains a thin Adapter for request parsing, auth dependencies, and HTTP response translation.

## Invariants

- `DUPLICATE_CHECK_REQUIRED` response remains unchanged.
- `incident_ids`, duplicate metadata, radius, and minimum matching fields remain unchanged.
- Manual wildland entry continues to pass `wildland_row_source = MANUAL`.
- PII remains stored only through the encrypted blob path where current behavior does so.
- RLS-backed DB session behavior remains unchanged.

## Stop Criteria

Stop when:
- `POST /api/regional/afor/commit` delegates to `services.afor_import.commit`;
- structural and wildland AFOR commits persist the same rows as before;
- duplicate-check-required, skip, merge, and force responses remain compatible;
- manual wildland commit still preserves `wildland_row_source = MANUAL`;
- focused AFOR, immutable-record, and regional CRUD smoke tests pass or failures are documented;
- no broader regional lifecycle commands are extracted in this phase;
- this page and [[system-wiki/log]] are updated with the completed extraction summary.

## Tests

Preserve:
- `src/backend/tests/integration/test_regional_afor_unified_import.py`
- `src/backend/tests/test_afor_import.py`
- immutable records tests that touch imported incidents

Add:
- command validation tests for missing rows, invalid coordinates, form-kind mismatch, and invalid wildland payload
- region policy alias and mismatch tests
- persistence tests at the new Module Interface

## Risks

- This phase touches security-sensitive encryption and audit side effects.
- Transaction ownership must remain explicit.
- Existing route response contracts are frontend-visible.
- Do not merge AFOR duplicate policy into manual incident duplicate policy yet; those rules differ today.

## Related

- [[security/security-baseline]]
- [[subsystems/regional-dashboard]]
- [[plans/architecture-refactor-phase-3-regional-incident-lifecycle]]
