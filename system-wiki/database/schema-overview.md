---
title: Database Schema Overview
created: 2026-05-14
updated: 2026-06-22
type: database
tags: [wims-bfp, database, schema, rls, audit-log, implementation-map, alembic]
sources: [raw/codebase/codebase-snapshot-2026-05-14.md, src/postgres-init, src/backend/alembic, src/backend/entrypoint.sh]
status: draft
---

# Database Schema Overview

PostgreSQL/PostGIS clean-volume schema is bootstrapped by ordered SQL files in
`src/postgres-init/`; persistent upgrades are now managed by Alembic under
`src/backend/alembic/`.

## Bootstrap and Persistent Upgrade Path

- PostgreSQL's Docker entrypoint executes `src/postgres-init/*.sql` in lexical
  filename order only when it initializes a new data volume.
- Alembic revision `0001_baseline_postgres_init.py` detects whether the core WIMS
  schema already exists. It stamps an existing complete schema; on a fresh target,
  it reads the ordered bootstrap SQL and excludes the documented psql-only Keycloak
  database bootstrap file.
- Revision `0002_startup_schema_patches.py` moved the former repeated startup DDL
  into a one-shot persistent migration.
- `src/backend/entrypoint.sh` runs with Uvicorn lifespan disabled, auto-applies any
  pending migrations via `alembic upgrade head` (with 3-attempt retry loop), logs
  the resulting revision, and resynchronizes the IP blocklist. The legacy
  `main.py::apply_schema_patches()` startup handler is not the normal container
  upgrade path under this entrypoint.


| Table | Source file |
|---|---|
| `wims.ref_regions` | `02_ref_geography.sql` |
| `wims.ref_provinces` | `02_ref_geography.sql` |
| `wims.ref_cities` | `02_ref_geography.sql` |
| `wims.ref_barangays` | `02_ref_geography.sql` |
| `wims.users` | `03_users.sql`; email column/unique local email index in `44_add_email_to_users.sql` |
| `wims.data_import_batches` | `04_import_incidents.sql` |
| `wims.fire_incidents` | `04_import_incidents.sql` |
| `wims.citizen_reports` | `05_citizen_reports.sql` |
| `wims.citizen_report_followups` | `59_citizen_report_followups.sql` |
| `wims.operations` | `51_operations.sql`; map fields in `52_operations_map.sql`; archive/reset flags in `79_operations_day_reset.sql` |
| `wims.operation_citizen_reports` | `51_operations.sql`; one-report-per-operation uniqueness in `71_operation_report_unique.sql` |
| `wims.operation_reset_batches` | `79_operations_day_reset.sql` |
| `wims.incident_attachments` | `06_incident_details.sql` |
| `wims.incident_nonsensitive_details` | `06_incident_details.sql` |
| `wims.incident_sensitive_details` | `06_incident_details.sql` |
| `wims.incident_verification_history` | `06_incident_details.sql`; `ip_address` column added in `63_ivh_ip_address.sql` |
| `wims.involved_parties` | `06_incident_details.sql` |
| `wims.operational_challenges` | `06_incident_details.sql` |
| `wims.responding_units` | `06_incident_details.sql` |
| `wims.incident_wildland_afor` | `07_wildland_afor.sql` |
| `wims.wildland_afor_alarm_statuses` | `07_wildland_afor.sql` |
| `wims.wildland_afor_assistance_rows` | `07_wildland_afor.sql` |
| `wims.regional_public_keys` | `08_security_audit.sql` |
| `wims.security_threat_logs` | `08_security_audit.sql` |
| `wims.system_audit_trails` | `08_security_audit.sql`; `old_values`/`new_values` JSONB columns added in `60_audit_forensics_columns.sql` |
| `wims.ip_blocklist` | `65_ip_blocklist.sql` |
| `wims.analytics_incident_facts` | `11_analytics_facts.sql` |
| `wims.analytics_incident_facts.municipality_name` / `province_name` | `28_analytics_geography_denorm.sql` |
| `wims.analytics_export_log` | `13_export_reports.sql` |
| `wims.analytics_export_log` export metadata columns | `28_analytics_geography_denorm.sql` |
| `wims.scheduled_reports` | `13_export_reports.sql` |
| `wims.incident_verification_history` | `15_validator_workflow.sql` |
| `wims.reference_sequence` | `27_reference_sequence.sql` |

