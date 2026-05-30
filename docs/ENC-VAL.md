# PR Draft — fix/enc-val-bugs-and-UI → master

**Title:** `fix(enc-val): Encoder/Validator bug fixes, archive mechanics, duplicate detection, CI`

**Base branch:** `master`
**Head branch:** `fix/enc-val-bugs-and-UI`

---
## Summary

End-to-end bug fix and hardening pass for the Regional Encoder and National Validator subsystems. Covers sidebar navigation, AFOR page crashes, RBAC enforcement, edit-mode submission hardening, duplicate detection, map UX, notification polling, auth refresh, dashboard stats scoping, archive mechanics (encoder + validator, including a PostgreSQL silent-no-op root cause fix), resubmit transaction rollback, live badge sync, and CI pipeline fixes.

### Sidebar / Navigation
- Fixed encoder sidebar: Activity Log nav no longer highlights Regional Dashboard as active
- Fixed validator sidebar: Audit Trail no longer highlights Validator Dashboard as active

### AFOR Page Crashes
- `/afor/create` and `/afor/import` crashed with "client-side exception" — fixed by wrapping exports in `<Suspense>` and moving `isOffline` to `useState` + `useEffect`

### RBAC Enforcement (first-login race)
- On first login `UserProfileProvider` stayed at `assignedRegionId=null` for the whole session; region guard was a no-op
- `callback/page.tsx` now calls `refreshProfile()` alongside `refreshSession()` post-OIDC callback
- `IncidentForm.tsx` region field now renders as a locked display (not a dropdown) with a loading state while profile loads

### Edit-Mode Submission Hardening
- Hidden "Auto-fill (Test)" button in edit mode so it can't overwrite real data
- Type-of-involved validation now requires both `type_of_involved_general_category` AND a resolved `incidentTypeCode` — fixes a legacy JSONB sub_category hydration gap that left `incident_type_code` null in the DB

### Duplicate Detection from IncidentForm
- Detail page now consumes `?pending_submit=1` query param (via `pendingSubmitOnceRef` + `useEffect`) to re-fire `handleSubmit`, triggering the 409 → duplicate modal automatically when navigated from IncidentForm

### Map / Address UX Fixes
- Removed `, Philippines` suffix from Nominatim search — improves street/barangay precision
- Re-pin from Address now clears lat/lon before re-geocoding to reset `autoSearchedRef` guard
- Barangay input: manual edits are protected from reverse-geocode overwrite via `barangayManuallySetRef`

### Duplicate Detection Redesign (5-criterion scoring)
- Replaced radius+day OR-logic with a 5-criterion scoring system (threshold: 3/5): distance ≤500 m, same category+type, same fire date, time within 1 hr, same city/municipality
- Candidate pool narrowed to ±3 days; all three `check_for_duplicate` call sites updated

### Notifications
- Validator poll interval reduced 30 s → 10 s for new submission detection
- Encoder dashboard: 20 s background poll detects validator actions and shows a dismissable banner

### Auth Refresh Race Fix
- `transport.ts` 401 handler was calling `fetch('/api/auth/refresh')` directly, bypassing `navigator.locks` dedup in `auth-refresh.ts`; race with proactive 4-min refresh caused Keycloak token revocation
- 401 handler now routes through `refreshToken()` from `auth-refresh.ts`

### Dashboard Stats Scoping + Date Filtering
- Encoder stats (`GET /api/regional/stats`): scoped to region + VERIFIED only (was per-encoder); added `date_from`/`date_to` params; wildland query fixed with LEFT JOIN on `nd`
- Validator stats (`GET /api/regional/validator/stats`): same date filter params; wildland LEFT JOIN fix; pending count intentionally unfiltered
- Both dashboards add date-period filter chips (Today / This Week / This Month / All Time)

### Map / Pin UX Follow-up
- Clear pin button now also clears `mapSearchQuery` so the map doesn't immediately re-geocode after clearing (previous behaviour was identical to Re-pin from Address)
- Barangay field now shows a hint below the label: "automatically filled when you pin the fire scene location on the map"
- ICP "Specify ICP Location" input is now cleared when the encoder switches the ICP radio from "with" to "without"

### Idle Logout / Progress Save
- `transport.ts` 401 handler saves `window.location.href` to `sessionStorage` before redirecting to `/login`; `callback/page.tsx` restores that URL after successful re-login so the encoder lands back where they were
- `IncidentForm.tsx` (create mode only): debounced 500 ms autosave of `formState` + coordinates to `localStorage`; on mount a restore banner offers to reload the last draft; draft cleared on successful submit
- `afor/import/page.tsx`: `previewData` (invalid-row parse results) persisted to `sessionStorage` on every change and restored on mount

