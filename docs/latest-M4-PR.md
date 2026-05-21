# fix: AFOR import gaps, data persistence, audit trails, UI/UX polish

## Summary

- AFOR XLSX import: General Description, Alarm Commanders, "Others" free-text (C219), and Prepared/Noted by now correctly read and stored
- AFOR import blocked when XLSX region doesn't match encoder's assigned region
- Encoder region lock hardened: province/city cleared if pre-filled from wrong region; save validates province belongs to encoder's region
- All edited fields (owner name, general description, vehicles affected, floor/land area) now persist correctly on edit
- Prepared by / Noted by block submission when blank or set to "N/A" (both create and edit paths)
- Regional dashboard location fixed — was always showing "Agoncillo, Batangas" due to hardcoded ref IDs
- Validator Audit Trail 500 error fixed; pagination added (15/page) with username, role, region, and action filters
- Encoder Activity Log pagination added (15/page) with action, city, and date filters; added to sidebar
- Validator and Encoder dashboards paginate at 10 incidents
- Validator Audit Trail added as sidebar tab for NATIONAL_VALIDATOR
- Map picker rejects coordinates outside Philippine bounds; search box always visible above map
- Alarm timeline date/time display split into separate Date and Time columns with Commander column
- Province/city/district validated before draft save and before submit; missing fields popup catches "N/A" stored values
- Extent of Damage radio change clears stale sub-fields; floor/land area edits now persist
- Region field rendered as plain text for encoders (no dropdown arrow)
- Accept/Reject buttons hidden while reject textarea is open
- Validator audit UUID filter replaced with username text search + role dropdown
- Validator dashboard encoder UUID filter replaced with region dropdown
- "VALIDATOR" role included in `is_validator` check (was causing 404s)
- `extent_description` and `extent_objects_count` now persisted from manual entry form
- XLSX import now logs `CREATED_DRAFT` in Activity Log
- Back-to-dashboard buttons styled yellow for visibility

## Changed Files

| File | Change |
|------|--------|
| `src/backend/api/routes/regional.py` | AFOR cell reads (commanders, prepared/noted by, Others C219, description); VALIDATOR in is_validator; audit COUNT query fix; location list uses text columns; owner_name plaintext mirror; general_description/vehicles_affected/floor-land-area in update; encoder audit filters; validator audit username/role filter |
| `src/backend/api/routes/incidents.py` | Add extent_description, extent_objects_count to upload-bundle INSERT |
| `src/postgres-init/25_extent_fields.sql` | New: extent_description TEXT, extent_objects_count INT |
| `src/postgres-init/28_general_description_column.sql` | New: general_description_of_involved TEXT column |
| `src/frontend/src/components/IncidentForm.tsx` | Region shown as plain text for encoders; extent sub-fields cleared on radio change; N/A validation; region mismatch message; update payload includes all edited fields; province/city save guard; scroll-to-error; province initialized from initialData on edit |
| `src/frontend/src/components/MapPickerInner.tsx` | Philippines bounds validation; search box always visible at 280px height |
| `src/frontend/src/components/Sidebar.tsx` | Activity Log in encoder sidebar; Audit Trail in validator sidebar |
| `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` | Alarm timeline Date/Time/Commander columns; N/A guard on submit; region constraint check; missing field highlighting; yellow back button |
| `src/frontend/src/app/dashboard/regional/page.tsx` | Add New Incident button; removed Activity Log link |
| `src/frontend/src/app/dashboard/regional/audit/page.tsx` | Pagination (15/page); action, city, date filters; yellow back button |
| `src/frontend/src/app/dashboard/validator/page.tsx` | Pagination (10/page); region dropdown filter |
| `src/frontend/src/app/dashboard/validator/audit/page.tsx` | Pagination (15/page); username + role + action filters; encoder actions in filter list; yellow back button |
| `src/frontend/src/app/afor/import/page.tsx` | Block import if AFOR region differs from encoder's assigned region |
| `src/frontend/src/app/afor/create/page.tsx` | Removed wildland hint text |
| `src/frontend/src/lib/afor-utils.ts` | displayValue returns N/A for 0/"0" |

## Key Bug Fixes

### AFOR XLSX Import — Data Gaps
Four fields were not reaching the database from XLSX import: (1) General Description was parsed but never written to the stored JSON; (2) Incident/Ground Commander names (column F) were not read for any of the 13 alarm level rows; (3) "Others" problem checkbox appended the literal string "Others" but ignored the free-text in C219; (4) Prepared by / Noted by read from the label row (C238/F238) instead of the data row (C239/E239).

### Regional Dashboard — Wrong Location
Every manually-created incident stored `city_id = 1` due to hardcoded values in the create payload. The list query joined the ref_cities table, always returning city #1 (Agoncillo, Batangas) regardless of the actual incident location. Fixed by removing the hardcoded IDs and switching the list query to use the city_municipality/province_district text columns directly.

### Edited Fields Not Persisting
Several fields were excluded from the update path: owner_name was blob-only (plaintext column never written); general_description_of_involved and vehicles_affected were not in IncidentUpdateRequest; floor/land area fields were not in the update payload. All now persist correctly on edit.

### Validator Audit Trail 500 Error
The paginated audit-log COUNT query was missing the JOIN on wims.users, causing a SQL error whenever the actor_username or role filter was applied. Added the same LEFT JOIN to the COUNT query.

