---
title: Database Schema Overview
created: 2026-05-14
updated: 2026-07-19
type: database
tags: [wims-bfp, database, schema, rls, audit-log, implementation-map, alembic]
sources: [raw/codebase/codebase-snapshot-2026-05-14.md, src/postgres-init, src/postgres-init/86_civilian_contributor_snapshot.sql, src/postgres-init/87_photo_preupload_schema.sql, src/postgres-init/88_anonymous_photo_ownership.sql, src/postgres-init/89_anonymous_pending_photo_insert.sql, src/postgres-init/90_registered_photo_ownership.sql, src/postgres-init/91_community_content_schema.sql, src/postgres-init/92_remove_legacy_photo_bonus_function.sql, src/postgres-init/97_information_emergency_draft_source_unique.sql, src/backend/alembic, src/backend/alembic/versions/0007_contributor_snapshot_cleanup.py, src/backend/alembic/versions/0008_photo_preupload_schema.py, src/backend/alembic/versions/0009_anonymous_photo_ownership_helpers.py, src/backend/alembic/versions/0010_anonymous_pending_photo_insert.py, src/backend/alembic/versions/0011_registered_photo_ownership_helper.py, src/backend/alembic/versions/0012_community_content_schema.py, src/backend/alembic/versions/0013_remove_legacy_photo_bonus_function.py, src/backend/alembic/versions/0026_information_emergency_draft_source_unique.py, src/backend/alembic/versions/0027_device_blocklist_schema.py, src/backend/services/contributor.py, src/backend/entrypoint.sh]
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
| `wims.fire_incident_perimeters` | `96_fire_incident_perimeters.sql`; Alembic `0024`; `MANUAL_DRAW` method added by Alembic `0025` |
| `wims.fire_incident_perimeters_history` | `96_fire_incident_perimeters.sql`; Alembic `0024` append-only temporal history |
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
| `wims.device_blocklist` | `94_device_blocklist.sql`; Alembic `0027` persists the bootstrap-only table, indexes, SYSTEM_ADMIN RLS policy, and repeat-offender configuration on existing deployments |
| `wims.analytics_incident_facts` | `11_analytics_facts.sql` |
| `wims.analytics_incident_facts.municipality_name` / `province_name` | `28_analytics_geography_denorm.sql` |
| `wims.analytics_export_log` | `13_export_reports.sql` |
| `wims.analytics_export_log` export metadata columns | `28_analytics_geography_denorm.sql` |
| `wims.scheduled_reports` | `13_export_reports.sql` |
| `wims.incident_verification_history` | `15_validator_workflow.sql` |
| `wims.reference_sequence` | `27_reference_sequence.sql` |
| `wims.civilian_contributors` | `86_civilian_contributor_snapshot.sql`; persistent upgrade `0006`/`0007` |
| `wims.community_content` | `91_community_content_schema.sql`; persistent upgrade `0012` |
| `wims.community_content_version` | `91_community_content_schema.sql`; persistent upgrade `0012` |

## Schema Clusters
- Reference geography: `wims.ref_regions`, `wims.ref_provinces`, `wims.ref_cities`, `wims.ref_barangays`.
- Users and RBAC mirror: `wims.users` plus Keycloak identity data. PR #207 adds local `email` storage with a unique `LOWER(email)` index (`uq_users_email_lower`) to align local email uniqueness with Keycloak's duplicate-email prevention; startup DDL intentionally does not patch this table.
- Incident workflow: `wims.fire_incidents`, detail tables, involved parties, responding units, operational challenges, attachments, and validator-authored `wims.fire_incident_perimeters`. Perimeters use `GEOGRAPHY(POLYGON, 4326)`, retain one current row per incident, and calculate acreage with PostGIS; the history table records edit ranges. `MANUAL_DRAW` is the production browser-drawing method, added in Alembic `0025`. `information_emergencies` has a partial unique index from Alembic `0026` / bootstrap `97_information_emergency_draft_source_unique.sql` allowing at most one unpublished, incident-linked draft while preserving published history.
- Verification/immutability: `wims.incident_verification_history` has final-schema UPDATE/DELETE blocking rules. `wims.system_audit_trails` is required to be append-only, but `72_partition_audit_trail.sql` replaces the table after migration 17 and does not recreate `no_update_audit`/`no_delete_audit`; this is an open enforcement gap in [[gaps/frs-codebase-gap-register]].
- Analytics: `wims.analytics_incident_facts`, materialized view SQL, export/scheduled report tables. Migration `28_analytics_geography_denorm.sql` adds denormalized `municipality_name` and `province_name` fields for analyst filters/top-N views, plus export task/file metadata on `analytics_export_log`. Scheduled reports remain deferred outside the National Analyst dashboard phase.
- Security: `wims.security_threat_logs`, `wims.system_audit_trails`, `wims.ip_blocklist`, `wims.device_blocklist`, public keys. Device blocks store only an HMAC device-token hash and use an explicit SYSTEM_ADMIN RLS policy; revision `0027` repairs the prior bootstrap-only schema gap for upgraded deployments.
- Civilian reporting: `wims.citizen_reports` stores submitted reports, while `wims.report_tracking_tokens` stores SHA-256 hashes of the opaque per-report public tracking capabilities. The `location` column is a PostGIS `geography` type — when extracting latitude/longitude via `ST_Y`/`ST_X`, the column must be cast to `geometry`: `ST_Y(location::geometry)` or `ST_X(location::geometry)`. Public report-status lookup is now intended to flow through `GET /api/civilian/reports/{report_id}/track/{tracking_token}`; the old device-ID enumeration route is retired with `410 Gone`. `wims.civilian_contributors` stores the trust-score snapshot/cache with `formula_version` defaulting to `reliability-v1`; the retired `opt_in_leaderboard` column is absent. Clean-volume bootstrap is canonicalized by `86_civilian_contributor_snapshot.sql` plus `92_remove_legacy_photo_bonus_function.sql`, while Alembic `0007` upgrades the snapshot shape and `0013` removes the retired `wims.photo_bonus_for_report(INTEGER)` helper from upgraded databases.
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

