# Regional Dashboard Handover

> **Audience:** AI assistant sessions continuing work on the Encoder/Validator subsystem.  
> **Last updated:** 2026-05-28 (branch `fix/enc-val-bugs-and-UI`)

---

## 1. Regional Encoder Scope

### Responsibilities
A `REGIONAL_ENCODER` encodes official fire incident records for one assigned Philippine region. They:
- Create DRAFT incidents manually or by importing AFOR workbooks (.xlsx/.csv)
- Edit and submit DRAFT incidents for validator review
- Monitor the status of their submitted incidents
- Review their own action history

### Frontend Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/dashboard/regional` | `src/frontend/src/app/dashboard/regional/page.tsx` | Summary dashboard (stats cards, incident list) |
| `/dashboard/regional/audit` | `src/frontend/src/app/dashboard/regional/audit/page.tsx` | Encoder's own action log |
| `/dashboard/regional/incidents/[id]` | `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` | Incident detail / edit / submit |
| `/afor/create` | `src/frontend/src/app/afor/create/page.tsx` | Manual AFOR entry (structural + wildland) |
| `/afor/import` | `src/frontend/src/app/afor/import/page.tsx` | Bulk AFOR import from .xlsx |

### Backend API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/regional/incidents` | Paginated list, scoped to encoder's region and user |
| `POST` | `/api/regional/incidents` | Create new DRAFT incident |
| `PUT` | `/api/regional/incidents/{id}` | Update DRAFT/PENDING incident |
| `PATCH` | `/api/regional/incidents/draft/{id}` | Update DRAFT-only |
| `DELETE` | `/api/regional/incidents/draft/{id}` | Soft-delete DRAFT |
| `PATCH` | `/api/regional/incidents/{id}/submit` | Submit to PENDING_VALIDATION |
| `GET` | `/api/regional/stats` | Dashboard summary metrics |
| `GET` | `/api/regional/audit-log` | Encoder's own action history |
| `POST` | `/api/afor/import` | Parse + validate an AFOR file |
| `POST` | `/api/afor/commit` | Persist parsed AFOR rows as incidents |

### Key Components
- `src/frontend/src/components/IncidentForm.tsx` — structural fire incident form (also handles edit mode)
- `src/frontend/src/components/WildlandAforManualForm.tsx` — wildland AFOR manual entry
- `src/frontend/src/components/MapPicker.tsx` → `MapPickerInner.tsx` — coordinate picker (Leaflet, loaded client-only via `dynamic` + `ssr: false`)
- `src/frontend/src/lib/offlineStore.ts` — IndexedDB queue for offline incident drafts
- `src/frontend/src/lib/edgeFunctions.ts` — upload-bundle offline sync

---

## 2. Regional Validator Scope

### Responsibilities
A `NATIONAL_VALIDATOR` reviews, accepts, or rejects PENDING_VALIDATION incidents submitted by regional encoders. They:
- Work through a paginated validation queue
- Inspect before/after diffs for updated incidents
- Bulk-approve batches
- View cross-region audit trails
- Archive finalized incidents

### Frontend Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/dashboard/validator` | `src/frontend/src/app/dashboard/validator/page.tsx` | Validator queue + summary stats |
| `/dashboard/validator/audit` | `src/frontend/src/app/dashboard/validator/audit/page.tsx` | Cross-region audit trail |
| `/incidents/triage` | `src/frontend/src/app/incidents/triage/page.tsx` | Civilian report triage (separate workflow) |

### Backend API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/regional/validator/incidents` | Paginated validation queue |
| `PATCH` | `/api/regional/incidents/{id}/verification` | Single-incident accept/reject |
| `POST` | `/api/regional/validator/incidents/bulk-approve` | Bulk approval |
| `GET` | `/api/regional/validator/incidents/{id}/diff` | Before/after diff view |
| `PATCH` | `/api/regional/validator/incidents/{id}/archive` | Archive finalized incident |
| `GET` | `/api/regional/validator/stats` | Aggregate counts for dashboard |
| `GET` | `/api/regional/validator/audit-logs` | Cross-region action history |
| `GET` | `/api/regional/validator/audit-logs/export` | CSV export of audit logs |

### Key Components
- `src/frontend/src/components/IncidentDiffPanel.tsx` — side-by-side diff for verification review
- `src/frontend/src/components/UpdateRequestDiffPanel.tsx` — diff for force-replace requests
- `src/frontend/src/components/DuplicateResolutionModal.tsx` — duplicate decision UI (also used by AFOR import)

---

## 3. Encoder → Validator Pipeline

### Incident Creation Flow (Manual Entry)
```
Encoder navigates to /afor/create
  → chooses Structural or Wildland form type
  → fills IncidentForm / WildlandAforManualForm
  → POST /api/regional/incidents → status: DRAFT
  → can edit (PUT /api/regional/incidents/{id})
  → PATCH /api/regional/incidents/{id}/submit → status: PENDING_VALIDATION
```

