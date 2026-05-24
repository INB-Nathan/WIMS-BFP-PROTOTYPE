---
title: Architecture Refactor Phase 0 Safety Baseline
created: 2026-05-23
updated: 2026-05-24
type: operations
tags: [wims-bfp, architecture, refactor, testing, agent-routing]
sources: [AGENTS.md, system-wiki/mocs/system-map.md, system-wiki/operations/agent-routing-guide.md]
status: completed
parent_plan: [[plans/architecture-refactor-phase-1-afor-parser-extraction]], [[plans/architecture-refactor-phase-2-afor-commit-extraction]], [[plans/architecture-refactor-phase-3-regional-incident-lifecycle]]
baseline_completed: 2026-05-24
# Architecture Refactor Phase 0 Safety Baseline

Parent plan set: [[plans/architecture-refactor-phase-1-afor-parser-extraction]], [[plans/architecture-refactor-phase-2-afor-commit-extraction]], [[plans/architecture-refactor-phase-3-regional-incident-lifecycle]]

## Purpose

Establish the current behavior before extracting deeper Modules from `regional.py`, `triage.py`, `analytics_read_model.py`, and `src/frontend/src/lib/api.ts`.

This phase should not change production behavior. It creates the verification baseline used by later phases.

## Goal

Produce a written, reproducible baseline for the architecture refactor sequence: which checks currently pass, which are blocked by environment, and which drift decisions must be resolved before behavior-changing work starts.

Agents should stop this phase when the baseline is documented and no implementation files have changed.

## Scope

- Record focused backend and frontend test commands.
- Identify drift decisions that must be resolved before behavior-affecting refactors.
- Confirm existing dirty worktree state before edits.
- Preserve current endpoint Interfaces while future phases move Implementation behind deeper Modules.

## Baseline Checks

Backend checks:
- `cd src/backend && pytest tests/test_afor_import.py -v`
- `cd src/backend && pytest tests/integration/test_regional_afor_unified_import.py -v`
- `cd src/backend && pytest tests/integration/test_regional_crud.py -v`
- `cd src/backend && pytest tests/integration/test_triage_queue.py -v`
- `cd src/backend && pytest tests/integration/test_analytics_api.py tests/test_analyst_export.py tests/test_analyst_incidents_sql_contract.py -v`

Frontend checks:
- `cd src/frontend && npx vitest run src/lib/api.test.ts`
- `cd src/frontend && npx vitest run src/app/incidents/triage/page.test.tsx`
- `cd src/frontend && npx vitest run src/app/report/tracking/page.test.tsx src/app/report/CalmEmergencyBlock.test.tsx`
- `cd src/frontend && npx vitest run src/app/dashboard/analyst/page.test.tsx`

## Drift Decisions

Resolve or explicitly defer:
- Canonical regional incident review status: `PENDING` vs `PENDING_VALIDATION`.
- Civilian duplicate suggestion spatial rule: wiki mentions 500m, triage workflow uses 100m/1hr for related counts.
- Analytics top barangays: wiki/client documentation mention it, current inspected code did not show a matching endpoint/client.

## Baseline Results

All test commands executed 2026-05-24 inside the running Docker stack (`docker exec wims-backend pytest …` for backend; `npx vitest run` for frontend from host).

### Backend — All PASSED (119/119)

| Test file | Result | Duration |
|-----------|--------|----------|
| `tests/test_afor_import.py` | 13 passed | 1.72s |
| `tests/integration/test_regional_afor_unified_import.py` | 11 passed | 3.36s |
| `tests/integration/test_regional_crud.py` | 15 passed | 2.74s |
| `tests/integration/test_triage_queue.py` | 57 passed | 4.22s |
| `tests/integration/test_analytics_api.py` | 10 passed | — |
| `tests/test_analyst_export.py` | 8 passed | — |
| `tests/test_analyst_incidents_sql_contract.py` | 4 passed | — |

### Frontend — All PASSED (43/43)

| Test file | Result | Duration | Notes |
|-----------|--------|----------|-------|
| `src/lib/api.test.ts` | 26 passed | 1.85s | |
| `src/app/incidents/triage/page.test.tsx` | 6 passed | 4.40s | |
| `src/app/report/tracking/page.test.tsx` | 1 passed | 0.62s | stderr `fill` attribute warning (non-blocking) |
| `src/app/report/CalmEmergencyBlock.test.tsx` | 3 passed | 0.12s | |
| `src/app/dashboard/analyst/page.test.tsx` | 7 passed | 6.43s | |

### Failure Categorization

No failures to categorize. All tests pass.

### Environment Notes

- Backend tests must run **inside** the `wims-backend` container (`docker exec wims-backend pytest …`) — host Python lacks `jose`, `psycopg2`, and the Docker-backed DB session.
- Frontend tests run from the host with `npx vitest run` after `npm install`.
- Docker stack was up and healthy at time of execution (backend, celery, redis, postgres all healthy).

### Drift Decision Disposition

All three drift items are **deferred to later phases** — none block Phase 1:

1. **PENDING vs PENDING_VALIDATION** — deferred to Phase 3 (regional incident lifecycle). Phase 1/2 extraction is behavior-preserving and does not touch lifecycle state machines.
2. **Civilian duplicate spatial rule (500m vs 100m/1hr)** — deferred to Phase 4 (civilian triage). Phase 1/2 does not touch civilian reporting or triage code.
3. **top-barangays endpoint** — deferred to Phase 5 (analytics query interface). Phase 1/2 does not touch analytics routes.

## Exit Criteria

- [x] Current focused tests are run or documented as blocked by environment. → All 9 test commands executed; all pass.
- [x] Drift decisions are captured in the relevant later phase before implementation. → All 3 deferred to phases 1/3/4/5 with rationale.
- [x] No behavior changes are made in this phase. → Worktree confirmed clean of production-code edits (only wiki files touched).
- [x] [[system-wiki/log]] is appended when the baseline plan is changed. → This phase-0 page updated to `status: completed`; log entry appended.

## Stop Criteria

Stop when:
- [x] the focused test command list has been run or each skipped command has a clear reason; → All 9 commands executed; none skipped.
- [x] current failures are categorized as code regression, environment limitation, or pre-existing drift; → No failures.
- [x] no production code has been edited; → git status confirmed (only plan/wiki files are new/modified).
- [x] this page and [[system-wiki/log]] reflect the baseline outcome. → Page updated with results; log entry appended.

## Related

- [[mocs/system-map]]
- [[operations/agent-routing-guide]]
- [[backend/api-route-map]]
- [[frontend/frontend-infrastructure]]
