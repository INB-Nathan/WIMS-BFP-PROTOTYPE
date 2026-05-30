# Feedback Response — PR #143 `fix/enc-val-bugs-and-UI`

**Review:** `feedback.md` (three-axis review, 2026-05-29)  
**Addressed in:** `fix/enc-val-bugs-and-UI` @ post-review commits  
**Date:** 2026-05-30

---

## Blocking Issues — All Resolved

### 1. No tests for `duplicate_detection.py` rewrite

**Fix:** Created `src/backend/tests/test_duplicate_detection.py` with 21 unit tests.

Coverage:
- Return-value contract (`None` when no match, `int` when match found)
- `effective_date` derivation from `notification_dt` when `incident_date=None`
- Parameterized test for each of the 5 criteria: verifies the correct SQL parameter key is populated per criterion
- `None` lat/lon skips criterion 1 params
- `None` notification_dt skips criterion 4 params
- `exclude_statuses` builds correct `extra_where` clause
- `verified_window_seconds` builds correct `extra_where` clause
- Combined exclude_statuses + verified_window_seconds

All 21 tests pass in CI.

---

### 2. Nominatim coordinates leak

**Fix:** All Nominatim calls are now proxied through the backend. The browser never contacts `nominatim.openstreetmap.org` directly.

**Backend:** `src/backend/api/routes/geocode.py` (new)
- `GET /api/geocode/reverse?lat=&lon=` — reverse geocode proxy
- `GET /api/geocode/search?q=&limit=` — forward geocode proxy
- Uses `httpx.AsyncClient` (already in requirements.txt)
- Sends `User-Agent: WIMS-BFP/1.0` per Nominatim Terms of Service
- Registered in `src/backend/main.py`

**Frontend:** `src/frontend/src/lib/geocode.ts` (new)
- `reverseGeocode(lat, lng)` — calls `/api/geocode/reverse`
- `searchGeocode(q, limit, addressdetails, signal?)` — calls `/api/geocode/search`
- Supports `AbortSignal` for cancellation in suggestions useEffect

**Updated consumers:**
- `IncidentForm.tsx` — removed 29-line inline `reverseGeocode`, imports from `@/lib/geocode`
- `MapPickerInner.tsx` — replaced 3 direct Nominatim `fetch` calls with `searchGeocode`
- `afor/import/page.tsx` — replaced `nominatim()` hook function with `searchGeocode`

---

### 3. `IncidentForm.tsx` at 2,269 lines

**Fix:** Extracted 5 form section components to `src/frontend/src/components/IncidentFormSections.tsx`.

Extracted:
- `AssetsResourcesSection` — C section: vehicle/tool rows and hydrant field
- `AlarmLevelSection` — D section: alarm level table with ICP conditional
- `CasualtiesSection` — E section: casualties table
- `PersonnelOnDutySection` — F section: POD roles grid
- `ProblemsChecklistSection` — I section: problems encountered checkboxes

Also moved constants (`VEHICLE_ROWS`, `TOOL_ROWS`, `ALARM_ROWS`, `CASUALTY_ROWS`, `POD_ROLES`) to `IncidentFormSections.tsx`.

**Result:** `IncidentForm.tsx` reduced from **2,269 → 1,978 lines** (–291 lines).

---

### 4. `regional.py`: PII decryption duplicated

**Fix:** Added `_decrypt_pii_blob(encryption_iv, pii_blob_enc, incident_id)` helper near the top of `regional.py`.

The list endpoint (~line 520) and detail endpoint (~line 854) both use the helper instead of duplicating the try/except/decrypt pattern. The `_decrypt_pii_blob` function was subsequently moved to `services/regional_incidents/helpers.py` during the B1 modularization pass.

---

### 5. Zero new tests across the entire PR

**Fix:** Addressed by blockers 1 (21 duplicate_detection tests) and 5 (9 barangay extraction tests).

**Additional tests:** `src/backend/tests/test_afor_import.py` extended with 9 new tests for `_extract_barangay_from_address()`:
- Keyword-based extraction (Brgy., Bgy., Barangay prefix, case-insensitive)
- Positional fallback (AFOR template index 2)
- Empty string, placeholder, fewer-than-3-parts edge cases

All 22 tests in `test_afor_import.py` pass.

---

## Suggestions Addressed

### Suggestion A: Remove unused `alarm_level` parameter

Removed `alarm_level: str | None` from `check_for_duplicate()` signature in `duplicate_detection.py` and removed `alarm_level=...` from all 4 call sites in `lifecycle.py`. Docstring entry also removed.

