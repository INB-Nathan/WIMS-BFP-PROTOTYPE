---
title: Database Schema — SQL Init Files
created: 2026-05-16
updated: 2026-05-31
type: database
tags: [wims-bfp, database, postgresql, postgis, sql-migrations, rls, analytics]
sources: [src/postgres-init/]
status: draft
---

# Database Schema — SQL Init Files

Complete documentation of all SQL migration files in `src/postgres-init/`, ordered by execution sequence. These files are run by Docker Compose on first volume creation.

---

## Foundation Files (00–03)

### `00_keycloak_bootstrap.sql`

**Purpose:** Bootstraps the Keycloak database and role for fresh Postgres volumes.

**Constructs:** Role `keycloak` (password `secret`). Database `keycloak` owned by role `keycloak`. Grants all on `public` schema to `keycloak`.

### `01_extensions_roles.sql`

**Purpose:** Foundation — PostGIS + pgcrypto extensions, `wims` schema, FRS application roles.

**Extensions:** `postgis`, `pgcrypto`

**PostgreSQL Roles:**
- `CIVILIAN_REPORTER`, `REGIONAL_ENCODER`, `NATIONAL_VALIDATOR`, `NATIONAL_ANALYST`, `SYSTEM_ADMIN` — FRS application roles
- `ANONYMOUS` — deny sentinel for RLS
- `wims_app` — NOLOGIN application pool role

### `02_ref_geography.sql`

**Purpose:** Philippine reference geography hierarchy.

**Tables:**

| Table | Key Columns |
|---|---|
| `wims.ref_regions` | region_id SERIAL PK, region_name TEXT, region_code VARCHAR UNIQUE |
| `wims.ref_provinces` | province_id SERIAL PK, region_id FK, province_name TEXT |
| `wims.ref_cities` | city_id SERIAL PK, province_id FK, city_name TEXT, zip_code VARCHAR, is_capital BOOLEAN |
| `wims.ref_barangays` | barangay_id SERIAL PK, city_id FK, barangay_name TEXT |

### `03_users.sql`

**Purpose:** Users table + seed test users.

**Table:** `wims.users` — user_id UUID PK (gen_random_uuid), keycloak_id UUID UNIQUE, username, role (CHECK constrained to 5 roles), assigned_region_id FK, contact_number, is_active, mfa_enabled, last_login, created_at, updated_at.

**Seed users (deterministic UUIDs):**
- `svc_suricata` — `00000000-0000-0000-0000-000000000001`
- Regional encoders: `encoder_ncr` (region 1), `encoder_car` (region 2), `encoder_r01`-`encoder_r13` (regions 3-16), `encoder_barmm` (region 17), `encoder_nir` (region 18)
- `validator_test` — NATIONAL_VALIDATOR
- `analyst_test` / `analyst1_test` — NATIONAL_ANALYST
- `admin_test` — SYSTEM_ADMIN

---

## Incident Tables (04–07)

### `04_import_incidents.sql`

**Purpose:** Core incident and import batch tables.

**Tables:**

- `wims.data_import_batches` — batch_id, region_id, uploaded_by, upload_timestamp, record_count, batch_checksum_hash, sync_status
- `wims.fire_incidents` — incident_id, import_batch_id FK, encoder_id FK, region_id FK (NOT NULL), location GEOGRAPHY(POINT,4326) NOT NULL, verification_status (CHECK: DRAFT/PENDING/PENDING_VALIDATION/VERIFIED/REJECTED), is_archived, created_at, updated_at

**Indexes:** GIST on `location`, composite `(region_id, created_at DESC)`.

### `04a_fire_incidents_composite_index.sql`

**Purpose:** Composite index for analyst queries.

**Index:** `idx_fire_incidents_composite` ON (region_id, verification_status, created_at DESC)

### `05_citizen_reports.sql`

**Purpose:** Public citizen report submissions.

**Table:** `wims.citizen_reports` — report_id, location GEOGRAPHY(POINT,4326), description, reporter_phone, is_sms_verified, trust_score (CHECK -100..100), status (CHECK), incident_id FK, validated_by FK, verified_incident_id FK, created_at

