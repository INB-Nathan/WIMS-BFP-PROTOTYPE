# PR: fix/module-2/barangay-input

## Branch
`fix/module-2/barangay-input` → `master`

## Summary

This PR delivers 6 encoder-workflow fixes identified during QA on the M4 batch, plus two cross-cutting improvements (audit log CSV export and dashboard UX polish).

### 1. Region hardset enforced on first login

**Root cause:** The OIDC callback page called `refreshSession()` (AuthContext) but never called `refreshProfile()` (UserProfileProvider in `lib/auth.tsx`, which `IncidentForm` reads `assignedRegionId` from). Both providers are in the root layout — both have already run their initial `fetchProfile` before the cookie exists. Only `AuthContext` was told to re-fetch after the cookie was set; `UserProfileProvider` stayed at `{assignedRegionId: null}` until a manual page refresh.

**Fix:** `callback/page.tsx` now calls `await Promise.all([refreshSession(), refreshProfile()])` before `router.push('/dashboard')`. Both providers are warm on first login; region lock applies immediately without a refresh.

**Secondary fix:** `IncidentForm`'s `referenceNumberPreview` useMemo now uses `assignedRegionId` directly for encoders instead of `selectedRegionId`, which could be stale during the auth-loading window.

**Files changed:**
- `src/frontend/src/app/callback/page.tsx`
- `src/frontend/src/components/IncidentForm.tsx`

---

### 2. Encoder activity log: CSV export

Added a downloadable CSV export for the encoder's own activity log — same filters as the paginated view.

**Format:**
```
History ID, Incident ID, Action, Previous Status, New Status, City / Municipality, Timestamp (PHT)
```
Action labels are human-readable (e.g. `Submitted for Review` not `SUBMITTED`). Timestamps are formatted as `YYYY-MM-DD HH:MM:SS PHT`.

**Files changed:**
- `src/backend/api/routes/regional.py` — new `GET /regional/audit-log/export` endpoint
- `src/frontend/src/app/dashboard/regional/audit/page.tsx` — Export CSV button

---

### 3. Validator audit log: professional CSV format + CREATED_DRAFT excluded

The existing validator CSV export used raw snake_case column names and raw UTC ISO timestamps. Additionally, `CREATED_DRAFT` entries (encoder draft saves) were appearing in the validator's audit trail, adding noise irrelevant to the validation workflow.

**New format:**
```
History ID, Incident ID, Region ID, Region, Actor (User ID), Actor (Username),
Previous Status, New Status, Action, Notes, Timestamp (PHT)
```
Action labels are human-readable. Timestamps are localized to PHT (UTC+8). Filename changed from `audit-log-YYYYMMDD.csv` to `wims-audit-trail-YYYYMMDD.csv`.

`CREATED_DRAFT` rows are now excluded from both the paginated list and CSV export for validators. This is enforced in `_build_audit_log_query` so both endpoints are consistent.

**Files changed:**
- `src/backend/api/routes/regional.py` — updated `export_validator_audit_logs`; updated `_build_audit_log_query` to exclude `CREATED_DRAFT`

---

### 4. Encoder dashboard: distinguish DRAFT from PENDING

DRAFT and PENDING incidents previously shared the same yellow badge, making drafts hard to spot at a glance.

**Changes:**
- **DRAFT rows:** `bg-gray-50` background + `bg-gray-200 text-gray-600` badge
- **PENDING rows:** `bg-white` + existing `bg-yellow-100 text-yellow-800` badge (unchanged)
- **Drafts quick-filter button:** hollow style when inactive (red border, red text, transparent background); solid red background with white text when active — no change to button size

**Files changed:**
- `src/frontend/src/app/dashboard/regional/page.tsx`

---

## Files changed

| File | Change |
|------|--------|
| `src/frontend/src/app/callback/page.tsx` | Call `refreshProfile()` after OIDC callback |
| `src/frontend/src/components/IncidentForm.tsx` | Use `assignedRegionId` in reference number preview for encoders |
| `src/backend/api/routes/regional.py` | New encoder CSV export endpoint; improved validator CSV headers/timestamps; exclude `CREATED_DRAFT` from validator audit trail |
| `src/frontend/src/app/dashboard/regional/audit/page.tsx` | Export CSV button; refactored `buildParams` helper |
| `src/frontend/src/app/dashboard/regional/page.tsx` | DRAFT/PENDING visual distinction; Drafts button hollow-inactive / solid-active styling |

## Test plan

- [ ] **First-login region lock:** Create a new REGIONAL_ENCODER user assigned to Region 1. Log in fresh (clear cookies). Navigate to `/afor/create` — region field must show read-only "Region I" immediately, without requiring a page refresh.
- [ ] **Reference number preview:** On `/afor/create` as a Region 1 encoder, the preview should show the Region 1 identifier from the first render.
- [ ] **Encoder CSV export:** Go to `/dashboard/regional/audit`, apply any filter, click Export CSV — file downloads as `encoder-activity-log-YYYYMMDD.csv` with professional headers and PHT timestamps.
- [ ] **Validator CSV export:** Go to `/dashboard/validator/audit`, click Export CSV — file downloads as `wims-audit-trail-YYYYMMDD.csv` with professional headers and no `Created Draft` rows.
- [ ] **Validator audit list:** No `Created Draft` entries appear in the paginated validator audit log.
- [ ] **DRAFT/PENDING distinction:** On the encoder dashboard, DRAFT rows have a gray tint and gray badge; PENDING rows are white with yellow badge.
- [ ] **Drafts filter button (inactive):** Button is hollow — transparent background, red border, red text.
- [ ] **Drafts filter button (active):** Click Drafts — button fills solid red with white text, no size change. Click again to deactivate — returns to hollow style.
- [ ] **CI/CD:** `npm run lint` and `ruff check` both pass with zero issues.

## Notes

- `_ACTION_LABEL_MAP`, `_PHT`, and `_fmt_pht()` are shared by the new encoder export and the updated validator export — defined once before `_build_audit_log_query`.
- The `forceReplaceIncident` import in `IncidentForm.tsx` is intentionally kept — it is still used inside the duplicate-resolution flow at the form level.
- `CREATED_DRAFT` is excluded at the query level in `_build_audit_log_query`, so both the paginated list and the CSV export stay consistent without duplicating the filter.