### Prepared by / Noted by Accepted "N/A"
The form payload defaulted empty values to the string "N/A", which passed all existing checks. Added pre-submit validation in both the create form and the edit/submit path that blocks submission when either field is blank or equals "N/A" (case-insensitive).

### VALIDATOR Role — 404 on Incident Detail
The is_validator check in regional.py did not include the "VALIDATOR" role string, routing those users through the encoder branch which filters by encoder_id — returning 404 for any incident they didn't create.

### Extent of Damage — Stale Sub-Fields
Switching the Extent of Damage radio left previous sub-field values (floor area, land area, description, objects count) in form state. Those stale values were included in the submission. The radio handler now clears all sub-fields on each change, and floor/land area are included in the update payload.

## Migrations

Run on fresh container start automatically. To apply to an existing database:

```sql
-- Migration 25
ALTER TABLE wims.incident_nonsensitive_details
  ADD COLUMN IF NOT EXISTS extent_description TEXT,
  ADD COLUMN IF NOT EXISTS extent_objects_count INT;

-- Migration 28
ALTER TABLE wims.incident_nonsensitive_details
  ADD COLUMN IF NOT EXISTS general_description_of_involved TEXT;
```

## Test Checklist

- [x] Import a filled XLSX → Activity Log shows "Created Draft"; incident shows General Description, Commander names, "Others: \<text\>", and correct Prepared/Noted by
  - `_insert_incident_verification_history(..., action_label="CREATED_DRAFT")` called in commit_afor_import ✅
  - Commander names read from F88–F98 per alarm level ✅
  - Others free-text read from C219 ✅
  - Prepared/Noted by read from C239/E239 via `_first_nonempty` ✅
  - **Fixed**: general_description_of_involved was missing from commit_afor_import INSERT (bug found and fixed in this review)
- [x] Import XLSX with a different region as encoder → error shown naming both regions, no redirect
  - Backend: 400 with "Region mismatch: this AFOR is for '...', but you are assigned to '...'" ✅
  - Frontend: `setError(...)` shown, no router.push ✅
- [x] Log in as VALIDATOR role user → open any incident → detail view loads (no 404)
  - `is_validator = role in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN", "NATIONAL_ANALYST", "VALIDATOR")` ✅
- [x] Create manual AFOR, select Extent of Damage with sub-fields → switch to another option → sub-fields clear; save → verify only the relevant fields persisted
  - `handleRadioChange('extent_of_damage', ...)` clears extent_description, floor_area, land_area, objects_count ✅
- [x] Edit existing incident: change owner name, general description, vehicles affected, floor area → save → all changes appear in detail view and list
  - All fields in IncidentUpdateRequest and _apply_incident_field_updates ✅
  - owner_name mirrors to plaintext column ✅
- [x] Try submitting with Prepared by blank or "N/A" → validation blocks submission in both create form and detail view
  - Edit path: `isNaOrBlank` check at line ~999 in IncidentForm.tsx ✅
  - **Fixed**: Create path was missing the same check (bug found and fixed in this review) ✅
  - Detail view submit: `isEmpty` check in handleSubmitClick ✅
- [x] Open Regional Dashboard → incident rows show correct city and province (not "Agoncillo, Batangas")
  - List query uses `nd.city_municipality, nd.province_district` text columns; `_location_display` helper ✅
- [x] Click map outside Philippines bounds → error shown, pin does not move
  - `isInPhilippines` check with PH_BOUNDS {minLat:4.5, maxLat:21.5, minLng:116.0, maxLng:127.0} ✅
- [x] Open incident with alarm timeline → Date (MM-DD-YYYY) and Time (HH:MM) appear in separate columns; Commander column present
  - AlarmTimelineSection renders 4-column grid: Stage / Date / Time / Commander ✅
- [x] Validator Audit Trail: apply Username filter → results filter correctly (no 500 error)
  - COUNT query has `LEFT JOIN wims.users u ON u.user_id = ivh.action_by_user_id` ✅
- [x] Encoder Activity Log: apply action and city filters; pagination controls show (15/page)
  - PAGE_SIZE = 15; action + city_municipality + date filters; Prev/Next controls ✅
- [x] Validator dashboard: if >10 incidents, pagination controls appear
  - PAGE_SIZE = 10; Prev/Next controls ✅
- [x] Validator Audit Trail visible in sidebar for NATIONAL_VALIDATOR
  - `role === 'NATIONAL_VALIDATOR' || role === 'VALIDATOR'` → "Audit Trail" link ✅
- [ ] Rebuild: `cd src && docker-compose up -d --build backend frontend`

## Bugs Found and Fixed (code review pass, commit b95a7dc)

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `regional.py` `commit_afor_import` | `general_description_of_involved` not written to DB on XLSX import | Added to INSERT column/value list; reads from `ns._response.general_description_of_involved` |
| 2 | `IncidentForm.tsx` | Create path (manual entry) missing N/A guard for Prepared by / Noted by | Added `isNaOrBlank` check before `uploadBundle` call, matching the edit-path guard |
| 3 | `regional.py` `list_regional_incidents` | Category filter `VEHICULAR→TRANSPORTATION` mapping broken after canonical rename | Changed `if cat_key == "TRANSPORTATION": cat_key = "VEHICULAR"` to `if cat_key == "VEHICULAR": cat_key = "TRANSPORTATION"` |
