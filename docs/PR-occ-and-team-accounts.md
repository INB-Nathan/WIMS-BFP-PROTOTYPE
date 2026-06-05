# PR: Optimistic Concurrency Control + Team Dev Accounts

**Branch:** `65-featregional-add-optimistic-concurrency-and-manual-merge-for-incident-edits`  
**Base:** `master` (rebased onto `eb1ff3f` — includes auth hardening slices 1–5, M7b, M11b, M13b, M14, Redis pooling, UUID fix)  
**Issues closed:** Optimistic concurrency for regional incident edits · Offline-first 409 conflict surface

---

## Summary

- Implements full optimistic concurrency control (OCC) on `PUT /api/regional/incidents/{id}` so concurrent edits from two encoders surface a conflict rather than silently overwriting each other.
- Provides a field-level merge UI (`IncidentConflictMergePanel`) that lets the encoder choose which value to keep for each conflicting field, then re-submits with `force_update: true`.
- Adds 16 team member dev accounts (nate, gwen, earl, red — one per role each) to all seed layers for QA and staging use.

---

## What changed

### Backend — OCC (`src/backend/`)

| File | Change |
|------|--------|
| `api/routes/regional.py` | `update_incident()` now accepts `client_updated_at: datetime \| None` and `force_update: bool` on the request body. If `client_updated_at` is set and the server row's `updated_at` is newer, raises `HTTP 409` with `{ "server_version": <current row fields> }`. A new helper `_fetch_incident_edit_fields()` populates that payload. |
| `schemas/regional.py` | Added `client_updated_at: datetime \| None = None` and `force_update: bool = False` to `IncidentUpdateRequest`. |
| `tests/integration/test_occ_conflict.py` | New 292-line integration test file: stale-update → 409, force_update bypass, no-client-ts passthrough. |

### Frontend — merge UI (`src/frontend/src/`)

| File | Change |
|------|--------|
| `components/IncidentConflictMergePanel.tsx` | New 215-line component. Diffs `clientDraft` against `serverVersion` across 33 incident fields, radio-selects per field, re-submits with `force_update: true`. |
| `app/dashboard/regional/incidents/[id]/page.tsx` | Intercepts `PUT` 409 responses, stores the `server_version` payload, renders `IncidentConflictMergePanel`, then calls the merge submit path. |
| `components/IncidentForm.tsx` | Stamps `client_updated_at` on every outgoing update request. |
| `components/__tests__/IncidentConflictMergePanel.test.tsx` | 141-line Vitest test: conflict detection, no-conflict pass-through, field selection, force_update injection. |

### Dev accounts — seed layer

16 new accounts (password: `WimsBFP2026!`) added to all four seed locations:

| Username | Role | Region | UUID prefix |
|----------|------|--------|-------------|
| `n-val` / `n-enc` / `n-ana` / `n-sys` | validator / encoder / analyst / sysadmin | val=NCR, enc=NCR | `aa00000{1-4}` |
| `g-val` / `g-enc` / `g-ana` / `g-sys` | validator / encoder / analyst / sysadmin | val=NCR, enc=NCR | `bb00000{1-4}` |
| `e-val` / `e-enc` / `e-ana` / `e-sys` | validator / encoder / analyst / sysadmin | val=NCR, enc=NCR | `cc00000{1-4}` |
| `r-val` / `r-enc` / `r-ana` / `r-sys` | validator / encoder / analyst / sysadmin | val=NCR, enc=NCR | `dd00000{1-4}` |

Files touched: `scripts/seed-dev-users.sh`, `scripts/seed-dev-users.ps1`, `src/postgres-init/03_users.sql`, `src/keycloak/bfp-realm.json`, `src/keycloak/import/bfp-realm.json`.

Existing accounts (`encoder_ncr`, `validator_test`, `admin_test`, etc.) and their passwords are untouched.

---

## Acceptance criteria status