### AFOR Import Flow
```
Encoder navigates to /afor/import
  → uploads .xlsx file
  → POST /api/afor/import → parse response (valid/invalid rows, form_kind)
  → encoder reviews rows, sets map coordinates
  → POST /api/afor/commit → if duplicates detected → DuplicateResolutionModal
  → on resolution → POST /api/afor/commit again with resolutions
  → incidents created as DRAFT in the DB
  → encoder clicks "Submit All" → PATCH /{id}/submit for each committed ID
  → status: PENDING_VALIDATION
```

### Validation Flow
```
Validator opens /dashboard/validator
  → sees paginated queue of PENDING_VALIDATION incidents
  → clicks incident → reviews detail + diff
  → PATCH /api/regional/incidents/{id}/verification
    → action: ACCEPTED_AS_NEW → status: VERIFIED
    → action: REJECTED → status: REJECTED (returned to encoder)
  → OR: bulk-approve selected rows → POST /api/regional/validator/incidents/bulk-approve
  → Verified incidents appear in analyst dashboards
```

### Relevant API Request/Response Types
Key schemas are in `src/backend/api/routes/regional.py`:
- `IncidentCreateRequest` / `IncidentUpdateRequest` — ~50 fields covering all AFOR form sections
- `RegionalStatsResponse` — incident counts + affected-population aggregates (new in this branch)
- `AforParseResponse` / `AforCommitRequest` / `AforCommitResponse` — AFOR import pipeline
- `RowResolution` — per-row duplicate decision (skip | merge | force)

Frontend API functions live in `src/frontend/src/lib/api/legacy.ts` (re-exported through `src/frontend/src/lib/api/regional.ts`).

---

## 4. Known Dependencies

### Auth + RBAC
- Two auth contexts in the app: `@/context/AuthContext` (OIDC, used by `Sidebar.tsx`) and `@/lib/auth` (session cookie, used by IncidentForm, afor pages, validator pages). Both are mounted in the root layout.
- `useUserProfile()` from `@/lib/auth` — provides `role`, `assignedRegionId`, `loading`. Throws if called outside `AuthProvider`.
- Backend enforces region assignment: `POST /api/regional/incidents` raises `403 REGION_MISMATCH` if `region_id` ≠ encoder's `assigned_region_id`.

### Row-Level Security
- All `wims.*` tables have RLS bound to `wims.current_user_id` GUC.
- Backend `get_db_with_rls()` sets this GUC via `SET LOCAL` before each query.
- `get_current_wims_user` dependency must appear **before** `get_db_with_rls` in route signatures.

### PII Encryption
- `caller_name`, `caller_number`, `owner_name`, `occupant_name` stored encrypted (AES-256-GCM) in `wims.incident_sensitive_details`.
- Key from `WIMS_MASTER_KEY` env var. Decryption failure → `CRITICAL` log + falls back to legacy plaintext column.

### Shared Components (outside encoder/validator scope)
- `Sidebar.tsx` — navigation for all roles; active-state logic affects both encoder and validator menus.
- `MapPicker` / `MapPickerInner` — Leaflet-based, always loaded client-only (`ssr: false`). Shared by both AFOR pages and the incident form.
- `DuplicateResolutionModal` — used by both AFOR import and validator diff view.
- `offlineStore.ts` — IndexedDB-based queue; used by IncidentForm for offline PWA drafts.

### Region Data
- `src/frontend/src/lib/ph-regions.ts` — region IDs, names, AFOR region codes, province/city lists.
- `getAforRegionIdentifier(regionId)` — maps region DB ID to the AFOR reference number code (e.g., `RGN-NCR`, `RGN-1`).
- Region IDs: 1=NCR, 2=CAR, 3=Region I, …, 18=BARMM (see ph-regions.ts for full mapping).

---

## 5. Change Log

### 2026-05-27 — Branch `fix/enc-val-bugs-and-UI`

**Files modified (session 1 — sidebar, crash fixes):**

| File | Change | Bug Fixed |
|------|--------|-----------|
| `src/frontend/src/components/Sidebar.tsx` | Added two `isActive()` exclusion rules for `/dashboard/regional` and `/dashboard/validator` parent routes | Encoder sidebar: Activity Log nav highlighted Regional Dashboard; Validator sidebar: Audit Trail highlighted Validator Dashboard |
| `src/frontend/src/app/afor/import/page.tsx` | Moved `isOffline` from render body to `useState(false)` + `useEffect` with online/offline listeners; renamed component to `AforImportPage`, wrapped in `<Suspense>` export default | AFOR Import page crashed with "Application error: a client-side exception" |
| `src/frontend/src/app/afor/create/page.tsx` | Renamed component to `AforCreatePage`, wrapped in `<Suspense>` export default | Manual Entry page crashed with "Application error: a client-side exception" |

**Files modified (session 2 — RBAC enforcement):**

| File | Change | Bug Fixed |
|------|--------|-----------|
| `src/frontend/src/app/callback/page.tsx` | Added `useUserProfile` import; added `refreshProfile()` to post-login sync; now calls `await Promise.all([refreshSession(), refreshProfile()])` before navigating to dashboard | On first login, `UserProfileProvider` stayed at `assignedRegionId=null` for the entire session — all RBAC region guards in IncidentForm and afor pages were no-ops |
| `src/frontend/src/components/IncidentForm.tsx` | Added `loading: profileLoading` from `useUserProfile()`; region field for encoders now unconditionally renders as a locked display (not a dropdown), showing "Loading…" while profile loads | Encoders could freely change region via the dropdown while `assignedRegionId` was null during first-login load |

