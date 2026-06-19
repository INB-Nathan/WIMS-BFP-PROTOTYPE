---
title: Database Schema Overview
created: 2026-05-14
updated: 2026-06-19
type: database
tags: [wims-bfp, database, schema, rls, audit-log, implementation-map, startup-self-heal]
sources: [raw/codebase/codebase-snapshot-2026-05-14.md, src/postgres-init]
status: draft
---

# Database Schema Overview

PostgreSQL/PostGIS schema is bootstrapped by ordered SQL files in `src/postgres-init`.

## Startup Self-Heal

`src/postgres-init/` scripts only run on first container boot. For existing containers (e.g. VPS with a persistent Postgres volume), `src/backend/main.py::apply_schema_patches()` applies idempotent DDL on every restart.

As of 2026-06-19, eligible schema-only SQL files are executed directly from `src/postgres-init/` via the `_apply_postgres_init_sql_patch()` loader, rather than hand-copying DDL into Python string literals. This reduces drift between the canonical SQL files and the runtime self-heal.

**Allowlisted files** (schema-only, idempotent, executed by the loader):
- `19_reference_number.sql`
- `25_extent_fields.sql`
- `27_reference_sequence.sql`
- `28_general_description_column.sql`
- `35_barangay_text.sql`
- `45_add_client_id_to_incidents.sql`
- `53_incident_pii_key_version.sql`
- `54_openbao_provider_metadata.sql`

**Kept inline** (mixed schema + seed data, RLS rewrites, or rule/policy patches):
- `21_all_regions.sql` — province_district/city_municipality columns only; file also seeds regions/provinces/cities and assigns users
- `41_fix_immutable_rule_for_archive.sql` — rule rewrite, already special-cased
- `42_ref_table_rls.sql` — policy rewrite, already special-cased
- Seed files (03, 14, 29, 38) never executed in startup self-heal

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
| `wims.incident_attachments` | `06_incident_details.sql` |
| `wims.incident_nonsensitive_details` | `06_incident_details.sql` |
| `wims.incident_sensitive_details` | `06_incident_details.sql` |
| `wims.incident_verification_history` | `06_incident_details.sql` |
| `wims.involved_parties` | `06_incident_details.sql` |
| `wims.operational_challenges` | `06_incident_details.sql` |
| `wims.responding_units` | `06_incident_details.sql` |
| `wims.incident_wildland_afor` | `07_wildland_afor.sql` |
| `wims.wildland_afor_alarm_statuses` | `07_wildland_afor.sql` |
| `wims.wildland_afor_assistance_rows` | `07_wildland_afor.sql` |
| `wims.regional_public_keys` | `08_security_audit.sql` |
| `wims.security_threat_logs` | `08_security_audit.sql` |
| `wims.system_audit_trails` | `08_security_audit.sql`; `old_values`/`new_values` JSONB columns added in `60_audit_forensics_columns.sql` |
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
- Verification/immutability: `wims.incident_verification_history`, immutable records SQL (DELETE + UPDATE blocked for audit trails), audit trails.
- Analytics: `wims.analytics_incident_facts`, materialized view SQL, export/scheduled report tables. Migration `28_analytics_geography_denorm.sql` adds denormalized `municipality_name` and `province_name` fields for analyst filters/top-N views, plus export task/file metadata on `analytics_export_log`. Scheduled reports remain deferred outside the National Analyst dashboard phase.
- Security: `wims.security_threat_logs`, `wims.system_audit_trails`, public keys.
- Civilian reporting: `wims.citizen_reports` stores device-UUID-owned reports. The `location` column is a PostGIS `geography` type — when extracting latitude/longitude via `ST_Y`/`ST_X`, the column must be cast to `geometry`: `ST_Y(location::geometry)` or `ST_X(location::geometry)`. The Phase 2 update flow uses `GET /api/civilian/reports?device_id=` to enumerate a device's owned reports before allowing an append.

## Related
- [[backend/api-route-map]]
- [[security/security-baseline]]
