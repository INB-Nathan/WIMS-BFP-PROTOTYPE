# Regional Dashboard Handover

> **Audience:** AI assistant sessions continuing work on the Encoder/Validator subsystem.  
> **Last updated:** 2026-05-27 (branch `fix/enc-val-bugs-and-UI`)

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