**Root cause (session 2):** Two independent auth contexts exist: `@/context/AuthContext` (used by Sidebar, detail page) and `@/lib/auth` (used by IncidentForm, afor pages). Both call `/api/auth/session` on mount. On first login, the cookie isn't set until after both initial fetches — only `AuthContext` was being re-fetched post-callback; `UserProfileProvider` kept `assignedRegionId=null` until manual refresh.

**Files modified (session 3 — edit-mode submission hardening):**

| File | Change | Bug Fixed |
|------|--------|-----------|
| `src/frontend/src/components/IncidentForm.tsx` | Hidden "Auto-fill (Test)" button in edit mode (`!isEditMode` guard) | Button was visible while editing an existing incident — clicking it (accidentally or intentionally) filled all fields with random data that bypassed field validation |
| `src/frontend/src/components/IncidentForm.tsx` | Hardened type-of-involved validation: now requires both `type_of_involved_general_category` to be non-empty AND `incidentTypeCode` to be non-empty | Form hydration pulled legacy/raw `sub_category` strings from the JSONB that were non-empty (passing string check) but didn't map to any recognized type option (returning empty `incidentTypeCode`) — the `incident_type_code` DB column stayed null and the detail page kept flagging the field as missing |

**Root cause (session 3):** The detail page's `handleSubmitClick()` validates against `detail.incident_type_code` (the DB column). IncidentForm's `handleSubmitForReview()` validated against `formState.type_of_involved_general_category` (the form string). These could diverge when the JSONB contained a legacy `sub_category` value that hydrated as a non-empty string but failed `getTypeCode()` lookup, producing an empty code and leaving the DB column null.

**Files modified (session 4 — duplicate detection modal from IncidentForm):**

| File | Change | Bug Fixed |
|------|--------|-----------|
| `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` | Added `pendingSubmitOnceRef` and a `useEffect` that reads `?pending_submit=1` on load, clears the URL, and calls `handleSubmit({})` | When IncidentForm's Submit button detected a duplicate (409) and navigated to the detail page with `?pending_submit=1`, the detail page loaded normally with no modal — the encoder had no way to proceed through or review the duplicate comparison |

**Root cause (session 4):** IncidentForm's edit-mode and create-mode submit paths both navigate to the detail page with `?pending_submit=1` when they receive a 409 DUPLICATE_DETECTED. The query param was documented in comments but was never consumed — the detail page had no `useSearchParams` or equivalent. The fix re-fires `handleSubmit({})` once on load, which produces the same 409 and sets `duplicateFound`/`pendingDuplicateFound` state, causing the existing side-by-side duplicate modal to appear. The "Submit Anyway" button in that modal calls `handleSubmit({ force: true })` (passing `?force=true` to the backend), which bypasses duplicate detection and completes the submission.

**Earlier commits on this branch (pre-existing context):**
- `6448e24` — Improved geocoding in AFOR import (abort controller, province fallback), cleared file input on region mismatch. Also restructured `auth-refresh.ts` to use module-level in-flight dedup instead of Web Locks API.
- `9e53ec2` — Dashboard UI overhaul: affected-population metrics cards, date formatting, status badge hex colors, sidebar styling.
- `5791275` — Fixed Windows dev fresh-build failures (CRLF, SSL cert, `.gitattributes`).
- `76d7c0d` — Added `system-wiki/operations/local-dev-deploy-guide.md` for Windows onboarding.

**Outstanding issues:**

| Issue | Severity | Notes |
|-------|----------|-------|
| `useSearchParams()` without Suspense in `/incidents/triage` and `/dashboard/analyst/[workflow]` | Low | Same pattern as the fixed afor pages, not yet reported as crashing but at risk |
| `M4-D`: AFOR import per-row duplicate decision UI | Deferred | Explicitly deferred from M4 milestone; `DuplicateResolutionModal` exists but per-row review UI in import flow is minimal |
| `test_delete_pending_blocked` | Pre-existing | Backend DELETE allows deleting PENDING incidents (should block) |
| Bulk approve atomicity | Pre-existing | No rollback on mid-batch failure |

**Recommended next steps:**
1. Run `docker compose up --build -d` and smoke-test `/afor/create` and `/afor/import` in the browser.
2. Test first-login RBAC: login fresh, navigate to `/afor/create` — region field must be locked to assigned region immediately (no "Loading…" visible on a fast connection).
3. Test edit-mode submission: open a DRAFT incident with missing "Type of Involved", click Submit → missing fields modal → Continue Editing → attempt to submit without selecting a type — should be blocked.
4. Test duplicate detection from IncidentForm: create or edit an incident that matches an existing verified incident (same region + type + fire date), click Submit for Review → page should navigate to detail view and show the side-by-side duplicate modal automatically (with "Submit Anyway" and "Continue Editing" options).
5. Address the `useSearchParams()` pattern in `/incidents/triage` and analyst workflow pages.
6. Consider implementing M4-D (per-row duplicate decision) as the next milestone item.