**Constraint:** `chk_verified_requires_validator` — status != VERIFIED OR validated_by IS NOT NULL

### `06_incident_details.sql`

**Purpose:** 7 child detail tables for incidents.

| Table | Key Columns |
|---|---|
| `wims.incident_attachments` | incident_id FK, file_name, storage_path, mime_type, file_hash_sha256(64), uploaded_by FK |
| `wims.incident_nonsensitive_details` | incident_id FK, city_id FK, barangay_id FK, alarm_level, general_category, sub_category, specific_type, occupancy_type, estimated_damage_php, casualties (civilian_injured/deaths, firefighter_injured/deaths), families_affected, resources_deployed JSONB, alarm_timeline JSONB, problems_encountered JSONB, recommendations, total_response_time_minutes, and 10+ more operational columns |
| `wims.incident_sensitive_details` | incident_id FK, street_address, landmark, caller_name/number, narrative_report, prepared_by/noted_by_officer, disposition_status, pii_blob_enc (encrypted PII), encryption_iv, personnel_on_duty JSONB, other_personnel JSONB, casualty_details JSONB, icp_location, and 15+ more columns. CONSTRAINT ensures pii_blob_enc + encryption_iv are both NULL or both NOT NULL |
| `wims.incident_verification_history` | history_id, incident_id FK, action_by_user_id FK, previous_status, new_status, comments, action_timestamp |
| `wims.involved_parties` | incident_id FK, full_name, involvement_type, age, gender |
| `wims.operational_challenges` | incident_id FK, problem_code, remarks |
| `wims.responding_units` | incident_id FK, station_name, engine_number, responder_type, dispatch_dt, arrival_dt, return_dt |

### `07_wildland_afor.sql`

**Purpose:** Wildland fire AFOR schema.

**Tables:**
- `wims.incident_wildland_afor` — one-to-one with fire_incidents. Columns: source (CHECK AFOR_IMPORT/MANUAL), call_received_at, fire_started_at through fire_controlled_at, total_area_burned_hectares, wildland_fire_type (CHECK constrained), plus JSONB: area_type_summary, causes_and_ignition_factors, suppression_factors, weather, fire_behavior, peso_losses, casualties, problems_encountered, recommendations
- `wims.wildland_afor_alarm_statuses` — child with sort_order; alarm CHECK: 15 values (1st Alarm through No Firefighting Conducted)
- `wims.wildland_afor_assistance_rows` — child with sort_order; tracks organization/unit + detail

---

## Security & Audit (08–10)

### `08_security_audit.sql`

**Purpose:** Security monitoring, threat detection, and system audit trail.

**Tables:**

- `wims.regional_public_keys` — key_id, region_id FK, public_key_pem TEXT, is_active, created_at, revoked_at
- `wims.security_threat_logs` — log_id BIGSERIAL PK, timestamp, source_ip, destination_ip, suricata_sid (INTEGER >0), severity_level, raw_payload VARCHAR(65535), xai_narrative VARCHAR(10000), xai_confidence DOUBLE PRECISION, admin_action_taken, resolved_at, reviewed_by FK, **hitl_decision JSONB** (M8d: structured HITL audit: `{ action, note, reviewed_by, reviewed_at }`), **classification TEXT** (nullable; normalized: internet_background_noise/scanner/bot_probe/credential_probe/high_signal_threat/unclassified), **suricata_signature TEXT** (nullable; from EVE alert.signature), **suricata_category TEXT** (nullable; from EVE alert.category)
- `wims.system_audit_trails` — audit_id BIGSERIAL PK, user_id FK, action_type, table_affected, record_id, ip_address, user_agent, timestamp

**Note:** security_threat_logs is intentionally NOT region-filtered (ADR: cybersecurity threats are borderless).

**Demo seed:** `38_seed_security_threat_logs.sql` adds idempotent Suricata-style alert rows for this table.

**Classification migration:** `62_security_threat_classification.sql` adds `classification`, `suricata_signature`, and `suricata_category` columns (idempotent, `ADD COLUMN IF NOT EXISTS`).

