# Design: Add Authentication to `GET /api/operations`

**Date:** 2026-06-23
**Issue:** `/api/operations` public read gap (handoff from PR #448)

## Problem

`GET /api/operations` has no authentication gate. Any unauthenticated
user can list all fire operations (location, status, size, coordinates,
linked citizen report IDs). The five mutation endpoints (POST/PATCH/DELETE
and link/unlink) already require `NATIONAL_VALIDATOR` role via
`Depends(get_national_validator)` + `Depends(get_db_with_rls)`.

The frontend caller (`/app/home/page.tsx` → `fetchOperations()` in
`lib/api/operations.ts`) is the authenticated Operations Board — it always
runs behind the `useAuth()` gate and `apiFetch()` already attaches JWT
tokens. The public DMZ at `/api/v1/public/report` does not consume this
endpoint.

## Solution

Change the `GET /api/operations` handler from `Depends(get_db)` to
`Depends(get_db_with_rls)`. The auth chain is:

    get_db_with_rls → get_current_wims_user → get_current_user (JWT validation)

Any authenticated WIMS user can read operations — no role restriction.
This matches the `/api/dashboard/widgets` pattern used elsewhere.

### Files Changed

| File | Change |
|------|--------|
| `src/backend/api/routes/operations.py` | `list_operations` signature: replace `Depends(get_db)` with `Depends(get_db_with_rls)` (already imported) |
| `src/backend/tests/test_operations.py` | Update 4 GET tests to mock `get_db_with_rls` + `get_current_wims_user`; update docstring/comment |

### Not Changed

- **DB / RLS:** No DB changes. The `wims.operations` SELECT policy is
  `USING (TRUE)` — open to all DB sessions. RLS enforcement is a future
  concern.
- **Frontend:** No changes. `apiFetch` already sends auth tokens.
- **Other routes:** No changes to mutation endpoints.
- **No new dependencies.**

### Test Updates

Test class `TestListOperations` + `TestMapFields.test_list_operations_returns_map_fields`:

- Override `get_db_with_rls` instead of `get_db`
- Add `app.dependency_overrides[auth.get_current_wims_user] = _mock_validator`
- Docstring line `— public read (no auth required)` → `— authenticated, any WIMS user`

## Verification

1. `cd src/backend && python -m pytest tests/test_operations.py -v` — all tests pass
2. `cd src/backend && ruff check api/routes/operations.py tests/test_operations.py`
3. `cd src/backend && ruff format . --check`