---

### 2026-05-28 — Bug batch: pin search, duplicate detection, notifications, session, dashboard stats

#### Fix 1 — Map address search: removed `, Philippines` suffix
**File:** `src/frontend/src/components/IncidentForm.tsx` (lines ~1535, ~1562)  
`setMapSearchQuery` calls no longer append `, Philippines` to the address string. Nominatim already scopes results to the Philippines via `countrycodes=ph`; the suffix was narrowing street-level and barangay-level precision.

#### Fix 2 — Re-pin from address after a manual pin
**File:** `IncidentForm.tsx` (Re-pin `onClick` handler)  
The "Re-pin from Address" button now clears `latitude`/`longitude` (`setLatitude(null); setLongitude(null)`) before setting the new `mapSearchQuery`. This resets `MapPickerInner`'s `autoSearchedRef` guard, which was silently blocking re-geocoding when the same address string was re-submitted after a manual map click.

#### Fix 3 — Barangay overwrite guard
**File:** `IncidentForm.tsx`  
Added `barangayManuallySetRef = useRef(false)`. When the encoder types directly into the Barangay input, the ref is set to `true`; subsequent reverse-geocode results from map pin drops no longer overwrite the typed value. The ref resets to `false` on fresh form mounts, so it only activates within a single editing session.

#### Fix 4 — Duplicate detection redesign (5-criterion scoring)
**Files:** `src/backend/services/duplicate_detection.py`, `src/backend/services/regional_incidents/lifecycle.py`  
Replaced the previous algorithm (5 km radius + ±1 day + OR-category fallback) with a **5-criterion scoring system** (threshold: 3/5):

| # | Criterion | Points |
|---|-----------|--------|
| 1 | Distance ≤ 500 m | 1 |
| 2 | Same `general_category` AND `incident_type_code` | 1 |
| 3 | Same exact fire date (date component of `notification_dt`) | 1 |
| 4 | Fire time within 1 hour | 1 |
| 5 | Same city/municipality (falls back to province/district if null) | 1 |

Candidate pool: ±3 days. Fallback OR-logic stage removed entirely. All three `check_for_duplicate` call sites in `lifecycle.py` updated to pass `notification_dt`, `city_municipality`, and `province_district`. New function signature:
```python
def check_for_duplicate(
    db, *, incident_id, region_id, alarm_level,
    incident_date, notification_dt=None,
    lat, lon,
    general_category=None, incident_type_code=None,
    city_municipality=None, province_district=None,
    exclude_statuses=(), verified_window_seconds=None,
) -> int | None
```

#### Fix 5 — Notification consistency
- **Validator polling** (`src/frontend/src/app/dashboard/validator/page.tsx`): Poll interval for new-submission detection reduced from 30 s → 10 s.
- **Encoder actioned-submission banner** (`src/frontend/src/app/dashboard/regional/page.tsx`): Added a 20 s background poll comparing PENDING total against `lastKnownPendingCountRef`. When the count drops (indicating a validator action), a dismissable blue banner appears: *"One of your submissions was actioned. Refresh to see the update."*

#### Fix 6 — Forced logout / refresh-token replay race
**File:** `src/frontend/src/lib/api/transport.ts`  
The `apiFetch` 401 handler was calling `fetch('/api/auth/refresh', ...)` directly, bypassing `navigator.locks` coordination in `auth-refresh.ts`. With Keycloak's `refreshTokenMaxReuse: 0`, concurrent proactive background refresh (every ~4 min in `auth.tsx`) and a 401-triggered refresh could race on the same token, causing session revocation. The 401 handler now calls `refreshToken()` from `auth-refresh.ts`, routing through the shared in-flight deduplication and lock.

---

### 2026-05-28 — Dashboard stats cards: scoping, date filtering, wildland fix

#### Problem
- Encoder dashboard stats were scoped to the individual encoder's incidents, not to the region.
- Wildland stats were not being updated (encoder-scoped query excluded wildland records correctly but missed the LEFT JOIN on `nd` for date filtering).
- No date filter on stats cards: always showed all-time totals.
- Validator stats had the same missing-date-filter and wildland-scope issues.

#### Encoder stats (`GET /api/regional/stats`)
**File:** `src/backend/api/routes/regional.py`  
- Added `date_from` and `date_to` Query parameters (ISO date strings, applied to `notification_dt` in Asia/Manila timezone).
- Changed scope from `encoder_id` to `region_id` + `verification_status = VERIFIED`.
- Wildland query updated with proper LEFT JOIN on `nd` so it respects the date filter.
- `total_incidents_this_week` aliased to `total_incidents` (generic total for the selected period).
- `by_status`/`by_alarm` remain encoder-scoped.

**File:** `src/frontend/src/lib/api/legacy.ts`  
`fetchRegionalStats(params?)` now accepts `{ date_from?, date_to? }` and appends them as query params.