### `09_rls_helpers.sql`

**Purpose:** Helper functions used by all RLS policies. Reads session-level GUC `wims.current_user_id` set by the application per-request.

**Functions (6):**

| Function | Returns | Purpose |
|---|---|---|
| `wims.current_user_uuid()` | uuid | Reads GUC `wims.current_user_id`, NULL if not set |
| `wims.current_user_role()` | text | Looks up role from wims.users; COALESCE to 'ANONYMOUS' as deny sentinel; only active users |
| `wims.current_user_region_id()` | integer | Returns `assigned_region_id` from wims.users |
| `wims.current_region_id()` | integer | Alias for current_user_region_id() for analytics compatibility |
| `wims.set_current_user_uuid(uid uuid)` | void | SECURITY DEFINER — sets GUC `wims.current_user_id` in session. Used by admin routes where service account has no GUC context |
| `wims.exec_as_system_admin(uid uuid)` | void | SECURITY DEFINER convenience wrapper that sets GUC for a given user_id |

### `10_rls_policies.sql`

**Purpose:** Central RLS policy file. Enables FORCE ROW LEVEL SECURITY on all tables and creates per-table/per-role policies.

**RLS enabled on 16 tables:** users, data_import_batches, fire_incidents, citizen_reports, incident_nonsensitive_details, incident_sensitive_details, incident_verification_history, incident_attachments, involved_parties, operational_challenges, responding_units, incident_wildland_afor, wildland_afor_alarm_statuses, wildland_afor_assistance_rows, security_threat_logs, system_audit_trails

**Policy patterns:**

| Table | Pattern |
|---|---|
| `users` | self_or_admin SELECT/UPDATE, admin-only INSERT/DELETE |
| `data_import_batches` | region-scoped for REGIONAL_ENCODER/NATIONAL_VALIDATOR, global for NATIONAL_ANALYST/SYSTEM_ADMIN |
| `fire_incidents` | region-matched or SYSTEM_ADMIN/NATIONAL_ANALYST |
| `child tables` (nonsensitive/sensitive/attachments/etc.) | SYSTEM_ADMIN/NATIONAL_ANALYST global OR EXISTS join to fire_incidents WHERE region matches |
| `security_threat_logs` | SYSTEM_ADMIN/NATIONAL_ANALYST only |
| `system_audit_trails` | SELECT: admin or self; INSERT: unrestricted (TRUE) |

**Lockdown:** REVOKE ALL ON SCHEMA wims FROM PUBLIC, REVOKE ALL ON ALL TABLES/SEQUENCES IN SCHEMA wims FROM PUBLIC.

### `10a_m4_incident_scope.sql`

**Purpose:** M4 scope update — replaces region-scoped policies with encoder-ownership-based policies.

**Changes:** fire_incidents SELECT/INSERT/UPDATE/DELETE now use encoder_id = current_user instead of region matching. NATIONAL_VALIDATOR has cross-region access. Child tables (nonsensitive_details, sensitive_details) follow same pattern via EXISTS join to fire_incidents WHERE encoder_id matches.

---

## Analytics (11–13)

### `11_analytics_facts.sql`

**Purpose:** Analytics read model — denormalized incident facts table.

**Table:** `wims.analytics_incident_facts` — incident_id PK, region_id, location GEOGRAPHY(POINT,4326), notification_dt, notification_date (DATE), alarm_level, general_category, synced_at

**Indexes:** (notification_date), (region_id), (alarm_level), (general_category)

**RLS:** FORCE ROW LEVEL SECURITY. Policies: NATIONAL_ANALYST read-all, REGIONAL_ENCODER region-scoped, NATIONAL_VALIDATOR region-scoped, SYSTEM_ADMIN all.

### `12_analytics_mvs.sql`

**Purpose:** Adds casualty/damage/response-time columns to analytics_incident_facts and creates 4 materialized views.

