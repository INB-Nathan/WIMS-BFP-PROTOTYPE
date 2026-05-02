# M4: Incident Workflow (REGIONAL_ENCODER + NATIONAL_VALIDATOR)

**Status:** Open  
**Open Issues:** 9  
**Closed Issues:** 0  
**Created:** 2026-04-27  
**Updated:** 2026-04-27  

## Milestone Overview

End-to-end incident lifecycle from encoding through verification. This milestone covers the complete workflow for Regional Encoders to create and edit incidents, and National Validators to review and approve them.

**Key Stakeholders:**
- **REGIONAL_ENCODER**: Creates, imports, and edits incidents
- **NATIONAL_VALIDATOR**: Reviews, approves, rejects, and audits incidents

---

## Issues Roadmap

### M4-A: Incident Creation with PostGIS Location
**Priority:** High | **Status:** Open | **Issue #48**

#### Scope
Regional Encoder creates incidents with geometry point.

#### Details
- **Endpoint:** `POST /api/regional/incidents`
- **Request Body:** `{region_id, general_category, alarm_level, incident_date, latitude, longitude, ...}`
- **Geometry:** `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` for PostGIS
- **RLS:** Encoder can only create in their assigned region (validated in app + DB policy)
- **Frontend:** `/incidents/create` page for authenticated regional encoders

#### Exit Criteria
- [/] Encoder can create incident with map-picked coordinates
- [/] Incident appears in regional incident list

---

### M4-B: Incident Edit (Own, Non-Verified Only)
**Priority:** High | **Status:** Open | **Issue #49**

#### Scope
Regional Encoder edits their own pending incidents.

#### Details
- **Endpoint:** `PATCH /api/regional/incidents/{id}`
- **Guards:** `verification_status == PENDING_REVIEW AND encoder_id == current_user`
- **Audit Logging:** Creates audit log entry on every edit
- **Frontend:** `/dashboard/regional/incidents/[id]` edit mode

#### Exit Criteria
- [/] Encoder can edit their own `PENDING_REVIEW` incidents
- [/] Encoder cannot edit `VERIFIED` or other users' incidents
- [ ] Edit creates audit trail entry

---

### M4-C: AFOR Spreadsheet Import
**Priority:** High | **Status:** Open | **Issue #50**

#### Scope
Regional Encoder uploads xlsx files for bulk incident import.

#### Details
- **Endpoint:** `POST /api/regional/incidents/import`
- **Content-Type:** `multipart/form-data` xlsx
- **Parser:** Uses existing `parse_wildland_afor_report_data` in `regional.py`
- **Response:** `{created: N, updated: N, duplicates: N, errors: [{row, message}]}`
- **Frontend:** `/afor/import` page with file upload + import summary

#### Exit Criteria
- [ ] Encoder can import AFOR xlsx and see summary
- [ ] Import errors shown per row

---

### M4-D: Duplicate Detection on Import
**Priority:** High | **Status:** Open | **Issue #51**

#### Scope
Detect and present duplicates before committing AFOR import.

#### Details
- **Detection Query:** Before commit, query for incidents with same `(region_id, incident_date, alarm_level)` within 1km radius using `ST_DWithin`
- **UI Flow:** Show duplicates to encoder in confirmation modal
- **Encoder Options:** 
  - Skip duplicate
  - Merge (update existing)
  - Force create
- **Merge Behavior:** Update existing incident instead of creating new

#### Exit Criteria
- [ ] Import shows duplicate confirmation before commit
- [ ] Encoder can choose skip/merge/force per duplicate

---

### M4-E: Draft Save
**Priority:** Medium | **Status:** Open | **Issue #52**

#### Scope
Regional Encoder can save incident drafts and resume later.

#### Details
- **Create Draft:** `POST /api/regional/incidents/draft`
- **List Drafts:** `GET /api/regional/incidents/drafts` (own drafts only)
- **Update Draft:** `PATCH /api/regional/incidents/draft/{id}`
- **Draft Status:** `verification_status = DRAFT`, not visible to validators
- **Auto-Expiry:** Drafts expire after 30 days (Celery periodic task)

#### Exit Criteria
- [/] Encoder can save and resume drafts
- [/] Drafts do not appear in validator queue

---

### M4-F: National Validator Verification Queue
**Priority:** High | **Status:** Open | **Issue #53**

#### Scope
Upgrade existing validator queue with full workflow.

#### Details
- **Get Queue:** `GET /api/validator/incidents` (cross-region, all `PENDING_REVIEW`)
- **Verify Action:** `PATCH /api/validator/incidents/{id}/verification`
  - **Body:** `{action: approve|reject, reason?: string}`
  - **Approve:** Set `verification_status = VERIFIED`
  - **Reject:** Set `verification_status = REJECTED`, store reason