### Civilian photo migrations (2026-07-10–12)
- **83_photo_exif_metadata.sql** (`wims.report_photos`): Adds `exif_gps_lat NUMERIC(10,7)`, `exif_gps_lon NUMERIC(10,7)`, `exif_gps_altitude NUMERIC`, `exif_datetime_original TIMESTAMPTZ`, `exif_data_source TEXT` with comments.
- **84_photo_idempotency_key.sql** (`wims.report_photos`): Adds `client_photo_id UUID` with partial unique index `idx_report_photos_client_id WHERE client_photo_id IS NOT NULL`.
- **85_citizen_report_idempotency.sql** (`wims.citizen_reports`): Adds `client_report_id UUID` with partial unique index `idx_citizen_reports_client_id WHERE client_report_id IS NOT NULL`.
- **87_photo_preupload_schema.sql** (`wims.report_photos`, Alembic `0008`): Makes `report_id` nullable for pending rows while retaining its FK, adds `attached_at`, backfills legacy attached rows from `created_at`, enforces pending/attached timestamp consistency, and adds the partial pending-owner index. Existing encrypted artifact columns and uploader XOR ownership remain unchanged.
- **88_anonymous_photo_ownership.sql** (`wims.anonymous_sessions`/`wims.citizen_reports`/`wims.report_photos`, Alembic `0009`): Adds absolute expiry and revocation state, validates lowercase 64-character SHA-256 token hashes, removes direct application session-table DML, and binds reports and new photo rows to `anonymous_session_id` while preserving legacy NULL/device-attached rows. Fixed-search-path helpers issue/validate/revoke bearers, authorize pending rows, and lock/atomically attach complete same-session photo sets. The `POST /api/civilian/reports` route (Slice B, 2026-07-12) now sets `citizen_reports.anonymous_session_id` from the validated capability and calls `wims.attach_anonymous_photos(:raw_token, :report_id, :photo_ids::uuid[])` inside the same transaction as the `CIVILIAN_REPORT_SUBMIT` audit; report submission must set the validated session owner before attach.
- **89_anonymous_pending_photo_insert.sql** (Alembic `0010`): Adds the fixed-signature capability-bound pending-photo insert helper. It validates the bearer, derives the session owner internally, serializes a one-outstanding-pending-row cap, classifies same-owner pending retries as duplicates, and forces pending attachment/legacy owner fields NULL. It is executable only by `wims_app`; direct anonymous table DML remains denied.
- **90_registered_photo_ownership.sql** (Alembic `0011`): Adds the registered-contributor counterpart `wims.attach_registered_photos(p_user_id, p_report_id, p_photo_ids)`, mirroring `attach_anonymous_photos`. It is `SECURITY DEFINER` with a fixed `search_path`, granted `EXECUTE` to `wims_app` only, and atomically locks an owned non-terminal report and the complete same-owner pending set, rejecting cross-owner/partial/duplicate/already-attached/terminal batches before `UPDATE`ing `report_id`/`attached_at`. No new RLS policy or `BYPASSRLS`.
- Application path: 83–85 also have legacy startup SQL patch coverage; persistent 87–90 upgrades use Alembic `0008`–`0011`, while clean bootstrap applies numbered SQL through 90.
- `wims.report_photos` remains `FORCE ROW LEVEL SECURITY`: staff access to attached rows is unchanged, registered users can access only their own pending rows, and anonymous pending access is helper-bound rather than a permissive RLS exception. No broad `BYPASSRLS`/`TRUE` policy is introduced.