**File:** `src/frontend/src/app/dashboard/regional/page.tsx`  
- Added `STATS_DATE_FILTERS` constant (Today / This Week / This Month / All Time) and `StatsDateFilterValue` type.
- Added `statsDateFilter` state (default `'week'`) and `statsDateBounds` memo.
- `loadStats` passes `statsDateBounds` to `fetchRegionalStats` and depends on it.
- Stats filter chip row rendered above incident type stats cards.
- First card title dynamically shows the selected period: e.g., `Total Verified · This Week`.

#### Validator stats (`GET /api/regional/validator/stats`)
**File:** `src/backend/api/routes/regional.py`  
- Added `date_from` and `date_to` Query parameters.
- Date clause applied to all VERIFIED queries (wildland, by_category, affected totals).
- Pending count intentionally unfiltered (shows current queue length regardless of date).
- Wildland query updated with LEFT JOIN on `nd`.
- Scope: **all regions** (no region scoping — validator sees system-wide verified counts).

**File:** `src/frontend/src/lib/api/legacy.ts`  
`fetchValidatorStats(params?)` now accepts `{ date_from?, date_to? }`.

**File:** `src/frontend/src/app/dashboard/validator/page.tsx`  
- Added `STATS_DATE_FILTERS`, `StatsDateFilterValue`, and `STATS_PERIOD_LABEL` constants.
- Added `statsDateFilter` state (default `'week'`) and `statsDateBounds` memo.
- `fetchValidatorStats` useEffect now depends on `statsDateBounds` and passes it.
- Stats filter chip row rendered above incident stats cards.
- Wildland and classification card titles include the period label.

#### Stats scoping summary

| Role | Stats scope | Date basis | Pending count |
|------|-------------|-----------|---------------|
| Encoder | Own region, VERIFIED only | `notification_dt` (fire date) | Not in stats cards |
| Validator | All regions, VERIFIED only | `notification_dt` (fire date) | Always current (unfiltered) |

---

### 2026-05-30 — Bug batch: map/pin UX, idle logout save, archive, validator duplicate/accept UX, resubmitted flag

#### Fix 1 — Clear pin button re-geocoded instead of clearing
**File:** `src/frontend/src/components/IncidentForm.tsx` (~line 1470)
Added `setMapSearchQuery(undefined)` to the Clear pin `onClick`. Without this, clearing coordinates reset `MapPickerInner`'s `autoSearchedRef` to null while `mapSearchQuery` still held the previous address, causing an immediate re-geocode — identical behaviour to Re-pin from Address.

#### Fix 2 — Idle logout loses encoding progress
**Root cause:** Keycloak refresh-token idle timeout is server-side; the 4-minute proactive frontend refresh doesn't prevent expiry during extended inactivity. Strategy is save-and-restore, not prevent-logout.

**2a — Pre-redirect URL save:** `src/frontend/src/lib/api/transport.ts` — saves `window.location.href` to `sessionStorage('wims:redirect_after_login')` before redirecting to `/login`.

**2b — Post-login URL restore:** `src/frontend/src/app/callback/page.tsx` — after the existing `refreshSession()`+`refreshProfile()` call, checks `sessionStorage('wims:redirect_after_login')` and navigates there instead of `/dashboard`.

**2c — IncidentForm autosave:** `src/frontend/src/components/IncidentForm.tsx` — debounced 500 ms `useEffect` writes `formState` + coordinates + timestamp to `localStorage('wims:incident_draft')` on every change (create mode only). On mount, if a saved draft exists, a blue restore banner appears at the top of the form with Restore / Discard buttons. Draft is cleared on successful save/submit navigation.

**2d — AFOR import persistence:** `src/frontend/src/app/afor/import/page.tsx` — `previewData` (invalid-row parse results) saved to `sessionStorage('wims:afor_import_draft')` on change and restored on mount. Cleared on `reset()` or `?reset=1`.

#### Fix 3 — Barangay hint text
**File:** `src/frontend/src/components/IncidentForm.tsx`
Added `<p className="text-xs text-gray-400 ...">` below the Barangay label: *"Tip: automatically filled when you pin the fire scene location on the map."*

#### Fix 4 — ICP location not cleared when switching to "without"
**File:** `src/frontend/src/components/IncidentFormSections.tsx` (~line 193)
ICP radio `onChange` now calls a compound handler: `handleRadioChange('icp_present', v)` + a synthetic `handleChange` event that clears `icp_location` when `v === 'without'`.

#### Fix 5 — Archive button on encoder dashboard
**Files:** `src/backend/api/routes/regional.py`, `src/frontend/src/lib/regional-incidents.ts`, `src/frontend/src/app/dashboard/regional/page.tsx`
- Backend `GET /regional/incidents` accepts `archived: bool = Query(False)`; filters `is_archived = TRUE` when set.
- `RegionalIncidentsQueryParams` + `buildRegionalIncidentsQueryString` extended with `archived?: boolean`.
- Dashboard: replaced broken `showArchive()` (was setting `statusFilter='ARCHIVED'`, a non-existent status) with `isArchiveView` boolean state and `toggleArchiveView()`. "See Archive / Hide Archive" toggle button at pagination row. Archive view disables status/date chips and passes `archived: true` to the incidents fetch.

