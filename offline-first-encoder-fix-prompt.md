# PR Fix Prompt — `feat/offline-first-encoder`

You are fixing PR branch `feat/offline-first-encoder` for merge into `origin/master`. Work directory: `/home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder/`. Diff saved at `/home/xynate/WIMS-BFP-NEW/pr-review-reports/branch-feat-offline-first-encoder.diff`. Full review at `/home/xynate/WIMS-BFP-NEW/pr-review-reports/branch-feat/offline-first-encoder-review.md`.

Do NOT commit. Leave all changes staged. After each batch run CI:

```bash
cd /home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder/src/backend && ruff format . && ruff check . && pytest -v --tb=short
cd /home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder/src/frontend && npm run lint && npx vitest run
```

---

## Step 1 — Read the diff and review report

```bash
cd /home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder
git diff --stat origin/master...HEAD
```

```bash
bat /home/xynate/WIMS-BFP-NEW/pr-review-reports/branch-feat-offline-first-encoder.diff
bat /home/xynate/WIMS-BFP-NEW/pr-review-reports/branch-feat/offline-first-encoder-review.md
```

---

## Step 2 — Read every file and line referenced by the findings

Read these exact locations (read tool, not bash). Capture the code at each line plus 5 lines context before and after:

| File | Lines | Why |
|------|-------|-----|
| `src/frontend/src/lib/syncEngine.ts` | 65–95, 200–215 | `as never` cast (76), DELETE body hack (208), 500→offline (89) |
| `src/frontend/src/lib/connectivity.ts` | 105–115 | `__resetConnectivityForTests` export (111) |
| `src/frontend/src/lib/offlineStore.ts` | 210–225 | redundant put+delete (216-217) |
| `src/frontend/src/lib/api/offlineRegional.ts` | 20–40, 85–100 | isNetworkError def (27), silenced catch (89-92) |
| `src/frontend/src/components/IncidentForm.tsx` | 68–80, 385–400 | isNetworkError def (73), dead base64ToBlob (390-397) |
| `src/frontend/src/app/afor/import/page.tsx` | 44–54 | isNetworkError def (49) |
| `src/backend/api/routes/regional/encoder_crud.py` | 70–110, 94–100 | no UUID validation (74-105), duplicate info_schema query (77,98) |
| `src/backend/api/routes/incidents.py` | 155–245 | non-atomic SELECT-then-INSERT (161-169, ~239) |
| `src/backend/main.py` | 160–175, 280–295 | hardcoded password (168), ruff format violations (286-289) |

Read test files for pattern reference:

| File | Lines | Why |
|------|-------|-----|
| `src/backend/tests/test_upload_bundle_idempotency.py` | all | pattern for new idempotency test |
| `src/backend/tests/test_celery_task_registration.py` | all | weak single assertion (5-12) |
| `src/frontend/src/lib/__tests__/offlineRegional.test.ts` | all | only 2 cache tests |
| `src/frontend/src/lib/__tests__/offlineStore.ops.test.ts` | all | only 3/15 ops tested directly |
| `src/frontend/src/lib/auth-refresh.test.ts` | all | missing success path |
| `src/frontend/src/lib/__tests__/useNetworkStatus.test.ts` | all | act() warnings in 6 tests |

Read configs:

```bash
bat src/backend/pyproject.toml
bat src/frontend/eslint.config.mjs
bat src/frontend/vitest.config.ts
```

---

## Step 3 — Fix findings in dependency order

### Batch A — Independent (no code deps between these)

**Fix 1 — Remove Keycloak demo OTP provider** (scope creep + hardcoded `123123` bypass)

```bash
cd /home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder
git rm -rf src/keycloak/demo-otp-provider/
```

Then revert `src/docker-compose.yml` Keycloak image from `wims-keycloak-demo-otp:local` back to the original base image. Check the diff to find the exact old image name. Also revert `src/keycloak/Dockerfile` if it was only for the demo provider.

**Fix 2 — ruff format 3 backend files**

```bash
cd /home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder/src/backend
ruff format api/routes/incidents.py
ruff format api/routes/regional/encoder_crud.py
ruff format main.py
```

**Fix 3 — Extract isNetworkError to shared lib**

Read each file at the specified line, verify the function bodies are identical, then:

Create `src/frontend/src/lib/network-utils.ts`:

```typescript
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.message.includes('fetch'));
}
```

In each of these 3 files, replace the local function definition with an import:

- `src/frontend/src/components/IncidentForm.tsx:73` — delete function, add `import { isNetworkError } from '@/lib/network-utils';`
- `src/frontend/src/lib/api/offlineRegional.ts:27` — same
- `src/frontend/src/app/afor/import/page.tsx:49` — same

**Fix 4 — Remove dead code base64ToBlob**

Edit `src/frontend/src/components/IncidentForm.tsx` to delete lines 390-397 (the `base64ToBlob` function).

**Fix 5 — Guard test-only export with import.meta.env.TEST**

Edit `src/frontend/src/lib/connectivity.ts` line 111:

```typescript
if (import.meta.env.TEST) {
  export function __resetConnectivityForTests(state: ConnectivityState = 'checking') {
    ...
  }
}
```

(Or wrap the function body / export conditionally to tree-shake in production.)

**Fix 6 — Remove redundant put+delete in offlineStore.ts**

Edit `src/frontend/src/lib/offlineStore.ts:216-217`. Currently:

```typescript
await store.put(item);   // line 216 — sets status=synced
await store.delete(id);  // line 217 — immediately removes it
```

Fix: Remove line 216, keep line 217 with a comment.

**Fix 7 — Unsilence IndexedDB errors in offlineRegional.ts**

Edit `src/frontend/src/lib/api/offlineRegional.ts:89-92`. Replace `.catch(() => {})` with:

```typescript
.catch(err => console.warn('IndexedDB cache write failed:', err))
```

**Fix 8 — Cache information_schema query in encoder_crud.py**

Edit `src/backend/api/routes/regional/encoder_crud.py`. Cache the column-existence boolean in a module-level variable after first query. Check at lines 77 and 98 where `information_schema.columns` is queried.

**Fix 9 — Wrap act() in useNetworkStatus tests**

Edit `src/frontend/src/lib/__tests__/useNetworkStatus.test.ts`. Wrap state-updating assertions in `act()` or `waitFor()` at lines ~56, 84, 101, 118, 142, 192.

**RUN CI GATES** after Batch A.

### Batch B — encoder_crud / incidents.py changes

**Fix 10 — Hardcoded DB password in main.py:168**

Edit `src/backend/main.py:168`. Replace:

```python
CREATE ROLE wims_app_user LOGIN PASSWORD 'wimsapp' INHERIT;
```

With:

```python
import os
db_password = os.environ.get("DB_PASSWORD")
if not db_password:
    raise RuntimeError("DB_PASSWORD environment variable is required")
CREATE ROLE wims_app_user LOGIN PASSWORD :db_password INHERIT;
```

(Adapt to the actual async query pattern used in that file — may need parameterized query instead of string interpolation.)

**Fix 11 — Add UUID validation before SQL ::uuid cast**

Edit `src/backend/api/routes/regional/encoder_crud.py`. Before line 105 (`:cid::uuid`), add:

```python
from uuid import UUID

...

if client_id:
    try:
        UUID(client_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid client_id format")
```

**Fix 12 — Make SELECT-then-INSERT atomic in incidents.py**

Edit `src/backend/api/routes/incidents.py:161-169,~239`. Wrap the client_id check SELECT and the subsequent INSERT in a database transaction, or use `INSERT ... ON CONFLICT (client_id) DO NOTHING RETURNING incident_id`.

**RUN CI GATES** after Batch B.

### Batch C — syncEngine.ts type safety

**Fix 13 — Discriminated union return type for apiFetch**

This is the most impactful fix. In `src/frontend/src/lib/syncEngine.ts`:

1. Define a type at the top of the file:

```typescript
type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error?: string };
```

2. Change the `apiFetch` return type from `Promise<{ ok: boolean; status: number; body: T }>` to `Promise<ApiResult<T>>`.

3. Replace the catch block at line 76: instead of `return { ok: false, status: 0, error: ... } as never;`, use `return { ok: false, status: 0, error: ... };` (no cast needed now).

4. Find all callers that currently cast with `as unknown as { error: string }` and update them to narrow on `result.ok`:

```typescript
if (!result.ok) {
  // handle error — result.error is available
  return;
}
// handle success — result.body is available
```

**Fix 14 — Remove hack on DELETE body**

Find the DELETE call at ~line 208 in `src/frontend/src/lib/syncEngine.ts`. Remove `body: undefined as unknown as string`. Use just `{ method: 'DELETE' }`.

**RUN CI GATES** after Batch C.

### Batch D — Add missing tests

**Fix 15 — New test: encoder_crud client_id idempotency**

Create `src/backend/tests/test_encoder_crud_idempotency.py`. Model on `src/backend/tests/test_upload_bundle_idempotency.py`. Test: `POST /api/regional/incidents` with duplicate `client_id` returns the existing incident (HTTP 200), not a new one.

**Fix 16 — Strengthen celery registration test**

Edit `src/backend/tests/test_celery_task_registration.py` lines 5-12. Add:

```python
assert len(scheduled - registered) == 0, f"Tasks not registered: {scheduled - registered}"
```

**Fix 17 — Add offlineRegional test coverage**

Edit `src/frontend/src/lib/__tests__/offlineRegional.test.ts`. Add tests for:

- `fetchRegionalIncidentsOfflineAware` list endpoint
- Online success path (fetch from API then cache write)
- Concurrent encoder cache isolation

**Fix 18 — Add auth-refresh success path test**

Edit `src/frontend/src/lib/auth-refresh.test.ts`. Add test for fetch returning 200 with tokens → `{ ok: true, tokens }`.

**Fix 19 — Add offlineStore ops test coverage**

Edit `src/frontend/src/lib/__tests__/offlineStore.ops.test.ts`. Add direct tests for: `getPendingOps`, `markOpSyncing`, `purgeSyncedOps`, `cacheIncident`.

**RUN CI GATES** after Batch D.

---

## Step 4 — Final CI sweep

```bash
cd /home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder/src/backend && ruff check . && ruff format --check . && pytest -v --tb=short
cd /home/xynate/WIMS-BFP-NEW/pr-worktrees/feat-offline-first-encoder/src/frontend && npm run lint && npx vitest run
```

If any failure, fix it and re-run.

---

## Mergeable checklist

- [ ] `ruff check .` passes
- [ ] `ruff format --check .` passes
- [ ] `pytest -v --tb=short` passes
- [ ] `npm run lint` passes
- [ ] `npx vitest run` passes
- [ ] No hardcoded credentials (`wimsapp`, `123123`) in any source file
- [ ] No `as never` or `as unknown as` casts in `syncEngine.ts`
- [ ] No build artifacts (`target/`) tracked in git
- [ ] `isNetworkError` deduplicated to `@/lib/network-utils.ts`
- [ ] UUID validated before SQL `::uuid` cast in `encoder_crud.py`
- [ ] SELECT-then-INSERT in `incidents.py` wrapped in transaction or ON CONFLICT
- [ ] Keycloak demo OTP provider directory removed
- [ ] Dead code `base64ToBlob` removed from `IncidentForm.tsx`