### Community Safety Hub content (Slice E, 2026-07-12)
- **91_community_content_schema.sql** (`wims.community_content`, `wims.community_content_version`, Alembic `0012`): Adds the CMS content model for the Community Safety Hub. `wims.community_content` is one live pointer row per content item (`SAFETY_ARTICLE`/`ANNOUNCEMENT`/`EVENT`), carrying a globally unique `slug`, a `lifecycle_status` (`DRAFT`/`PUBLISHED`/`ARCHIVED`), the `published_version_id` publication pointer, `expires_at`/`last_reviewed_at`, an `urgent_banner` flag, and an optimistic-concurrency `row_version`. `wims.community_content_version` is the immutable, append-only per-item version history: a monotonic `version_number` per `content_id`, bilingual `title_*/body_*` text, an event/announcement `metadata_json`, a `content_hash` (sha256 of the canonical payload), and a `creator`. The two table/index/RLS/grant command bodies are byte-identical between the Alembic `0012` revision and the clean bootstrap `91`. Migration `0012` also reconciles `wims.civilian_contributors` (`ADD COLUMN IF NOT EXISTS formula_version`, `DROP COLUMN IF EXISTS opt_in_leaderboard`); the canonical clean-volume form of those column changes already lives in `86_civilian_contributor_snapshot.sql`. Migration `0012` does NOT touch `wims.system_audit_trails` or `wims.incident_verification_history`.
- **92_remove_legacy_photo_bonus_function.sql** (Alembic `0013`): Removes the retired `wims.photo_bonus_for_report(INTEGER)` SECURITY DEFINER helper from the final schema. The Slice L contributor score now aggregates photo evidence in one set-based query inside `src/backend/services/contributor.py`, so the old per-report helper is kept only in the historical `0006` downgrade path.
- **Publication model (pointer move, never version edit):** publishing or rollback inserts a new `community_content_version` and then `UPDATE`s `community_content` to move `published_version_id` to the new version (and set `lifecycle_status='PUBLISHED'`, bump `row_version`, `updated_at`). Archive sets `lifecycle_status='ARCHIVED'`, `archived_at=now()`, increments `row_version`, and retains the historical `published_version_id` pointer for audit/history. Historical `community_content_version` rows are database-enforced append-only: the SYSTEM_ADMIN RLS policy permits INSERT but no UPDATE/DELETE policy or privilege, and application code never edits history. Slice F adds the service/route layer, transaction-bound CMS audits, and the periodic expiry sweep.
- **Urgent-banner uniqueness:** a partial unique index `uq_community_content_active_urgent_banner` enforces at most one `PUBLISHED` urgent banner (`WHERE urgent_banner = TRUE AND lifecycle_status = 'PUBLISHED'`). PostgreSQL partial-index predicates require IMMUTABLE functions, so the volatile `expires_at > now()` clause is intentionally excluded from the index; expiry is enforced at read time by the Slice F service via the SQL predicate (matching the rest of the codebase).
- **RLS:** `FORCE ROW LEVEL SECURITY` is enabled on both tables. Public/anonymous/authenticated `SELECT` is limited to `lifecycle_status = 'PUBLISHED' AND (expires_at IS NULL OR expires_at > now())` (the version-table read is gated on the parent's published/non-expired state). All `INSERT`/`UPDATE`/`DELETE` are `SYSTEM_ADMIN`-only via the established `wims.current_user_role()` convention; no new auth/role check is introduced and no grant is made to `PUBLIC`. Tables are granted to `wims_app` for the public `SELECT` projection; writes are RLS-gated to admins.
- **Contributor snapshot and live score semantics:** `wims.civilian_contributors` records the service `formula_version` (default `reliability-v1`); the retired public-leaderboard `opt_in_leaderboard` flag is absent from the active schema. The live score in `src/backend/services/contributor.py` now aggregates only root reports (`linked_to_report_id IS NULL`), uses a UTC six-calendar-month activity window, and gives evidence credit per root report for photo presence, GPS consensus, photo/report proximity (`<= 500m`), and EXIF/report timestamp consistency within a 24-hour absolute tolerance.

### App-Enforced Only (Pydantic / application logic)

- Locality hierarchy consistency (city → barangay → province → region) — cross-table CHECKs impractical in PostgreSQL
- Monotonic workflow timestamps (`created_at ≤ submitted_at ≤ verified_at`) — cross-column CHECKs with nullable logic deferred to app
- `casualty_details` JSONB structure validation — stays in Pydantic/application layer
- Coordinate bounds (`latitude`, `longitude`) on `fire_incidents.location` — enforced via PostGIS geography type, not explicit CHECK
- Percentage fields (0–100%) — no percentage columns currently exist within the incident-domain tables (excluding tables like `wims.system_metrics`)

## Related
- [[backend/api-route-map]]
- [[security/security-baseline]]