#### Fix 6 — Validator duplicate indicator auto-shown + "Review" button
**File:** `src/frontend/src/app/dashboard/validator/page.tsx`

**Root cause:** DUPLICATE badge had an `!inc.parent_incident_id` guard that incorrectly suppressed it. `runtimeDuplicates` was only populated on a 409 response from Accept — so no badge appeared until Accept was clicked.

- Badge condition: removed `!inc.parent_incident_id`; badge now shows for any non-finalized incident where `inc.is_duplicate || runtimeDuplicates.has(inc.incident_id)`.
- Flag icon: same fix — no longer requires `inc.duplicate_of` to be non-null alongside `inc.is_duplicate`.
- Button: duplicate incidents now show a **purple "Review" button** instead of the green Accept; Review's `onClick` sets `validatorDupTarget` and `validatorDupMatchedId` directly (same path as the old Accept duplicate branch).

#### Fix 7 — Accept confirmation modal with revision history
**Files:** `src/frontend/src/app/dashboard/validator/page.tsx`, `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx`

Added `confirmAcceptTarget` state to the validator dashboard. Accept button sets it; a modal renders with incident summary, a "View revision history" toggle (`IncidentDiffPanel`), Cancel, and Confirm Accept. Confirm calls `handleDirectAccept()`.

Same pattern added to the incident detail view: `showAcceptConfirm` + `showAcceptConfirmDiff` state; Accept button opens the modal; Confirm calls `submitValidatorAction({ action: 'accept' })`. `IncidentDiffPanel` imported.

#### Fix 8 — Purple "RESUBMITTED" flag for re-submitted rejected incidents
**Files:** `src/postgres-init/40_add_resubmitted_flag.sql` (new), `src/backend/services/regional_incidents/lifecycle.py`, `src/backend/api/routes/regional.py`, `src/frontend/src/app/dashboard/validator/page.tsx`

- DB: `ALTER TABLE wims.fire_incidents ADD COLUMN IF NOT EXISTS is_resubmitted BOOLEAN NOT NULL DEFAULT FALSE`.
- `submit_incident_for_review_command`: sets `is_resubmitted = TRUE` in the status UPDATE SQL when `current_status == 'REJECTED'`.
- Validator queue SELECT: added `fi.is_resubmitted`; response dict includes `"is_resubmitted": bool(r[19])`.
- `ValidatorIncident` type: added `is_resubmitted: boolean`.
- Validator queue status cell: purple **RESUBMITTED** badge rendered when `inc.is_resubmitted && ['PENDING', 'PENDING_VALIDATION'].includes(inc.verification_status)`. No separate filter — counts as PENDING.

---

### 2026-05-30 — Post-plan bug batch: archive mechanics, dotNav, badge sync, resubmit, duplicate flagging

Three follow-up bug batches reported after the plan above was completed.

#### Fix 9 — Archive REJECTED incidents

**File:** `src/backend/services/regional_incidents/policies.py`
`VALIDATOR_ARCHIVABLE_STATUSES` changed from `("VERIFIED", "REPLACED")` to `("VERIFIED", "REPLACED", "REJECTED")`. Rejected incidents can now be soft-archived (`is_archived = TRUE`). Records are preserved and visible in archive view — not deleted.

#### Fix 10 — SectionDotNav animation stuck

**File:** `src/frontend/src/components/SectionDotNav.tsx` (full rewrite)

**Root cause:** IntersectionObserver fired during the smooth-scroll animation and overwrote the active dot that the user just clicked, causing the dot to flicker back to the previous section mid-animation.

Changes:
- Added `suppressRef` + `suppressTimerRef`: 700 ms window after a click during which observer callbacks are ignored.
- Optimistic `setActiveId(sectionId)` on click — dot activates immediately, not after the observer fires.
- Replaced `intersectionRatio`-sort (unreliable during animation) with a `Map` tracking all currently intersecting sections; the topmost entry wins.
- Root margin narrowed to `-10% 0px -50% 0px` (was `-20% 0px -65% 0px`) for a wider active band.
- Thresholds: `[0, 0.1, 0.25, 0.5, 1]` (was `[0.1, 0.25, 0.5]`).
- Tooltip slide increased from `1px` → `2px` for visual feedback.
- Applies to: manual entry form (`/afor/create`), wildland form, AFOR import page, and edit/view incident pages.

#### Fix 11 — "Try searching All Time" hint only when filter is not already All Time

**Files:** `src/frontend/src/app/dashboard/validator/page.tsx`, `src/frontend/src/app/dashboard/regional/page.tsx`
Empty-state hint "Try searching All Time" and the "Search All Time" shortcut button are now wrapped in `{dateFilter !== 'all' && ...}` — previously showed even when All Time was already active, which was misleading.

#### Fix 12 — Validator archive silently no-ops on VERIFIED incidents (root cause fix)

**File:** `src/postgres-init/41_fix_immutable_rule_for_archive.sql` (new migration)