### Archive View (Encoder Dashboard)
- `GET /api/regional/incidents` now accepts `archived=true` query param; backend filters `is_archived = TRUE` instead of the default `FALSE`
- Encoder dashboard pagination row: "See Archive" / "Hide Archive" toggle button; active archive view disables status/date filter chips and shows a distinct "Archived Incidents" heading

### Encoder Archive (Verified Incidents)
- New `PATCH /api/regional/incidents/{id}/archive` encoder endpoint — archives a VERIFIED incident owned by the encoder (`is_archived = TRUE`); returns 400 for non-VERIFIED statuses (DRAFT/REJECTED use the existing DELETE endpoint)
- Encoder dashboard card view: "Archive" button appears at the bottom of VERIFIED cards (hidden in archive view)
- Encoder dashboard table view: new "Actions" column with "Archive" button for VERIFIED rows; colSpan updated for loading/empty states; hidden in archive view
- Archive error banner shown above the incident list when the call fails

### Validator Archive Mechanics — Root Cause Fix
- **Root cause of archive no-op**: PostgreSQL rule `no_update_verified` (migration 17, patched in 29) used `DO INSTEAD NOTHING` to block all updates to VERIFIED rows — including `UPDATE ... SET is_archived = TRUE`. The call returned 200 with no error but no row was changed.
- New migration `src/postgres-init/41_fix_immutable_rule_for_archive.sql` narrows the rule: blocks all updates to VERIFIED rows **except** `VERIFIED→REPLACED` and `is_archived FALSE→TRUE` transitions. **Apply to running containers**: `docker compose exec -T postgres psql -U postgres -d wims < src/postgres-init/41_fix_immutable_rule_for_archive.sql`
- `VALIDATOR_ARCHIVABLE_STATUSES` expanded to `("VERIFIED", "REPLACED", "REJECTED")` — rejected incidents can now be soft-archived (is_archived = TRUE, record preserved and viewable in archive)
- Validator "Accepted" / "Rejected" filter chips now reset dateFilter to "all" so finalized incidents from any date are always reachable — fixes the case where VERIFIED incidents were invisible in the default "today" date window
- Archive view fixed: replaced broken `setStatusFilter("ARCHIVED")` with `isArchiveView` boolean toggle; passes `archived=true&show_all=true` to the backend
- Archive view shows Delete button (hard-delete) instead of Archive button; normal view shows Archive button for VERIFIED/REPLACED/REJECTED
- New `DELETE /api/regional/validator/incidents/{id}` endpoint hard-deletes archived incidents and their child rows in FK-safe order
- Replaced incidents (`verification_status = 'REPLACED'`) are shown in archive with purple badge (no separate column — status itself serves as the indicator)

### Resubmit Transaction Rollback Fix
- **Root cause**: `submit_incident_for_review_command` unconditionally included `is_resubmitted = TRUE` in the SQL when resubmitting a REJECTED incident. On containers where `40_add_resubmitted_flag.sql` was not yet applied (existing containers, fresh without migration), this caused a `psycopg2.errors.UndefinedColumn` → transaction rollback → 500.
- Fix: `_lc_has_resubmitted_column(db)` helper added to `lifecycle.py` (module-level cache, same pattern as `regional.py`). `is_resubmitted = TRUE` is only included in the UPDATE when the column exists. Resubmit now works on both old and new containers.
- **Apply column to running containers**: `docker compose exec -T postgres psql -U postgres -d wims -c "ALTER TABLE wims.fire_incidents ADD COLUMN IF NOT EXISTS is_resubmitted BOOLEAN NOT NULL DEFAULT FALSE;"`