### Suggestion B: `IncidentForm.tsx:674` still appends `, Philippines`

Fixed. `setMapSearchQuery(hydratedAddress)` — no suffix. Consistent with the other fix applied earlier in the branch. The backend geocode proxy passes `countrycodes=ph` to Nominatim, so the suffix is redundant.

---

## Project Manager: Modularization Pass

In addition to the blocking fixes, a modularization pass was performed on the codebase's largest files.

### Backend

**B1: `regional.py` split (3,061 → 2,361 lines)**

- `src/backend/schemas/regional.py` (new) — 6 Pydantic schemas: `RegionalStatsResponse`, `IncidentCreateRequest`, `IncidentUpdateRequest`, `VerificationActionRequest`, `CorrectionRequest`, `BulkApproveRequest`
- `src/backend/services/regional_incidents/helpers.py` (new) — all pure helper functions: category canonicalization, safe type coercions, region alias matching, reference number generation, IVH insert helpers, `apply_incident_field_updates`, `build_audit_log_query`, `decrypt_pii_blob`, `get_security_provider`
- `regional.py` updated to import from both new modules (duplicate local definitions removed)

### Frontend

**B2: Shared UI components — `src/frontend/src/components/ui/`** (new directory)

- `ui/StatusBadge.tsx` — `StatusBadge` + `STATUS_COLORS` + `STATUS_LABELS` (was inline in both dashboard pages)
- `ui/MetricPill.tsx` — `MetricPill` component (was inline in regional page)
- `ui/FilterChips.tsx` — generic filter chip row
- `ui/PaginationControls.tsx` — generic prev/next pagination
- `ui/index.ts` — barrel export

Both `regional/page.tsx` and `validator/page.tsx` updated to import from `ui/`.

**B3: `IncidentFormSections.tsx`** — see Blocker 3 above.

**B4/B5: `src/frontend/src/lib/incident-utils.ts`** (new)

Shared date/display helpers extracted from both dashboard pages:
`formatIncidentDate`, `manilaTodayUtcDate`, `dateOnly`, `isDateOnly`, `addUtcDays`, `getDateBounds`, `displayValue`, `statusBorderColor`, `categoryCount`

Both `regional/page.tsx` (1,140 → 1,032 lines) and `validator/page.tsx` (1,277 → 1,168 lines) updated to import from `incident-utils.ts` instead of defining inline duplicates.

---

## File Summary

| File | Change | Reason |
|------|--------|--------|
| `src/backend/tests/test_duplicate_detection.py` | NEW | Blocker 1 |
| `src/backend/api/routes/geocode.py` | NEW | Blocker 2 |
| `src/backend/main.py` | EDIT | Blocker 2 |
| `src/frontend/src/lib/geocode.ts` | NEW | Blocker 2 |
| `src/frontend/src/components/IncidentForm.tsx` | EDIT | Blockers 2+3, Suggestion B |
| `src/frontend/src/components/MapPickerInner.tsx` | EDIT | Blocker 2 |
| `src/frontend/src/app/afor/import/page.tsx` | EDIT | Blocker 2 |
| `src/frontend/src/components/IncidentFormSections.tsx` | NEW | Blocker 3 |
| `src/backend/api/routes/regional.py` | EDIT | Blocker 4 + B1 |
| `src/backend/tests/test_afor_import.py` | EDIT | Blocker 5 |
| `src/backend/services/duplicate_detection.py` | EDIT | Suggestion A |
| `src/backend/services/regional_incidents/lifecycle.py` | EDIT | Suggestion A |
| `src/backend/schemas/regional.py` | NEW | B1 |
| `src/backend/services/regional_incidents/helpers.py` | NEW | B1 |
| `src/frontend/src/components/ui/StatusBadge.tsx` | NEW | B2 |
| `src/frontend/src/components/ui/MetricPill.tsx` | NEW | B2 |
| `src/frontend/src/components/ui/FilterChips.tsx` | NEW | B2 |
| `src/frontend/src/components/ui/PaginationControls.tsx` | NEW | B2 |
| `src/frontend/src/components/ui/index.ts` | NEW | B2 |
| `src/frontend/src/lib/incident-utils.ts` | NEW | B4/B5 |
| `src/frontend/src/app/dashboard/regional/page.tsx` | EDIT | B5 |
| `src/frontend/src/app/dashboard/validator/page.tsx` | EDIT | B4 |

---

## Test Results

```
Backend (pytest): 45 passed (21 new + 9 new + 15 existing)
Backend (ruff): All checks passed on modified files
Frontend (tsc --noEmit): 0 new errors in modified files
```