**ALTER TABLE additions:** civilian_injured, civilian_deaths, firefighter_injured, firefighter_deaths, total_response_time_minutes, estimated_damage_php, fire_station_name, barangay_name. Indexes on barangay_name and fire_station_name.

**Materialized Views (4):**

| MV | Group By | Columns |
|---|---|---|
| `wims.mv_incident_counts_daily` | notification_date, region_id, general_category, alarm_level | incident_count |
| `wims.mv_incident_by_region` | region_id | total_incidents, avg/min/max_response_time |
| `wims.mv_incident_by_barangay` | barangay_name | incident_count |
| `wims.mv_incident_type_distribution` | general_category | incident_count |

Each MV has a UNIQUE index on its GROUP BY columns.

### `13_export_reports.sql`

**Purpose:** Export audit logging and scheduled report configuration.

**Tables:**

- `wims.analytics_export_log` — export_id, user_id, exported_at, format (CHECK csv/pdf/excel), filters_json JSONB, row_count. Indexes: (user_id), (exported_at). RLS: SYSTEM_ADMIN read-all.
- `wims.scheduled_reports` — id, name, cron_expr, format (CHECK), filters JSONB, recipients JSONB, enabled, last_run_at, created_at. RLS: SYSTEM_ADMIN all.

---

## Seeds & Reference Data (14–26)

### `14_seed_ncr.sql`

Seed: NCR region (region_name='National Capital Region', region_code='NCR').

### `14a_assign_ncr_to_test_users.sql`

Ensures `encoder_ncr` and `validator_test` are assigned to NCR's region_id.

### `15_validator_workflow.sql`

**Purpose:** Encoder-to-validator workflow. Normalizes roles, creates migrated `incident_verification_history` table with `target_type`/`target_id`/`action_label`, rebuilds status CHECK to include PENDING_VALIDATION, adds region-scoped validator RLS policy.

**New IVH columns:** history_id, target_type CHECK (OFFICIAL, CIVILIAN), target_id, action_by_user_id FK, previous_status, new_status, notes, action_label, action_timestamp.

**Indexes:** (target_type, target_id), (action_by_user_id)

### `16_fix_ivh_legacy.sql`

Backward-compat migration: adds target_type/target_id/notes to legacy IVH table, migrates data from incident_id/comments, makes incident_id nullable. CHECK on target_type. Indexes on target and action_by.

### `17_immutable_records.sql`

**Purpose:** M6-D data_hash + DB-level immutability rules for VERIFIED incidents.

- Adds `data_hash VARCHAR(64)` to fire_incidents — SHA-256 hex digest set at VERIFIED transition
- RULE `no_update_verified` — DO INSTEAD NOTHING on UPDATE WHERE verification_status = 'VERIFIED'
- RULE `no_delete_verified` — DO INSTEAD NOTHING on DELETE WHERE VERIFIED. Use is_archived instead
- RULE `no_delete_ivh` — DO INSTEAD NOTHING on DELETE from incident_verification_history
- Analytics expantion: adds casualty/damage/response-time/fire_station/barangay columns to analytics_incident_facts

### `17_cross_region_validator.sql`

Replaces region-scoped validator UPDATE policy with cross-region. NATIONAL_VALIDATOR may act on any region.

### `18_submitted_snapshot.sql`

M4-G: Adds `submitted_snapshot JSONB` to fire_incidents. Snapshot of incident_nonsensitive_details captured at first PENDING transition. Written once, never updated.

### `19_reference_number.sql`

Adds `reference_number TEXT` (original format: AFOR-RGN-{code}-{station}-{type}-{MMM}-{YYYY}-{NNNN}) and `incident_type_code TEXT` to fire_incidents. UNIQUE partial index on reference_number WHERE NOT NULL. Adds `station_code TEXT DEFAULT 'TBA'` to incident_nonsensitive_details.

> **Deprecated by `39_remove_station_code.sql`** — `station_code` column was removed; reference number format updated to `AFOR-RGN-{region_code}-{type_code}-{MMM}-{YYYY}-{NNNN}` (no station segment).

### `20_parent_incident_id.sql`

