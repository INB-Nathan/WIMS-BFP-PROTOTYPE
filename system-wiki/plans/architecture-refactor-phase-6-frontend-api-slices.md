---
title: Architecture Refactor Phase 6 Frontend API Slices
created: 2026-05-23
updated: 2026-05-24
type: operations
tags: [wims-bfp, architecture, refactor, frontend, api-client, public-dmz]
sources: [src/frontend/src/lib/api.ts, src/frontend/src/lib/validator-api.ts, src/frontend/src/lib/api.test.ts, system-wiki/frontend/frontend-infrastructure.md]
status: completed
---

# Architecture Refactor Phase 6 Frontend API Slices

Prerequisite: [[plans/architecture-refactor-phase-5-analytics-query-interface]]

## Purpose

Split the 1,616-line frontend `api.ts` Module into deeper domain API Client Slices while preserving old imports through a compatibility seam.

## Goal

Create domain-specific frontend API slices over shared authenticated and public transport Modules, while preserving existing caller behavior through compatibility exports during migration.

Agents should stop this phase when the planned slices exist, critical callers have migrated, and compatibility exports keep unmigrated imports working.

## Completion Summary

Completed on 2026-05-24.

Created `src/frontend/src/lib/api/`:
- `transport.ts` owns authenticated cookie transport, refresh retry, auth redirect, FormData handling, `ApiRequestError`, and JSON error extraction.
- `public-transport.ts` owns zero-auth public requests with `credentials: 'omit'`.
- `errors.ts` re-exports transport error utilities.
- `admin.ts`, `analytics.ts`, `civilian.ts`, `reference.ts`, `regional.ts`, `triage.ts`, and `validator.ts` provide domain API slice export surfaces.
- `legacy.ts` temporarily retains implementation during migration.
- `index.ts` exports the compatibility surface from the slices.

`src/frontend/src/lib/api.ts` is now a compatibility barrel that re-exports `./api/index`. New code should import from domain slices, while existing `@/lib/api` imports continue to work.

Public civilian functions now call `publicApiFetch`, keeping public report, append, tracking, duplicate suggestion, nearest station, and notification calls on `credentials: 'omit'`.

## Proposed Module Shape

Create:
- `src/frontend/src/lib/api/transport.ts`
- `src/frontend/src/lib/api/public-transport.ts`
- `src/frontend/src/lib/api/errors.ts`
- `src/frontend/src/lib/api/reference.ts`
- `src/frontend/src/lib/api/admin.ts`
- `src/frontend/src/lib/api/regional.ts`
- `src/frontend/src/lib/api/validator.ts`
- `src/frontend/src/lib/api/triage.ts`
- `src/frontend/src/lib/api/civilian.ts`
- `src/frontend/src/lib/api/analytics.ts`
- `src/frontend/src/lib/api/index.ts`

Keep `src/frontend/src/lib/api.ts` as a compatibility barrel during migration.

## Migration Order

1. Extract authenticated transport with no behavior change.
2. Extract public transport for zero-auth requests.
3. Extract civilian public API slice.
4. Extract analytics slice.
5. Extract triage/validator slices and reconcile `validator-api.ts`.
6. Extract regional/admin/reference slices.
7. Reduce or remove compatibility exports after callers migrate.

## Invariants

- Public civilian requests keep `credentials: 'omit'`.
- Authenticated requests keep cookie credentials, refresh retry, and redirect behavior.
- Existing silent fallback behavior (`[]` / `null`) remains unchanged unless explicitly fixed.
- FormData handling for AFOR import remains unchanged.
- Export download blob behavior remains unchanged.

## Stop Criteria

Stop when:
- authenticated transport and public transport are separate Modules;
- public civilian functions use public transport and never authenticated `apiFetch`;
- analytics, civilian, triage/validator, regional, admin, and reference API calls are grouped into domain slices or intentionally left in a documented compatibility layer;
- `src/frontend/src/lib/api.ts` is either a compatibility barrel or has a documented remaining responsibility;
- existing frontend tests pass or failures are documented;
- import churn is limited to the active slice migration scope;
- this page and [[system-wiki/log]] are updated with the completed extraction summary.

## Tests

Preserve:
- `src/frontend/src/lib/api.test.ts`
- report/tracking tests
- triage page tests
- analyst dashboard tests
- analytics component tests

Add:
- public transport tests
- compatibility export smoke test
- test that public civilian functions do not call authenticated `apiFetch`
- validator slice tests for queue params, verification actions, archive, and force paths

Completed verification:
- `npx vitest run src/lib/api.test.ts` -> 27 passed, including compatibility export smoke coverage and public civilian `credentials: 'omit'` behavior.
- Focused frontend suite `npx vitest run src/lib/api.test.ts src/app/incidents/triage/page.test.tsx src/app/report/tracking/page.test.tsx src/components/CalmEmergencyBlock.test.tsx src/app/dashboard/analyst/page.test.tsx` -> 41 passed with one existing React warning about `fill`.
- `npm run lint` -> 0 errors, 16 existing warnings.
- `npm run build` -> successful production build; Next.js skipped type validation per project config and emitted the existing multiple-lockfile root warning.

## Risks

- Import churn is large because many files import from `@/lib/api`.
- Moving DTOs can create circular imports.
- Public DMZ posture can regress if public calls accidentally use authenticated transport.
- `validator-api.ts` exists but is not the active Interface for the main validator page; migrate carefully.

## Related

- [[frontend/frontend-infrastructure]]
- [[security/security-baseline]]
- [[plans/architecture-refactor-phase-5-analytics-query-interface]]