## Schema Clusters
- Reference geography: `wims.ref_regions`, `wims.ref_provinces`, `wims.ref_cities`, `wims.ref_barangays`.
- Users and RBAC mirror: `wims.users` plus Keycloak identity data. PR #207 adds local `email` storage with a unique `LOWER(email)` index (`uq_users_email_lower`) to align local email uniqueness with Keycloak's duplicate-email prevention; startup DDL intentionally does not patch this table.
- Incident workflow: `wims.fire_incidents`, detail tables, involved parties, responding units, operational challenges, attachments.
- Verification/immutability: `wims.incident_verification_history` has final-schema UPDATE/DELETE blocking rules. `wims.system_audit_trails` is required to be append-only, but `72_partition_audit_trail.sql` replaces the table after migration 17 and does not recreate `no_update_audit`/`no_delete_audit`; this is an open enforcement gap in [[gaps/frs-codebase-gap-register]].
- Analytics: `wims.analytics_incident_facts`, materialized view SQL, export/scheduled report tables. Migration `28_analytics_geography_denorm.sql` adds denormalized `municipality_name` and `province_name` fields for analyst filters/top-N views, plus export task/file metadata on `analytics_export_log`. Scheduled reports remain deferred outside the National Analyst dashboard phase.
- Security: `wims.security_threat_logs`, `wims.system_audit_trails`, `wims.ip_blocklist`, public keys.
- Civilian reporting: `wims.citizen_reports` stores device-UUID-owned reports. The `location` column is a PostGIS `geography` type — when extracting latitude/longitude via `ST_Y`/`ST_X`, the column must be cast to `geometry`: `ST_Y(location::geometry)` or `ST_X(location::geometry)`. The Phase 2 update flow uses `GET /api/civilian/reports?device_id=` to enumerate a device's owned reports before allowing an append.
- Operations board: `wims.operations` stores validator-maintained active and archived fire operations. `keep_overnight` is a one-reset carryover flag; daily/manual resets write `wims.operation_reset_batches` and soft-archive non-kept rows via `is_archived`/`archived_at` metadata.

## DB-Enforced vs App-Enforced Invariants

As of migration `61_check_constraints.sql` (Issue #387 / D13), critical numeric
non-negativity invariants on `incident_nonsensitive_details` are enforced at the
database layer as CHECK constraints, providing defense-in-depth below the
Pydantic app-layer validation.

### DB-Enforced (CHECK constraints)

**`wims.incident_nonsensitive_details`** — all 18 numeric columns have
`chk_incident_nonsensitive_details_{column}_non_negative` CHECK constraints
enforcing `col IS NULL OR col >= 0`:
- Casualties: `civilian_deaths`, `civilian_injured`, `firefighter_deaths`, `firefighter_injured`
- Damage: `estimated_damage_php`, `families_affected`
- Resources: `water_tankers_used`, `foam_liters_used`, `breathing_apparatus_used`
- Impact: `structures_affected`, `households_affected`, `individuals_affected`, `vehicles_affected`
- Metrics: `total_response_time_minutes`, `total_gas_consumed_liters`
- Extent: `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`
- Distance: `distance_from_station_km`

**Other tables with existing CHECKs:**
- `wims.fire_incidents`: `verification_status` enum values (includes DRAFT, PENDING, PENDING_VALIDATION, VERIFIED, REJECTED, REPLACED)
- `wims.citizen_reports`: `status`, `trust_score`, `category`, `reporting_context`, `safety_status`, `reported_via` enums; `chk_actioned_requires_validator`
- `wims.incident_sensitive_details`: `pii_blob_consistency` (pii_blob_enc ↔ encryption_iv)
- `wims.security_threat_logs`: `suricata_sid` > 0

### Civilian photo v5 migrations (2026-07-10)
- **83_photo_exif_metadata.sql** (`wims.report_photos`): Adds `exif_gps_lat NUMERIC(10,7)`, `exif_gps_lon NUMERIC(10,7)`, `exif_gps_altitude NUMERIC`, `exif_datetime_original TIMESTAMPTZ`, `exif_data_source TEXT` with comments.
- **84_photo_idempotency_key.sql** (`wims.report_photos`): Adds `client_photo_id UUID` with partial unique index `idx_report_photos_client_id WHERE client_photo_id IS NOT NULL`.
- **85_citizen_report_idempotency.sql** (`wims.citizen_reports`): Adds `client_report_id UUID` with partial unique index `idx_citizen_reports_client_id WHERE client_report_id IS NOT NULL`.
- Application path: startup SQL patches (main.py) and Alembic revision 0003.
- `wims.report_photos` RLS: `FORCE ROW LEVEL SECURITY` preserved. Idempotent INSERT uses `ON CONFLICT DO NOTHING RETURNING` to avoid SELECT under ANONYMOUS RLS.

### App-Enforced Only (Pydantic / application logic)

- Locality hierarchy consistency (city → barangay → province → region) — cross-table CHECKs impractical in PostgreSQL
- Monotonic workflow timestamps (`created_at ≤ submitted_at ≤ verified_at`) — cross-column CHECKs with nullable logic deferred to app
- `casualty_details` JSONB structure validation — stays in Pydantic/application layer
- Coordinate bounds (`latitude`, `longitude`) on `fire_incidents.location` — enforced via PostGIS geography type, not explicit CHECK
- Percentage fields (0–100%) — no percentage columns currently exist within the incident-domain tables (excluding tables like `wims.system_metrics`)

## Related
- [[backend/api-route-map]]
- [[security/security-baseline]]
