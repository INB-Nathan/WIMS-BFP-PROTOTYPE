---
title: Architecture Refactor Phase 3 Regional Incident Lifecycle
created: 2026-05-23
updated: 2026-05-24
type: operations
tags: [wims-bfp, architecture, refactor, regional, incident-management, immutability, audit-log]
sources: [src/backend/api/routes/regional.py, src/backend/services/regional_incidents/lifecycle.py, src/backend/services/regional_incidents/policies.py, src/backend/services/duplicate_detection.py, system-wiki/subsystems/regional-dashboard.md, system-wiki/subsystems/validator-hub.md]
status: completed
---

# Architecture Refactor Phase 3 Regional Incident Lifecycle

Prerequisite: [[plans/architecture-refactor-phase-2-afor-commit-extraction]]
Next phase: [[plans/architecture-refactor-phase-4-civilian-triage-workflow]]

## Purpose

Extract official `fire_incidents` lifecycle behavior from route handlers into a deeper Regional Incident Lifecycle Module.

The goal is locality for status transitions, audit/history, duplicate policy calls, immutable replacement ordering, and analytics sync.

## Goal

Create a Regional Incident Lifecycle Module whose command Interface owns official incident state transitions and required side effects, while existing regional endpoints keep the same request and response contracts.

Agents should stop this phase when status transitions and lifecycle side effects are centralized, not when `regional.py` is fully small or aesthetically clean.

## Completion Summary

Completed on 2026-05-24.

Created `src/backend/services/regional_incidents/`:
- `policies.py` centralizes lifecycle transition constants, including explicit encoder and validator transition matrices.
- `lifecycle.py` owns selected regional mutation commands: force-replace pending incident, withdraw pending submission, delete draft/rejected incident, submit for review, validator decision, bulk approve, and archive finalized incident.
- `__init__.py` exports the Module Interface used by the route Adapter.

`src/backend/api/routes/regional.py` now delegates the selected mutation endpoints to lifecycle commands while keeping auth/RLS dependencies and HTTP contracts in the route.

The Phase 3 compatibility decision is to preserve current behavior:
- Encoder submission writes `PENDING`.
- Validator queue defaults still include both `PENDING` and `PENDING_VALIDATION`.
- Validator lifecycle policy recognizes both pending statuses as awaiting-review inputs.

The refactor intentionally did not unify all duplicate rules. Manual submit/validator approval/bulk approval duplicate calls moved with the lifecycle commands; AFOR duplicate behavior remains in `services.afor_import`.

## Proposed Module Shape

Created:
- `src/backend/services/regional_incidents/policies.py`
- `src/backend/services/regional_incidents/lifecycle.py`
- `src/backend/services/regional_incidents/__init__.py`

Potential command Interface:
- `create_draft(command, actor)`
- `edit_draft_or_rejected(command, actor)`
- `submit_for_review(incident_id, actor, duplicate_decision)`
- `withdraw_submission(incident_id, actor)`
- `delete_encoder_incident(incident_id, actor)`
- `force_replace_pending(incident_id, command, actor)`
- `apply_validator_decision(incident_id, decision, actor)`
- `archive_finalized(incident_id, actor)`
- `bulk_approve(command, actor)`

## Invariants

- Route auth and RLS dependency seams remain unchanged.
- Status transition matrix becomes explicit.
- `PENDING` vs `PENDING_VALIDATION` compatibility is decided before changing behavior.
- IVH writes remain consistent for every lifecycle mutation.
- Analytics sync runs for the same state changes it runs for today.
- Immutable replacement ordering is preserved.

## Stop Criteria

Stop when:
- allowed and blocked transitions are represented in one lifecycle policy or transition matrix;
- selected regional mutation endpoints delegate to lifecycle commands instead of owning transition logic inline;
- IVH, audit, duplicate checks, reference numbers, immutable replacement ordering, and analytics sync remain covered by tests;
- `PENDING` / `PENDING_VALIDATION` compatibility is documented or resolved;
- AFOR import behavior remains stable after shared lifecycle changes;
- focused regional CRUD, immutable records, AFOR integration, and analytics sync tests pass or failures are documented;
- this page and [[system-wiki/log]] are updated with the completed extraction summary.

## Duplicate Policy

Do not unify all duplicate rules in this phase.

Keep separate Adapters or policy modes for:
- manual submit/verify
- AFOR import
- bulk approval
- UI preflight duplicate checks

The first target is naming and localizing the policy, not changing thresholds.

## Tests

Preserve:
- `src/backend/tests/integration/test_regional_crud.py`
- `src/backend/tests/test_immutable_records.py`
- `src/backend/tests/integration/test_regional_afor_unified_import.py`
- analyst/analytics sync tests that depend on verified incidents

Added:
- `src/backend/tests/test_regional_incident_lifecycle.py` for encoder and validator transition matrix coverage.

Preserved and reran:
- Docker `pytest tests/test_regional_incident_lifecycle.py tests/integration/test_regional_crud.py tests/test_immutable_records.py tests/integration/test_regional_afor_unified_import.py -q` -> 33 passed.
- Docker `pytest tests/integration/test_analytics_api.py tests/test_analyst_export.py tests/test_analyst_incidents_sql_contract.py -q` -> 23 passed.

## Risks

- High refactor risk due to audit, analytics, immutable SQL, encryption-adjacent persistence, and endpoint response contracts.
- Some tests set DB statuses directly; new Module-level tests should avoid bypassing the lifecycle Interface.
- Replacement language is overloaded today and must be made precise.

## Related

- [[subsystems/regional-dashboard]]
- [[subsystems/validator-hub]]
- [[gaps/frs-codebase-gap-register]]
- [[plans/architecture-refactor-phase-4-civilian-triage-workflow]]