**Root cause:** The PostgreSQL rule `no_update_verified` (migration 17, narrowed in 29) uses `DO INSTEAD NOTHING` to block all UPDATE statements on VERIFIED rows. The archive UPDATE (`SET is_archived = TRUE, archived_at = now()`) silently matched the rule — no error, no rollback, the backend returned 200, but no row was ever changed.

Fix: the new migration drops and recreates the rule with a third exception for the `is_archived FALSE→TRUE` transition:

```sql
CREATE RULE no_update_verified AS
    ON UPDATE TO wims.fire_incidents
    WHERE (
        OLD.verification_status = 'VERIFIED'
        AND NEW.verification_status != 'REPLACED'
        AND NOT (NEW.is_archived = TRUE AND OLD.is_archived = FALSE)
    )
    DO INSTEAD NOTHING;
```

**Critical**: this migration does NOT auto-run on existing containers. Apply manually:
```
docker compose exec -T postgres psql -U postgres -d wims < src/postgres-init/41_fix_immutable_rule_for_archive.sql
```

This fix also unblocks the encoder archive endpoint (Fix 15) for any VERIFIED row.

#### Fix 13 — Pending/Rejected count badges stale

**Root cause:** Stats were only refetched when the stats period chip changed. Queue/list reloads (accept, reject, archive actions) did not trigger a stats refresh, so badge counts stayed at the pre-action values until the user manually changed the period chip.

**Validator** (`src/frontend/src/app/dashboard/validator/page.tsx`):
- Added `statsDateBoundsRef` (a `useRef` that mirrors `statsDateBounds`).
- Inside `fetchQueue` success path: `void fetchValidatorStats(statsDateBoundsRef.current).then(setStats).catch(() => {})`.
- Stats now refresh after every queue load (accept, reject, archive, page change).

**Encoder** (`src/frontend/src/app/dashboard/regional/page.tsx`):
- Added `loadStatsRef` (a `useRef` that mirrors `loadStats`).
- Inside `loadIncidents` success path: `void loadStatsRef.current().catch(() => {})`.
- Stats now refresh after every incident list load (archive action, background 20 s poll, page change).

The `useRef` pattern avoids adding `statsDateBounds`/`loadStats` to dep arrays, which would cause spurious re-fetches.

#### Fix 14 — Restore banner appeared in import-correction mode

**Files:** `src/frontend/src/components/IncidentForm.tsx`

**Root cause:** `existingIncidentId` (used in edit mode) was `null` when correcting an imported AFOR row (`initialData` set, `existingIncidentId` null). The restore banner check only guarded on `existingIncidentId`, so it appeared and the autosave effect fired — overwriting the real create-mode draft in `localStorage`.

Fix: all three guards now check both conditions:
- Restore effect: `if (existingIncidentId || initialData) return;`
- Autosave effect: `if (existingIncidentId || initialData) return;` + `initialData` added to deps.
- Banner JSX: `{draftRestoreData && !existingIncidentId && !initialData && (...)}`

#### Fix 15 — Encoder archive capability (new endpoint + UI)

**Backend** (`src/backend/api/routes/regional.py`):
New `PATCH /api/regional/incidents/{incident_id}/archive` endpoint (inserted before `/{id}/submit`):
- Auth: `get_regional_encoder` — encoder must own the incident (`encoder_id` match).
- Only accepts VERIFIED incidents (`is_archived = FALSE`). Returns 400 for any other status (DRAFT/REJECTED use the existing DELETE soft-delete endpoint).
- Sets `is_archived = TRUE`, `archived_at = now()`, `updated_at = now()`.

**Frontend** (`src/frontend/src/app/dashboard/regional/page.tsx`):
- `doEncoderArchive(incidentId, e)` function: calls `PATCH /regional/incidents/{id}/archive`, then `loadIncidents()`.
- `archiveError` state: shown in a dismissable banner above the incident list on failure.
- Card view: "Archive" button at bottom-right of VERIFIED cards (hidden in archive view).
- Table view: new "Actions" column header + Archive button cell for VERIFIED rows; `colSpan` on loading/empty states updated from 6 → 7 (normal) / 6 (archive view).

#### Fix 16 — Resubmit transaction rollback on REJECTED incidents

**File:** `src/backend/services/regional_incidents/lifecycle.py`

**Root cause:** `submit_incident_for_review_command` unconditionally included `is_resubmitted = TRUE` in the UPDATE SQL when resubmitting a REJECTED incident. On containers where migration `40` had not been applied (all existing running containers), PostgreSQL raised `psycopg2.errors.UndefinedColumn` → caught by the broad `except Exception` → `db.rollback()` → 500 "Transaction rolled back".

Fix: added `_lc_has_resubmitted_column(db)` helper (module-level `bool | None` cache, same pattern as the `regional.py` `_col_exists` cache). The `is_resubmitted = TRUE` SET clause is only emitted when the column exists:

```python
resubmitted_flag = (
    "is_resubmitted = TRUE, "
    if current_status == "REJECTED" and _lc_has_resubmitted_column(db)
    else ""
)
```