- **Audit Logging:** Create audit log entry per action
- **Frontend:** `/dashboard/validator` (upgrade existing page)

#### Exit Criteria
- [ ] Validator sees cross-region queue
- [/] Validator can approve or reject with reason
- [ ] Each action creates audit trail entry

---

### M4-G: Side-by-Side Diff View
**Priority:** Medium | **Status:** Open | **Issue #54**

#### Scope
National Validator sees original vs current values before approving.

#### Details
- **Endpoint:** `GET /api/validator/incidents/{id}/diff`
- **Response:** `{original: {...}, current: {...}, changed_fields: [...]}`
- **Compare Fields:** All fields in `incident_nonsensitive_details`
- **Frontend:** Diff view panel in validator queue item detail modal

#### Exit Criteria
- [ ] Validator sees what changed before approving

---

### M4-H: Bulk Approve
**Priority:** Medium | **Status:** Open | **Issue #57**

#### Scope
National Validator can approve multiple incidents in a single action.

#### Details
- **Endpoint:** `POST /api/validator/incidents/bulk-approve`
- **Request Body:** `{incident_ids: [uuid]}`
- **Validation:** Validates all are `PENDING_REVIEW` before proceeding
- **Atomicity:** Atomic rollback on failure (all-or-nothing)
- **Audit:** Creates audit log entry per incident
- **Response:** `{approved: N, failed: [{id, reason}]}`
- **Frontend:** Checkbox selection in validator queue + bulk approve button

#### Exit Criteria
- [ ] Validator can select multiple incidents and approve in one click
- [ ] Partial failure (some not `PENDING_REVIEW`) does not approve any

---

### M4-I: Validator Audit Trail Viewer
**Priority:** Medium | **Status:** Open | **Issue #55**

#### Scope
National Validator can view all verification actions across regions.

#### Details
- **Endpoint:** `GET /api/validator/audit-logs`
- **Available Filters:** 
  - `date_from`, `date_to`
  - `region_id`
  - `validator_id`
  - `action` (approve/reject)
- **Export:** `GET /api/validator/audit-logs/export?format=csv`
- **Frontend:** `/dashboard/validator/audit` page with filters and export

#### Exit Criteria
- [ ] Validator can search audit trail by date, region, action
- [ ] Validator can export as CSV

---

## Implementation Order (Suggested)

1. **M4-A** (Incident Creation) - Foundation
2. **M4-B** (Incident Edit) - Encoder workflow
3. **M4-C** (AFOR Import) - Bulk operations
4. **M4-D** (Duplicate Detection) - Quality gate for imports
5. **M4-E** (Draft Save) - Convenience feature
6. **M4-F** (Validator Queue) - Validator workflow foundation
7. **M4-G** (Diff View) - Validator UX enhancement
8. **M4-H** (Bulk Approve) - Validator efficiency
9. **M4-I** (Audit Trail) - Compliance & monitoring

---

## Database & API Layer Requirements

### Status Values
- `DRAFT` - Encoder working on draft
- `PENDING_REVIEW` - Submitted for validation
- `VERIFIED` - Approved by validator
- `REJECTED` - Rejected with reason

### Key Audit Events
- Incident created
- Incident edited
- Incident submitted for review
- Incident verified/approved
- Incident rejected
- Bulk approval action
- Audit log exported

### PostGIS/Geometry
- All incidents require `geometry` field: `Point(longitude, latitude)` with SRID 4326
- Duplicate detection uses `ST_DWithin` for spatial queries
- 1km radius = ~0.009 degrees (approximate)

---

## Frontend Routes

| Route | Role | Purpose |
|-------|------|---------|
| `/incidents/create` | REGIONAL_ENCODER | Create new incident |
| `/dashboard/regional/incidents/[id]` | REGIONAL_ENCODER | Edit own incident |
| `/dashboard/regional/incidents` | REGIONAL_ENCODER | View own incidents |
| `/afor/import` | REGIONAL_ENCODER | Import AFOR spreadsheet |
| `/dashboard/validator` | NATIONAL_VALIDATOR | Verification queue |
| `/dashboard/validator/audit` | NATIONAL_VALIDATOR | Audit log viewer |

---

## Notes for Planning

- **M4 depends on M1** (Infrastructure Foundation) - ensure schema and base setup complete
- **Atomic operations** are critical for bulk approve to maintain data integrity
- **Audit logging** must be comprehensive for compliance tracking
- **RLS policies** ensure regional encoders can only access their region's incidents
- **Draft expiry** requires Celery task configuration (see backend setup)
- **Diff view** should highlight changes visually for clarity
- All timestamps should be in UTC

