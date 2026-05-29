# Three-Axis Review: PR #143

**Reviewed:** `fix/enc-val-bugs-and-UI` @ `6d23f14`  
**Base:** `master` @ `b25e7e8`  
**Size:** 68 files, +5673 / −1800 lines  
**Date:** 2026-05-29

---

## BLOCKING — Must Address Before Merge

### 1. No tests for `duplicate_detection.py` rewrite

The 5-criterion scoring system completely replaces the old radius+text-fallback logic, but has zero tests. All four call sites in `lifecycle.py` are updated with the new params (integration contract is exercised), but the scoring logic itself — distance boundaries, exact-date matching, 1-hour time window, city-to-province fallback, and 3-of-5 threshold — has no unit coverage. A logic error in any criterion silently lets duplicates through or flags false positives.

**Minimum:** test each of the 5 criteria independently, edge cases at boundaries (500 m, 1 hr, date equality), and the 3-of-5 threshold behavior.

### 2. Nominatim coordinates leak

`IncidentForm.tsx:33` calls `nominatim.openstreetmap.org/reverse` with fire incident lat/lng before the report is saved. Same at `MapPickerInner.tsx:155,199,240` and `afor/import/page.tsx:386–395`. Fire location data goes to a third-party server with no consent notice or privacy disclosure. This contradicts the project's PII-encryption posture.

**Fix:** proxy through the backend, add a consent modal, or document explicit risk acceptance.

### 3. `IncidentForm.tsx` at 2,269 lines (+490)

Broke the 2k-line ceiling. The inline `reverseGeocode()` function (29 lines) and several form sections are prime extraction targets — move geocode to `lib/geocode.ts`, extract vehicle/tool tables into sub-components. No functional bug, just structural decay.

### 4. `regional.py`: PII decryption duplicated

Identical `decrypt_json` + field extraction logic at lines 520–545 (list endpoint) and 854–877 (detail endpoint). Extract a shared `_decrypt_pii_into_dict(encryption_iv, pii_blob_enc, incident_id) -> dict` helper to centralize the ~25 duplicated lines and single error-handling path.

### 5. Zero new tests across the entire PR

+5673/−1800 lines, and the only test changes are 3 lines **removed** (stale `station_code` from two fixture files). No new tests for: duplicate detection rewrite, auth-refresh singleton, transport 401 routing, IncidentForm additions, validator page, regional page, or parse.py's new `_extract_barangay_from_address()`.

---

## SUGGESTIONS (Non-blocking)

- **Stale system-wiki docs:** `regional-api-ref.md` still documents `station_code` as a key field. `regional-dashboard.md` references the old `DUPLICATE_RADIUS_METERS = 1000` + SQL function instead of the 5-criterion system. `sql-init-files.md` shows the old reference_number format with `{station}` segment. All should be updated to match migration 39.

- **`IncidentForm.tsx:674`:** Still appends `, Philippines` to the map search query. The reverse geocode *display* function correctly strips it. If the spec meant removal from forward-geocode queries, this is a gap; otherwise it's correct for geocoding accuracy (helps Nominatim disambiguate). Worth clarifying.

- **Remove unused `alarm_level` parameter** from `check_for_duplicate()` in `duplicate_detection.py` — documented as "reserved for future use." YAGNI.

- **Mega-component hygiene:** `validator/page.tsx` at 1,277 lines and `regional/page.tsx` at 1,140 lines — extract action modals, queue cards, and shared `StatusBadge`/`MetricPill` components.

- **`IncidentRevisionHistory.tsx`** uses a named async function, not an IIFE. The wiki log says "async IIFE." Functionally identical, minor doc inconsistency.

---

## PRAISE

- **Spec compliance:** All 12 requirements from the PR body verified as implemented — no scope creep, no wrong implementations.

- **`auth-refresh.ts` singleton pattern:** Correct. JS single-threaded means no race between the `if (refreshInFlight)` check and the `refreshInFlight = p` assignment. `.finally()` cleanup runs on both success and failure.

- **`transport.ts` 401 routing:** Clean single-retry through `refreshToken()` with `skipAuthRedirect` opt-out.

- **`station_code` removal:** Thorough — `DROP COLUMN IF EXISTS`, test fixture cleanup, zero dead references in application code.

- **SQL injection audit:** All dynamic SQL uses parameterized values. No injection vectors found.

- **`globals.css` red shades:** Properly tokenized via CSS custom properties + Tailwind `@theme inline`.

- **`Sidebar.tsx`:** Cleaner with `getNavSections(role)` replacing inline conditionals.

- **`login-otp.ftl`:** Well-structured, self-contained, good inline JS.

- **System-wiki/log.md:** Updated with detailed change entries.

---

## SPEC VERIFICATION

All 12 requirements verified as implemented — no scope creep, no wrong implementations:

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | Sidebar/Navigation | ✅ | Role-segmented sections, `isActive()` cross-route fix |
| 2 | AFOR Suspense wrappers | ✅ | Both `/afor/create` and `/afor/import` wrapped in `<Suspense>` |
| 3 | RBAC callback refreshProfile | ✅ | `Promise.all([refreshSession(), refreshProfile()])` at `callback/page.tsx:53` |
| 4 | Edit-Mode Hardening | ✅ | Auto-fill hidden in edit mode; type-of-involved validation enforced |
| 5 | Duplicate pending_submit | ✅ | 409 redirects with `?pending_submit=1`, detail page auto-re-fires |
| 6 | Map/Address UX | ✅ | Barangay manual-edit guard, Re-pin clears lat/lng, reverse geocode parses PH hierarchy |
| 7 | Duplicate Detection Redesign | ✅ | 5-criterion scoring, ≤500 m, 3/5 threshold, ±3 day pool — all call sites updated |
| 8 | Notifications | ✅ | Validator 10 s poll, encoder 20 s poll + dismissable banner |
| 9 | Auth Refresh Race Fix | ✅ | `transport.ts` routes 401 through `refreshToken()` (shared lock) |
| 10 | Dashboard Stats Scoping | ✅ | Date filters on both encoder/validator stats; wildland LEFT JOIN fix |
| 11 | CI Pipeline Fixes | ✅ | Async named function for ESLint, ruff format applied, recharts/firebase in lockfile |
| 12 | Merge Conflict Resolution | ✅ | No conflict markers; log documents what was merged |

---

## MERGE CONFLICT NOTICE

These files overlap with `master` or the `feat/public-pages-visual-unification` branch:

| File | Conflict with |
|---|---|
| `.gitattributes` | PR #124 (trivial — both add 1–2 lines) |
| `ExportPreviewModal.tsx` | PR #124 added `region_name` column |
| `auth-refresh.ts` | Master has PR #122's singleton — approaches are similar, compare during merge |
| `LayoutShell.tsx` | `feat/public-pages-visual-unification` branch |

---

## AGGREGATE SUMMARY

| Axis | Blocking | Suggestion | Nitpick | Praise |
|------|----------|------------|---------|--------|
| Standards | 1 (Nominatim privacy) | 5 | 0 | 5 |
| Spec | 0 | 1 | 0 | — (12/12 pass) |
| Quality | 4 | 3 | 1 | 8 |
| **Total** | **5 blocking** | **9 suggestions** | **1 nitpick** | — |

---

## VERDICT

**APPROVE WITH CONDITIONS.** All spec requirements are correctly implemented. The core architecture (duplicate detection redesign, RBAC enforcement, auth refresh fix) is sound. Address the 5 blocking items above before merging.
