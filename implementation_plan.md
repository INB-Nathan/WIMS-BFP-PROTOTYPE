# Regional Office Access & AFOR Import Feature

Panel defense feedback requires implementing a `REGIONAL_ENCODER` role with strict regional data isolation, a dedicated regional dashboard, and an AFOR file import module. The existing codebase already has `assigned_region_id` on users and `region_id` on fire incidents, so most infrastructure is in place.

## User Review Required

> [!IMPORTANT]
> **New Role Name**: Using `REGIONAL_ENCODER` (separate from existing `ENCODER` which is used for NHQ staff). This keeps role semantics clean — NHQ encoders see all regions, regional encoders see only their assigned region. If you'd prefer to reuse `ENCODER` with region-based logic only, let me know.

> [!IMPORTANT]
> **Data Isolation Approach**: Using **FastAPI query-filter isolation** (Option B from your requirements) rather than PostgreSQL RLS. Rationale: the app connects via a shared `postgres` DB user — RLS would require `SET app.region_id` per-session which adds complexity and doesn't leverage Keycloak JWTs naturally. The query-filter approach matches the existing pattern used throughout the codebase.

> [!WARNING]
> **AFOR Backend Parsing**: Adding `openpyxl` and `python-multipart` to [requirements.txt](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/requirements.txt) means the Docker image needs rebuilding (`docker compose up --build`). The existing backend Dockerfile handles this automatically.

---

## Proposed Changes

### Auth & Database (Role + Keycloak)

#### [MODIFY] [schema_v2.sql](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/supabase/schema_v2.sql)
- Add `REGIONAL_ENCODER` to the `wims.users.role` CHECK constraint so the canonical schema reflects the new role.

#### [NEW] [20260315000000_add_regional_encoder_role.sql](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/supabase/migrations/20260315000000_add_regional_encoder_role.sql)
- Migration SQL to `ALTER TABLE wims.users DROP CONSTRAINT ... ADD CONSTRAINT` including `REGIONAL_ENCODER` in the role enum.

#### [MODIFY] [auth.py](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/auth.py)
- Add `get_regional_encoder` dependency function: validates user has `REGIONAL_ENCODER` role and returns their `assigned_region_id`. Rejects with 403 if no region assigned.
- Add `get_regional_user` dependency: allows any user with `assigned_region_id` (for shared endpoints).

#### [MODIFY] [admin.py](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/api/routes/admin.py)
- Add `REGIONAL_ENCODER` to `VALID_ROLES` tuple (line 22).

#### Keycloak Configuration (Manual Steps)
1. Open Keycloak Admin → `bfp` realm → **Realm Roles** → Create role `regional_encoder`
2. Go to **Client Scopes** → `roles` → **Mappers** → Verify `realm roles` mapper includes the new role in tokens
3. For region assignment: Go to the user → **Attributes** → Add `region_id` attribute (this is mapped to `wims.users.assigned_region_id` during JIT provisioning, not read from the JWT — matching the existing pattern)
4. Assign the `regional_encoder` realm role to the target user

---

### Backend — Regional API Router

#### [NEW] [regional.py](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/api/routes/regional.py)
New FastAPI router with prefix `/api/regional`, all endpoints protected by `get_regional_encoder`:

- **`GET /api/regional/incidents`** — Fetches incidents filtered by user's `assigned_region_id`, joins `incident_nonsensitive_details` for summary data. Returns paginated list.
- **`GET /api/regional/incidents/{id}`** — Single incident detail (region-scoped).
- **`POST /api/regional/afor/import`** — File upload endpoint:
  - Accepts `multipart/form-data` with [.xlsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/Proposed-New-AFOR_Nov-2025.xlsx) or [.csv](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/erd.csv) file
  - Uses `openpyxl` for [.xlsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/Proposed-New-AFOR_Nov-2025.xlsx) parsing, [csv](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/erd.csv) module for [.csv](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/erd.csv)
  - Maps AFOR template columns (sections A–L from the attached template) to `fire_incidents` + `incident_nonsensitive_details` + `incident_sensitive_details`
  - Returns parsed rows with validation errors for preview
- **`POST /api/regional/afor/commit`** — Commits previewed/validated rows to DB, creates `data_import_batch` and inserts incidents.
- **`GET /api/regional/stats`** — Quick summary stats (total incidents, by category, by alarm level) scoped to region.

#### [MODIFY] [main.py](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/main.py)
- Import and register the new `regional` router.

#### [MODIFY] [requirements.txt](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/requirements.txt)
- Add `openpyxl>=3.1.0` and `python-multipart>=0.0.9`.

#### AFOR Column-to-Schema Mapping (from CSV analysis):

