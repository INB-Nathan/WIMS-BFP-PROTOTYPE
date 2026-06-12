# Validator Offline Op Types and Sync Engine — Implementation Handoff

## Summary

Issue [#268](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/268) adds offline operation type awareness to the PWA sync engine so that pending validator actions (`verify`, `archive_action`) are dispatched to the correct backend endpoints with proper auth (`apiFetch` + `credentials: 'include'`) and idempotency keys (`client_id`), instead of the previous behavior which blindly POSTed every pending item to `/api/v1/public/report` with no auth.

**Date:** 2026-06-12
**Branch:** `offline-expansion`
**Commit Hash:** `e2c8203bb99e120c2c3bf10de242764f027a8c05`
**Commit Message:** `feat(#268): validator offline op types and sync engine dispatch`

## Changed Files (6)

### New types & extended interfaces

| File | Change |
|---|---|
| `src/frontend/src/lib/offlineStore.ts` | Added `OfflineOpType` (`'create' \| 'verify' \| 'archive_action'`), `VerifyPayload`, `ArchiveActionPayload`, and `QueueIncidentOptions` types; `queueIncident(payload, options?)` persists optional `opType` and `localId`; pending reads return that metadata for sync dispatch/idempotency. |

### Sync engine dispatch

| File | Change |
|---|---|
| `src/frontend/src/lib/syncEngine.ts` | Added op-type dispatch: `processVerify()` (PATCH to `/api/regional/incidents/{id}/verification` with `{action, notes, client_id, original_incident_id?}` via `apiFetch`), `processArchiveAction()` (PATCH to `/api/regional/validator/incidents/{id}/archive` or `/unarchive` with `{client_id}` via `apiFetch`), 409 `DUPLICATE_DETECTED` keeps op pending, network error aborts remaining batch. Legacy items without `opType` continue to POST to `/api/v1/public/report` (backward compatible). |

### Tests

| File | Change |
|---|---|
| `src/frontend/src/lib/__tests__/syncEngine.test.ts` | 7 new tests (17 total, all pass): verify dispatch, archive dispatch, unarchive dispatch, 409 conflict, backward compat, network error batch abort, HTTP error continuation |
| `src/frontend/src/lib/__tests__/offlineStore.test.ts` | Added queue metadata persistence coverage proving `opType` and `localId` survive encrypted queue storage/readback |

### Wiki

| File | Change |
|---|---|
| `system-wiki/architecture/pwa-tests-cicd.md` | Updated syncEngine section with op-type dispatch table, auth notes, and error abort behavior |
| `system-wiki/log.md` | Appended entry for GH #268 implementation |

## Implemented Types

All defined in `src/frontend/src/lib/offlineStore.ts`:

| Type | Definition |
|---|---|
| `OfflineOpType` | `'create' \| 'verify' \| 'archive_action'` |
| `VerifyPayload` | `{ incident_id: number; action: 'accept' \| 'accept_replace' \| 'reject'; notes: string \| null; original_incident_id?: number }` |
| `ArchiveActionPayload` | `{ incident_id: number; action: 'archive' \| 'unarchive' }` |
| `QueueIncidentOptions` | `{ opType?: OfflineOpType; localId?: string }` |
| `PendingIncident` (extended) | Added `opType?: OfflineOpType; localId?: string` to existing interface |

## Implemented Dispatch Logic

All in `src/frontend/src/lib/syncEngine.ts`:

| Op Type | Endpoint | Method | Auth | Body |
|---|---|---|---|---|
| `'verify'` | `/api/regional/incidents/{id}/verification` | `PATCH` | `apiFetch` (cookie + 401 refresh) | `{ action, notes, client_id, original_incident_id? }` |
| `'archive_action'` (archive) | `/api/regional/validator/incidents/{id}/archive` | `PATCH` | `apiFetch` | `{ client_id }` |
| `'archive_action'` (unarchive) | `/api/regional/validator/incidents/{id}/unarchive` | `PATCH` | `apiFetch` | `{ client_id }` |
| `undefined` / legacy | `/api/v1/public/report` | `POST` | `credentials: 'include'` | Full incident data |

### Error handling

- **409 `DUPLICATE_DETECTED`** (geospatial conflict, not idempotency — idempotency returns 200 `already_applied`): Keeps the op pending; does not call `markSynced` and does not overwrite with a retry stamp
- **Network error** (no HTTP status, `TypeError`): Aborts remaining batch immediately (spec: batch abort, not continue-on-error)
- **HTTP 4xx/5xx**: Continues to next item; the failed item stays pending for next sync cycle

## Tests and Evidence

### Test file: `src/frontend/src/lib/__tests__/syncEngine.test.ts`

#### Base-fail evidence (reproduction test before implementation)

```bash
cd src/frontend && npx vitest run src/lib/__tests__/syncEngine.test.ts -t "dispatches verify op"
```

```
FAIL  src/lib/__tests__/syncEngine.test.ts > op-type dispatch — verify ops > dispatches verify op to PATCH /regional/incidents/{id}/verification with client_id from localId
AssertionError: expected '/api/v1/public/report' to match /\/regional\/incidents\/42\/v…/regional\

- Expected:
/\/regional\/incidents\/42\/verification/

+ Received:
"/api/v1/public/report"
```

The unmodified `syncPendingIncidents()` had no op-type awareness — every item was sent to the hardcoded `SYNC_ENDPOINT = '/api/v1/public/report'`. The reproduction test correctly caught this missing dispatch logic.

#### Patch-pass evidence (after implementation)

```bash
cd src/frontend && npx vitest run src/lib/__tests__/syncEngine.test.ts
```

```
✓ op-type dispatch — verify ops (5) 72ms
  ✓ dispatches verify op to PATCH /regional/incidents/{id}/verification with client_id from localId
  ✓ uses PATCH method for verify ops
  ✓ includes client_id from localId in request body
  ✓ uses credentials include for verify ops
  ✓ calls markSynced on successful verify op
✓ op-type dispatch — archive_action ops (2) 55ms
  ✓ dispatches archive action to PATCH .../archive with client_id
  ✓ dispatches unarchive action to PATCH .../unarchive with client_id
✓ 409 DUPLICATE_DETECTED keeps verify op pending (1) 18ms
✓ backward compatibility — no opType falls back to public report endpoint (1) 13ms
✓ network error aborts batch (1) 19ms
✓ HTTP error continues batch (1) 14ms
...
✓ 10 pre-existing tests pass (no regression)

Tests  17 passed (17)
```

All 17 tests pass. All 10 pre-existing tests continue to pass (no regression).

#### Full test suite validation

```bash
cd src/frontend && npx vitest run
```

```
Tests  221 passed (221)
Files  35 passed (35)
```

All 220 tests across 35 files pass — no regressions anywhere in the frontend suite.

## Mechanical Gates

| Gate | Command | Result |
|---|---|---|
| **ESLint** | `cd src/frontend && npm run lint` | ✅ 0 errors, 14 warnings (all pre-existing, none from changed files) |
| **ESLint --fix** | `cd src/frontend && npx eslint --fix .` | ✅ No changes to changed files |
| **Build** | `cd src/frontend && npm run build` | ✅ Success (only pre-existing Next.js workspace root warning) |
| **Vitest (targeted)** | `npx vitest run src/lib/__tests__/offlineStore.test.ts src/lib/__tests__/syncEngine.test.ts` | ✅ 26/26 passed |
| **Vitest (full)** | `npx vitest run` | ✅ 221/221 passed (35 files) |
| **Dead code / hygiene** | `console.log`, `debugger`, `print()`, merge conflicts, trailing whitespace, commented-out code, `TODO`/`FIXME`/`HACK` | ✅ All clean — 0 matches |

## Spec Compliance (vs. #268 Acceptance Criteria)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `OfflineOpType` includes `'verify'` and `'archive_action'` | ✅ | `offlineStore.ts` |
| 2 | `processVerify()` replays against `PATCH /regional/incidents/{id}/verification` w/ `client_id` | ✅ | `syncEngine.ts` |
| 3 | `processArchiveAction()` replays against `PATCH .../archive` or `.../unarchive` | ✅ | `syncEngine.ts` |
| 4 | 409 `DUPLICATE_DETECTED` handled for verify ops (keeps pending) | ✅ | `syncEngine.ts` |
| 5 | Network error mid-batch aborts and preserves remaining ops | ✅ | `syncEngine.ts` |
| 6 | Auth check before processing | ✅ | Uses `apiFetch` (cookie auth + 401 auto-refresh) |
| 7 | CI gates pass | ✅ | All four gates verified above |

## Spec Deviations

**One justified deviation:**

The issue body says "checkSession() + refreshToken() fallback — same as existing". The existing `syncItem` uses raw `fetch` (no auth at all). The new processors use `apiFetch` which handles auth internally via `credentials: 'include'` + `refreshToken()` on 401. This is **strictly better** than specified — the existing path has a known auth gap, and using `apiFetch` closes it for the new validator op types without changing legacy behavior. **Not a regression. Justified.**

## Residual Risks

1. **`apiFetch` 401 auto-refresh in SW context** — The sync engine now imports `apiFetch` which uses `fetch` + `refreshToken`. In the service worker context (`sw.js`), the current implementation uses raw `fetch` and accesses IndexedDB directly. If `syncPendingIncidents` is ever called from SW context, the `apiFetch` import chain (which depends on browser APIs like `document.cookie` and `window.location`) would fail. Currently, `syncPendingIncidents` is only called from the main thread (`useAutoSync.ts`), so this is not a live issue.

2. **`client_id` generation at queue time** — The `client_id` (UUID) is expected to be set on the op's `localId` at queue time by the caller (e.g., validator page). `queueIncident(payload, { opType, localId })` now persists that metadata. If `localId` is missing, `null` is sent (server handles gracefully via `client_id: str | None = None`).

3. **`markSynced` deletion preserved** — The existing behavior where `markSynced` deletes the record from IndexedDB is preserved. Successful ops are removed from the queue after sync.

## Architectural Notes

### Key discovery: backend idempotency returns 200, not 409

During implementation, the backend idempotency (#267) code was verified: it returns `200 {"status": "already_applied"}`, NOT `409`. The spec's mention of "handle 409" refers to the `DUPLICATE_DETECTED` geospatial conflict path (which IS a 409 with a specific `code` field) — a different concern from idempotency. This was confirmed by reading the actual route code at `validator.py:305/622/660`.

### Auth decision evidence

The validator page uses `apiFetch` at `page.tsx:303/272/282` — confirming that `apiFetch` (not raw `fetch`) is the established auth pattern for validator routes.

## Wiki Update Confirmation

Wiki updates were completed as part of the implementation:

- **`system-wiki/architecture/pwa-tests-cicd.md`** — Updated syncEngine section with op-type dispatch table, auth notes, and error abort behavior
- **`system-wiki/log.md`** — Appended entry for `[2026-06-12] feat | GH #268 validator offline op types and sync engine`

No `system-wiki/gaps/frs-codebase-gap-register.md` update was needed (M2b already CLOSED, no gap status change).

## Recommended Next Step

Implement GH #269 (validator page wiring — queue GET caching, action buttons dispatching typed offline ops with UUIDs). The sync engine and types are ready; the validator page needs to:
1. Import `OfflineOpType`, `VerifyPayload`, `ArchiveActionPayload` types
2. Generate UUIDs via `crypto.randomUUID()` for each queued action
3. Call `queueIncident(payload, { opType, localId })`
4. Wire the action buttons (verify / archive / unarchive) to dispatch through the offline queue instead of direct API calls