Adds `parent_incident_id INTEGER FK` to fire_incidents — links update request (PENDING) back to original VERIFIED incident. Indexed.

### `21_all_regions.sql`

Seeds all 18 Philippine regions + 81 provinces. Adds `province_district TEXT` and `city_municipality TEXT` to incident_nonsensitive_details. Assigns canonical dev encoder usernames to their authoritative region IDs: NCR=1, CAR=2, Region I=3, Region II=4, through NIR=18.

### `22_duplicate_flags.sql`

Adds `is_duplicate BOOLEAN DEFAULT FALSE` and `duplicate_of INTEGER FK` to fire_incidents.

### `23_archived_at.sql`

Adds `archived_at TIMESTAMPTZ` to fire_incidents with backfill from updated_at.

### `24_replaced_status_action_label.sql`

Expands verification_status CHECK to include 'REPLACED'. Adds `action_label VARCHAR(80)` to incident_verification_history.

### `25_cities_region4.sql`

Seeds ref_cities for Region IV-A (CALABARZON) and IV-B (MIMAROPA) — ~270 cities across 10 provinces.

### `26_cities_remaining_regions.sql`

Seeds ref_cities for all remaining PH regions (CAR, Regions I-III, V-XIII, BARMM, NIR). Thousands of entries. Idempotent via WHERE NOT EXISTS.

---

## Late Migrations & Demo Seeds (27–38)

### `27_reference_sequence.sql`

**Purpose:** Replaces COUNT(*)-derived ref-number sequence with a dedicated monotonic counter.

**Table:** `wims.reference_sequence` — single-row (CHECK id=0) with `current_value BIGINT DEFAULT 0`

**Seed:** Initialized from MAX(regex-extracted suffix) of existing reference numbers, or 0 if none exist.

### `28_analytics_geography_denorm.sql`

**Purpose:** Analyst geography dimensions + export log expansion.

- Adds `municipality_name TEXT`, `province_name TEXT` to analytics_incident_facts (indexed)
- Adds columns to analytics_export_log: columns_json, task_id, file_path, file_name, content_type, export_type (DEFAULT 'analytics')
- RLS policies for export_log: analyst/admin INSERT, self-or-admin SELECT

### `29_seed_incidents.sql`

**Purpose:** Deterministic verified incident data for analyst dashboards.

Creates 12 seed VERIFIED incidents across NCR (6), CALABARZON/IV-A (3), and Bicol/V (3). Each incident creates: fire_incidents row, nonsensitive_details, sensitive_details, verification_history entry (action_label: "seed_verified"), analytics_incident_facts row, and 4x MV refresh.

Ref number range: 0001–0012. Incident types cover STRUCTURAL (residential, commercial, high-rise, warehouse, mixed occupancy, school), VEHICULAR, NON_STRUCTURAL (grass, rubbish, wildland edge).

### `31_barangay_geometry.sql`

**Purpose:** Adds geography polygon column to ref_barangays for reverse-geocoding.

ALTER TABLE ref_barangays ADD `geometry GEOGRAPHY(POLYGON, 4326)`. GIST index `idx_ref_barangays_geometry` for fast ST_Contains lookups. PSGC .shp polygon data must be loaded separately — this file only creates the column and index.

### `38_seed_security_threat_logs.sql`

**Purpose:** Demo Suricata threat telemetry for the System Admin threat telemetry view.

Seeds 6 idempotent rows in `wims.security_threat_logs`: 2 HIGH, 2 MEDIUM, and 2 LOW Suricata-style alerts. Rows include representative raw EVE JSON payloads, XAI narratives/confidence on selected alerts, one reviewed/resolved alert, and admin action metadata where useful.

**Idempotency:** Uses `(source_ip, destination_ip, suricata_sid)` existence checks so rerunning the init file or applying it manually does not duplicate the demo alerts.

---

### `39_hitl_decision.sql`

**Purpose:** M8d structured HITL decision audit log.