Works on both old containers (column absent → no flag, no crash) and new containers (column present → flag set, RESUBMITTED badge appears). Apply column to running containers:
```
docker compose exec -T postgres psql -U postgres -d wims -c "ALTER TABLE wims.fire_incidents ADD COLUMN IF NOT EXISTS is_resubmitted BOOLEAN NOT NULL DEFAULT FALSE;"
```

#### Fix 17 — Duplicate flagged immediately on submit (including force-submit)

**File:** `src/backend/services/regional_incidents/lifecycle.py`

**Root cause:** The duplicate-flagging block inside `submit_incident_for_review_command` was guarded by `if ack_duplicate and not already_flagged`. When the encoder clicked "Submit Anyway" (`force=true`, `ack_duplicate=false`), the block was skipped entirely — `is_duplicate` stayed `FALSE` — so the DUPLICATE badge and "Review" button in the validator queue only appeared after the validator clicked Accept and got a 409.

Fix: condition changed to `if (ack_duplicate or force) and not already_flagged`. Both acknowledgement-submit and force-submit paths now:
1. Run `check_for_duplicate()`.
2. If a match is found, persist `is_duplicate = TRUE` and `duplicate_of = <matched_id>` before the status transition to PENDING.

The validator queue immediately shows the DUPLICATE badge and purple "Review" button without any validator interaction.

---

#### Fix 18 — Stale duplicate flag on resubmit of REJECTED incidents

**File:** `src/backend/services/regional_incidents/lifecycle.py`

**Root cause:** `submit_incident_for_review_command` read `already_flagged` from the DB and used it as a gate for both the normal duplicate check (`if not force and not already_flagged`) and the force/ack flag-setting path (`if (ack_duplicate or force) and not already_flagged`). When a REJECTED incident had `is_duplicate = TRUE` from before:
- `already_flagged = True`
- Normal check: skipped (encoder gets no 409 even if incident is still a duplicate)
- Force/ack path: skipped (flag stays stale)
- Main UPDATE: only sets `verification_status = 'PENDING'` — `is_duplicate` never cleared
- Validator queue: DUPLICATE badge shown even after encoder changed date, time, coordinates

**Fix:**
```python
is_resubmission = current_status == "REJECTED"
if is_resubmission:
    already_flagged = False  # force fresh check; old flag is based on old data
```

And in the UPDATE:
```python
dup_clear_sql = (
    "is_duplicate = FALSE, duplicate_of = NULL, "
    if is_resubmission and matched_duplicate_id is None
    else ""
)
```

The fresh check raises 409 if the incident is still a near-duplicate; encoder can force-submit. If no duplicate, `is_duplicate` and `duplicate_of` are explicitly cleared before transitioning to PENDING.

#### Fix 19 — Validator archive self-healed via startup patch

**File:** `src/backend/main.py`

**Root cause:** Migration `41_fix_immutable_rule_for_archive.sql` narrowed the `no_update_verified` PostgreSQL rule to allow `is_archived FALSE→TRUE` updates on VERIFIED rows. But `postgres-init/` scripts only run on first boot — existing running containers kept the old rule that silently swallowed the archive UPDATE.

**Fix:** Added `@app.on_event("startup")` hook `apply_schema_patches()`. On every backend container restart, it:
1. `DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents`
2. `CREATE RULE no_update_verified AS ON UPDATE ... WHERE (OLD.verification_status = 'VERIFIED' AND NEW.verification_status != 'REPLACED' AND NOT (NEW.is_archived = TRUE AND OLD.is_archived = FALSE)) DO INSTEAD NOTHING`
3. Commits; logs the outcome

The hook is idempotent and non-fatal (warning logged on failure). After any backend restart (`docker compose restart backend` or `up --build`), the rule is up to date — no manual `docker exec` required.

---

**Outstanding issues (updated):**

| Issue | Severity | Notes |
|-------|----------|-------|
| `useSearchParams()` without Suspense in `/incidents/triage` and `/dashboard/analyst/[workflow]` | Low | Same pattern as the fixed afor pages — not yet reported crashing but at risk |
| `M4-D`: AFOR import per-row duplicate decision UI | Deferred | Explicitly deferred from M4 milestone; `DuplicateResolutionModal` exists but per-row review UI in import flow is minimal |
| `test_delete_pending_blocked` | Pre-existing | Backend DELETE allows deleting PENDING incidents (should block) |
| Bulk approve atomicity | Pre-existing | No rollback on mid-batch failure |
| Migration 40 (`is_resubmitted`) for running containers | Operational | Fresh Docker boots run it automatically; existing containers need: `docker compose exec -T postgres psql -U postgres -d wims -c "ALTER TABLE wims.fire_incidents ADD COLUMN IF NOT EXISTS is_resubmitted BOOLEAN NOT NULL DEFAULT FALSE;"` |

**Recommended next steps:**
1. **Restart the backend** to trigger `apply_schema_patches()` — this self-heals the archive rule: `docker compose restart backend`
2. Apply `is_resubmitted` column if not already applied (see Fix 16 above).
3. Smoke-test the full test plan in `PR.md`.
4. Address the `useSearchParams()` pattern in `/incidents/triage` and analyst workflow pages.
5. Consider implementing M4-D (per-row duplicate decision in AFOR import) as the next milestone item.