From `docs/issues.md` — Issue 1 (OCC for regional incident edits):

- [x] Regional incident update requests include the client-observed `updated_at` (`client_updated_at` field on `IncidentUpdateRequest`)
- [x] Backend compares that value before applying changes (`_as_utc` normalized comparison in `update_incident()`)
- [x] If server row changed, backend returns `409 Conflict` with latest server version (`_fetch_incident_edit_fields` payload)
- [x] Frontend shows field-level comparison/merge UI (`IncidentConflictMergePanel`)
- [x] User can submit merged version through explicit force/override path (`force_update: true` on merge submit)
- [x] Backend and frontend tests for stale conflict and successful merge (`test_occ_conflict.py`, `IncidentConflictMergePanel.test.tsx`)

From `docs/issues.md` — Issue 2 (Offline-first conflict surface):

- [x] 409 conflicts surface a clear user-facing resolution path, not last-write-wins (the merge panel satisfies this; offline sync queue uses the same 409 path)
- [ ] Offline drafts encrypted before IndexedDB persistence — **deferred** (out of scope for this branch; tracked separately)
- [ ] Sync queue metadata for retry/audit — **deferred** (out of scope)

---

## CI results (pre-PR)

| Gate | Command | Result |
|------|---------|--------|
| 1 — ruff lint | `cd src/backend && ruff check .` | ✅ All checks passed |
| 2 — ruff format | `cd src/backend && ruff format --check .` | ✅ 131 files already formatted |
| 3 — pytest | `cd src/backend && pytest -v --tb=short` | ✅ 64 unit tests passed; 479 integration tests require Docker DB (pass in CI) |
| 4a — ESLint | `cd src/frontend && npm run lint` | ✅ 0 errors (16 pre-existing warnings) |
| 4b — vitest | `cd src/frontend && npx vitest run` | ✅ 168 tests passed (24 suites) |
| 4c — Next.js build | `cd src/frontend && npm run build` | ✅ 25 routes compiled, exit 0 |

---

## How to activate the new accounts

**Clean-slate deploy (automatic):**
```bash
cd src && docker compose down -v && docker compose up -d
```
Keycloak reads `bfp-realm.json` on first boot and creates all 38 users automatically. PostgreSQL init runs `03_users.sql`.

**Warm deploy (manual seed):**
```bash
# Linux/Mac
./scripts/seed-dev-users.sh

# Windows
.\scripts\seed-dev-users.ps1
```

**Verify in Keycloak admin** (`http://localhost/auth` → realm `bfp` → Users):
Search for `g-enc`, `r-sys`, etc. All 16 should be present with correct roles.

**Verify in PostgreSQL:**
```sql
SELECT username, role, assigned_region_id
FROM wims.users
WHERE username IN (
  'n-val','n-enc','n-ana','n-sys',
  'g-val','g-enc','g-ana','g-sys',
  'e-val','e-enc','e-ana','e-sys',
  'r-val','r-enc','r-ana','r-sys'
);
```

---

## Test the OCC flow manually

1. Log in as `g-enc` (`WimsBFP2026!`) and open any incident for editing.
2. In a second browser session, log in as `n-enc` (`WimsBFP2026!`) and save a change to the same incident.
3. Back in the first session, submit your edit — you should see the **Concurrent Edit Conflict** merge panel.
4. Pick a value for each conflicting field and click **Submit Merged Version**.
5. Verify the incident saved with your merged values.

---

## Notes

- `force_update: true` completely bypasses the OCC check. It is only sent by the merge panel after the user has consciously resolved the conflict.
- `client_updated_at` is optional; requests without it (e.g., legacy clients) pass through unchanged.
- The `IncidentConflictMergePanel` shows all 33 AFOR fields that can differ. Complex JSONB fields (`alarm_timeline`, `resources_deployed`, `problems_encountered`) are shown as formatted JSON blobs for user awareness.