Adds `hitl_decision JSONB` column to `wims.security_threat_logs`. Stores HITL decisions as `{ "action": "CONFIRM_THREAT"|"FALSE_POSITIVE"|"REQUEST_MORE_INFO", "note": string|null, "reviewed_by": uuid, "reviewed_at": ISO8601 }`.

**Idempotent:** `ADD COLUMN IF NOT EXISTS`.

### `39_remove_station_code.sql`

**Purpose:** Remove the `station_code` column that was added by `19_reference_number.sql` and update the reference number format comment.

- `ALTER TABLE wims.incident_nonsensitive_details DROP COLUMN IF EXISTS station_code`
- Updates `COMMENT ON COLUMN wims.fire_incidents.reference_number` to reflect the new format: `AFOR-RGN-{region_code}-{type_code}-{MMM}-{YYYY}-{NNNN}` (station segment removed)

**Idempotent:** YES (`DROP COLUMN IF EXISTS`).

### `42_ref_table_rls.sql`

**Purpose:** Enable RLS on reference geography tables (FRS M15 initial policy).

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on `wims.ref_regions`, `wims.ref_provinces`, `wims.ref_cities`
- **SELECT policies:** REGIONAL_ENCODER sees only their assigned region; NATIONAL_VALIDATOR, NATIONAL_ANALYST, and SYSTEM_ADMIN see all
- `ref_cities` has no direct `region_id` — scoped via `province_id IN (SELECT ... FROM wims.ref_provinces WHERE region_id = ...)`
- No write policies (default-deny)
- `ref_fire_stations` intentionally excluded (public emergency reference)

### `53_ref_table_rls.sql`

**Purpose:** M15 region-scoped RLS revision — replace migration 42 policies with correct FRS M15 vi scoping and add SECURITY DEFINER fallback helper for `public_dmz`.

**Key changes from 42:**
- **NATIONAL_VALIDATOR scoped to assigned region:** prior migration 42 included NATIONAL_VALIDATOR in the global `IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')` set; M15 vi requires regional roles (REGIONAL_ENCODER, NATIONAL_VALIDATOR) to see only their assigned region. Both are now in the region-matched OR branch.
- **SYSTEM_ADMIN write policies:** `FOR ALL` policies with `USING (wims.current_user_role() = 'SYSTEM_ADMIN')` and corresponding `WITH CHECK` — seed rows use superuser; no runtime application code writes to ref tables.
- **SECURITY DEFINER helper `wims.get_first_region_id()`:** bypasses RLS for the `public_dmz.py` unauthenticated fallback path where no user GUC is set. Runs as function owner (superuser), `SET search_path = wims, pg_temp`, granted only to `wims_app`.
- **Startup patch:** `main.py:_apply_ref_table_rls()` mirrors this migration to prevent startup reversion.
- **Idempotent:** YES (`CREATE OR REPLACE` helper, `DROP POLICY IF EXISTS`).

---

## RLS Policy Summary

The RLS system uses a GUC-based approach:
1. App sets `wims.current_user_id` per-request (via `get_db_with_rls()` dependency)
2. Helper functions (`current_user_role()`, `current_user_region_id()`) read the GUC wims.current_user_id
3. RLS policies use these helpers to filter rows

**Key policy patterns:**
- Encoders see only their own incidents (encoder_id match, via 10a)
- Validators see cross-region (via 17_cross_region_validator)
- Analysts read analytics_incident_facts globally
- Admins have unrestricted access
- Unauthenticated (ANONYMOUS) is denied by COALESCE in current_user_role()
- Immutable records use PostgreSQL RULES (not RLS) to block UPDATE/DELETE on VERIFIED
- Reference tables (ref_regions, ref_provinces, ref_cities) — FRS M15 vi: REGIONAL_ENCODER and NATIONAL_VALIDATOR see only their assigned region; NATIONAL_ANALYST and SYSTEM_ADMIN see all (migration 53, supersedes 42). System admin write policies via `FOR ALL`. SECURITY DEFINER helper `wims.get_first_region_id()` enables unauthenticated `public_dmz` no-GUC fallback without globally readable geography.
- `ref_fire_stations` intentionally excluded from RLS (public emergency reference).
