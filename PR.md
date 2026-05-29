# PR Draft — fix/enc-val-bugs-and-UI → master

**Title:** `fix(enc-val): Encoder/Validator bug fixes, dashboard stats, duplicate detection, CI`

**Base branch:** `master`
**Head branch:** `fix/enc-val-bugs-and-UI`

---

## Summary

End-to-end bug fix and hardening pass for the Regional Encoder and National Validator subsystems. Covers sidebar navigation, AFOR page crashes, RBAC enforcement, edit-mode submission hardening, duplicate detection, map UX, notification polling, auth refresh, dashboard stats scoping, and CI pipeline fixes.

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

---