| AFOR Section | CSV Field | DB Table | DB Column |
|---|---|---|---|
| A.1 | Responder Type | nonsensitive | `responder_type` |
| A.1 | Fire Station Name | nonsensitive | `fire_station_name` |
| A.2-3 | Date/Time Notification | nonsensitive | `notification_dt` |
| A.4 | Region/Province/City/Address | incidents + nonsensitive | `region_id`, `city_id`, `barangay_id` |
| A.5 | Nearest Landmark | sensitive | `landmark` |
| A.6 | Caller Name/Contact | sensitive | `caller_name`, `caller_number` |
| A.7 | Receiver Name | sensitive | `receiver_name` |
| A.9-10 | Dispatch/Arrival Times | `responding_units` | `dispatch_dt`, `arrival_dt` |
| A.11 | Response Time | nonsensitive | `total_response_time_minutes` |
| A.13 | Highest Alarm | nonsensitive | `alarm_level` |
| A.15 | Gas Consumed | nonsensitive | `total_gas_consumed_liters` |
| B.16 | Classification | nonsensitive | `general_category` |
| B.17 | Owner/Establishment | sensitive | `owner_name`, `establishment_name` |
| B.19 | Area of Origin | nonsensitive | `fire_origin` |
| B.20 | Stage of Fire | nonsensitive | `stage_of_fire` |
| B.21 | Extent of Damage | nonsensitive | `extent_of_damage` |
| B.22-26 | Affected counts | nonsensitive | `structures_affected`, etc. |
| C.27-29 | Resources/Tools | nonsensitive | `resources_deployed` (JSONB) |
| D.30 | Alarm Timeline | nonsensitive | `alarm_timeline` (JSONB) |
| E.32 | Casualties | sensitive | `casualty_details` (JSONB) |
| F.33 | Personnel | sensitive | `personnel_on_duty` (JSONB) |
| G.34 | Other Personnel | sensitive | `other_personnel` (JSONB) |
| I.36 | Narrative | sensitive | `narrative_report` |
| J.37 | Problems | nonsensitive | `problems_encountered` (JSONB) |
| K.38 | Recommendations | nonsensitive | `recommendations` |
| L.39 | Disposition | sensitive | `disposition`, `disposition_prepared_by`, `disposition_noted_by` |

---

### Frontend — Sidebar, Auth Types, and API Client

#### [MODIFY] [Sidebar.tsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/components/Sidebar.tsx)
- Add `REGIONAL_ENCODER` case to [getNavSections()](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/components/Sidebar.tsx#152-199) with links to:
  - `/dashboard/regional` (Regional Dashboard)
  - `/afor/import` (AFOR Import)
  - `/afor/create` (Manual AFOR Entry → reuses existing [IncidentForm](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/components/IncidentForm.tsx#9-608))

#### [MODIFY] [auth.tsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/lib/auth.tsx)
- Add `REGIONAL_ENCODER` to the role union type (line 13).

#### [MODIFY] [api.ts](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/lib/api.ts)
- Add `fetchRegionalIncidents()`, `fetchRegionalStats()`, `importAforFile()`, `commitAforImport()` API functions.

---

### Frontend — Regional Dashboard Page

#### [NEW] [page.tsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/app/dashboard/regional/page.tsx)
- Role-gated page for `REGIONAL_ENCODER` only
- Summary cards (total incidents, by category, by alarm level) using `/api/regional/stats`
- Data table showing recent incidents from `/api/regional/incidents` with sortable columns
- Region name displayed in header
- Follows existing dashboard design patterns (card system, maroon accent, filter bar)

---

### Frontend — AFOR Import Page

#### [NEW] [page.tsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/app/afor/import/page.tsx)
- **Step 1: Upload** — Drag-and-drop zone for [.xlsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/Proposed-New-AFOR_Nov-2025.xlsx) / [.csv](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/erd.csv) files (reuses existing [xlsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/Proposed-New-AFOR_Nov-2025.xlsx) npm package already in [package.json](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/package.json))
- **Step 2: Backend Parse** — Sends file to `POST /api/regional/afor/import`, receives parsed rows with per-row validation status
- **Step 3: Preview/Edit** — Tabular review with inline editing, error highlighting (same pattern as existing [/incidents/import/page.tsx](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/frontend/src/app/incidents/import/page.tsx))
- **Step 4: Commit** — Sends validated rows to `POST /api/regional/afor/commit`
- PWA offline-fallback: Shows a "You're offline" banner if `!navigator.onLine`, disables upload buttons

---

## Verification Plan

### Automated Tests

#### Existing infrastructure test (no changes needed, just confirm no regressions):
```bash
cd e:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\backend
python -m pytest tests/test_infra_config.py -v
```

#### New unit test for AFOR parsing logic:
A new test file `tests/test_afor_import.py` will be created to test the AFOR CSV/XLSX parsing function in isolation (no DB required). It will:
- Test parsing a sample CSV string with valid data
- Test parsing with missing required fields (should return validation errors)
- Test column name mapping tolerates common variants

```bash
cd e:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\backend
python -m pytest tests/test_afor_import.py -v
```

### Manual Verification (after `docker compose up --build`)

1. **Role Migration**: Connect to the running Postgres container and verify the new CHECK constraint:
   ```bash
   docker exec -it wims-postgres psql -U postgres -d wims -c "\d wims.users"
   ```
   Confirm `REGIONAL_ENCODER` appears in the role constraint.

2. **Keycloak Setup**: Use the existing [setup_roles_and_users.ps1](file:///e:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/setup_roles_and_users.ps1) pattern to create a test `regional_encoder` user, or manually add via Keycloak Admin UI at `http://localhost/auth`.

3. **Regional Dashboard**: Log in as the regional encoder user → verify sidebar shows "Regional Dashboard" and "AFOR Import" links → click through and confirm the dashboard loads with region-scoped data.

4. **AFOR Import Flow**: Navigate to AFOR Import → upload the provided `Proposed-New-AFOR_Nov-2025 - AFOR.csv` → verify the preview table shows parsed rows with validation status → fix any errors → submit → verify data appears in the regional dashboard.

> [!NOTE]
> The AFOR CSV template is a _form template_, not tabular data — each row is a field label, not a data row. The backend parser will handle this form-oriented layout for single-AFOR imports, as well as a "flat tabular" format for bulk imports (matching the existing import page pattern).