### Stale Duplicate Flag on Resubmit
- **Root cause**: When a REJECTED incident had `is_duplicate = TRUE` from its original submission, resubmitting never cleared the flag. `already_flagged = True` caused both the normal duplicate check (`if not force and not already_flagged`) and the force/ack path (`if (ack_duplicate or force) and not already_flagged`) to be skipped entirely. The main UPDATE only set `verification_status = 'PENDING'` — `is_duplicate` stayed `TRUE`. The validator queue showed the DUPLICATE badge even after the encoder changed the date, time, and coordinates.
- **Fix** (`lifecycle.py`): `is_resubmission = current_status == "REJECTED"` flag added. When True, `already_flagged` is reset to `False` before the checks, forcing a fresh duplicate check on every resubmit. The main UPDATE also now includes `is_duplicate = FALSE, duplicate_of = NULL` when it's a resubmission and no new duplicate was matched (i.e., the encoder genuinely resolved the issue).
- The fresh check still raises 409 if the incident is still a near-duplicate (encoder didn't change enough); encoder can then force-submit or edit further.

### Validator Archive — Self-Healing Startup Patch
- **Root cause of archive no-op** (same as before): PostgreSQL rule `no_update_verified` silently swallows the `is_archived = TRUE` UPDATE. Migration `41_fix_immutable_rule_for_archive.sql` was created to fix this but only runs on first boot — existing containers were not patched.
- **Fix** (`main.py`): Added `@app.on_event("startup")` hook `apply_schema_patches()`. On every backend container restart, it idempotently drops and recreates `no_update_verified` with the archival exception (`NOT (NEW.is_archived = TRUE AND OLD.is_archived = FALSE)`). No manual `docker exec` required — the next `docker compose restart backend` or `up --build` self-heals the rule.

### Duplicate Flagging — Immediate on Submit
- **Previous behaviour**: when the encoder clicked "Submit Anyway" (`force=true`), the duplicate check was bypassed entirely — no `is_duplicate` flag set — so the DUPLICATE badge in the validator queue only appeared after the validator tried to Accept (409 runtime detection).
- **Fix**: `submit_incident_for_review_command` now runs the duplicate check for both `ack_duplicate=true` and `force=true` paths. If a match is found, `is_duplicate=TRUE` and `duplicate_of` are set before the status transitions to PENDING. The validator queue immediately shows the DUPLICATE badge and the purple "Review" button without any validator action required.

### Stats Badge Live Sync
- Validator "Pending" count badge (on the status filter chip) now refreshes after every queue load — previously stayed stale until the stats period chip was changed
- Encoder "Rejected" count badge now refreshes after every incident list load — previously stayed stale; was not updated by the background 20 s poll

### SectionDotNav Improvements
- Added optimistic click update: clicking a dot immediately activates it instead of waiting for IntersectionObserver
- Added 700 ms suppress window after click to prevent the observer from fighting the active state during smooth scroll
- Replaced `intersectionRatio`-sort (unreliable during animation) with topmost-element tracking via a `Map` of currently intersecting sections
- Widened rootMargin from 15% to 40% effective band for more reliable section detection
- Tooltip label slide distance increased from 1 px to 2 px for better visual feedback
- Applies to manual entry form, wildland form, and AFOR import page

### IncidentForm Draft Restore
- Restore banner and autosave are now suppressed when `initialData` is set (import-correction mode); previously the banner showed and autosave overwrote the real create-mode draft when correcting an imported AFOR
- "Try searching All Time" hint text and Search All Time button are now only rendered when the current date filter is not already "All Time" (validator and encoder dashboards)

### Encoder Dashboard — VERIFIED Filter Date Reset
- **Root cause**: `selectStatusFilter` on the encoder dashboard only treated REJECTED and DRAFT as "long-range" statuses. Switching to the VERIFIED chip after being on REJECTED or DRAFT (with `dateFilter='all'`) reset the date back to `'today'`, making every historical VERIFIED incident invisible — including the ones the encoder needed to archive.
- **Fix** (`regional/page.tsx`): Expanded `LONG_RANGE_STATUSES` to `['PENDING', 'VERIFIED', 'REJECTED', 'DRAFT']`. Any specific-status chip now sets `dateFilter='all'` on selection; returning to the All chip ('') from any long-range status resets to `'today'`. Mirrors the validator dashboard's `selectStatusFilter` behaviour.

### Validator: Duplicate Indicator Always Visible
- DUPLICATE badge no longer requires `!inc.parent_incident_id` — was incorrectly hiding duplicates that had a parent; badge now shows for any PENDING incident where `is_duplicate` is true
- Flag icon in the Actions column uses the same fixed condition
- Duplicate incidents show a purple **Review** button instead of the green Accept button; Review opens the same side-by-side comparison modal immediately

### Validator: Accept Confirmation Modal
- Accept button in the validator queue list now opens a confirmation modal (with incident summary and "View revision history" toggle using `IncidentDiffPanel`) before calling the accept API
- Same confirmation modal added to the incident detail view Accept button

### Resubmitted Flag (Purple Badge)
- New DB column `wims.fire_incidents.is_resubmitted BOOLEAN DEFAULT FALSE` (migration: `src/postgres-init/40_add_resubmitted_flag.sql`)
- `submit_incident_for_review_command` sets `is_resubmitted = TRUE` when the prior status was `REJECTED`
- Validator queue includes `is_resubmitted` in the API response; PENDING incidents with `is_resubmitted = true` show a purple **RESUBMITTED** badge alongside the status badge (no separate filter — counts as PENDING)

### CI Pipeline Fixes
- `IncidentRevisionHistory.tsx`: restructured `useEffect` to async IIFE — fixes `react-hooks/set-state-in-effect` ESLint error that was blocking the lint gate
- `regional.py`, `duplicate_detection.py`, `lifecycle.py`: `ruff format` applied to pass `ruff format --check`
- `recharts` + `firebase` confirmed in `package-lock.json`; `npm ci` installs correctly — fixes 23 failing Vitest tests

### Merge Conflict Resolution
- `system-wiki/index.md` + `system-wiki/log.md`: resolved conflicts with master's agent-skill docs / CONTEXT.md glossary additions; all log entries preserved in chronological order

---

## Test plan

- [ ] `npm run lint` — 0 errors
- [ ] `npx vitest run` — 115/115 pass
- [ ] `ruff check .` + `ruff format --check .` — all pass
- [ ] Smoke test `/afor/create` and `/afor/import` — no crash
- [ ] First-login: region field in IncidentForm immediately locked to assigned region
- [ ] Edit-mode: Auto-fill button absent; type-of-involved validation blocks submit without valid type
- [ ] Duplicate detection: create incident matching existing verified record → detail page auto-shows side-by-side duplicate modal with "Submit Anyway" option
- [ ] Encoder dashboard stats filter chips change period correctly
- [ ] Validator dashboard stats filter chips change period correctly
- [ ] Clear pin: pin a location → click "Clear pin" → coordinates removed, map marker gone, no re-geocoding
- [ ] Barangay hint text visible below the Barangay label on `/afor/create`
- [ ] ICP: set "with" → type a location → switch to "without" → switch back to "with" → location input is empty
- [ ] Idle logout: fill IncidentForm halfway → wait for session to expire → re-login → return to `/afor/create` → restore banner appears → fields repopulated
- [ ] AFOR import: upload file with invalid rows → session expires → re-login → import page shows previous error preview
- [ ] Archive button: click "See Archive" on encoder dashboard → list switches to archived view; "Hide Archive" returns normal list
- [ ] **Apply migration first**: `docker compose exec -T postgres psql -U postgres -d wims < src/postgres-init/41_fix_immutable_rule_for_archive.sql`
- [ ] Encoder archive: VERIFIED incident shows "Archive" button in card and table views → clicking archives it → incident disappears from main list → visible in "See Archive"
- [ ] Validator archive — REJECTED: reject an incident → Archive button visible in "Rejected" filter → clicking Archive moves it to archive view only (not deleted)
- [ ] Validator archive — VERIFIED: click "Accepted" filter → incidents show with "Archive" button regardless of creation date → archive succeeds (row disappears, no 500)
- [ ] Validator pending badge: accept all pending incidents → badge count immediately drops to 0 without page reload
- [ ] Encoder rejected badge: validator rejects an encoder's incident → encoder refreshes list → "Rejected" chip badge updates
- [ ] Restore banner — manual entry: fill form halfway → wait for session expiry → re-login → restore banner appears at `/afor/create`
- [ ] Restore banner — import correction: upload AFOR with errors → fix in "Correct Imported AFOR" mode → restore banner does NOT appear
- [ ] "No incidents found" with All Time filter: switch to All Time with no incidents → "Try searching All Time" hint absent
- [ ] Resubmit after rejection: reject an incident as validator → encoder edits and submits → no transaction rollback; RESUBMITTED badge shows in validator queue
- [ ] Duplicate flagging immediate: create incident matching existing VERIFIED → submit → validator queue immediately shows DUPLICATE badge and "Review" button without clicking Accept
- [ ] Duplicate force-submit: same as above but encoder clicks "Submit Anyway" → validator queue still shows DUPLICATE badge immediately
- [ ] Validator queue: submit a duplicate incident → DUPLICATE badge appears in queue without clicking Accept; button reads "Review" and opens comparison modal
- [ ] Validator: Accept button (queue and detail view) shows confirmation modal before committing; "View revision history" toggle works inside modal
- [ ] Resubmitted flag: reject an incident → encoder resubmits → validator queue shows purple RESUBMITTED badge
- [ ] Encoder VERIFIED filter: click "Verified" chip (from any other chip) → incidents from all dates visible, not just today
- [ ] Stale duplicate flag cleared: reject a duplicate incident → encoder changes date/time/coordinates by enough to pass the 5-criterion check → resubmits → validator queue shows NO DUPLICATE badge; "Accept" button (not "Review") is rendered
- [ ] Stale duplicate flag — still duplicate: reject → encoder changes only minor details (still within 500 m, same day, same hour) → resubmit → encoder sees 409 duplicate modal; can force-submit → validator queue shows DUPLICATE badge
- [ ] **Restart backend first** to trigger startup schema patch: `docker compose restart backend`
- [ ] Validator archive — VERIFIED: after backend restart, click "Accepted" filter → Archive button → incident disappears from queue (no longer a silent no-op)

---
