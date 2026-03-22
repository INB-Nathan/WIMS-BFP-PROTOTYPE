# WIMS schema merge (v2 canonical + bootstrap)

## Source precedence

- **Canonical DDL:** `src/postgres-init/01_wims_initial.sql` — the only full WIMS DDL for greenfield installs (PostGIS, `wims` schema, Keycloak-linked `wims.users`, geography on `fire_incidents` / `citizen_reports`, nonsensitive/sensitive split, audit/security, wildland AFOR extensions).
- **Thin re-include:** `src/postgres-init/02_wims_schema.sql` contains only `\ir 01_wims_initial.sql` (idempotent second pass on fresh init).
- **Archived SQL:** superseded migrations, seeds, legacy pg_dump snapshot, and old no-op init stubs live in **`archive/sql/CONSOLIDATED_UNUSED_SQL.sql`** (see `archive/sql/README.md`). Do not run that bundle against a live DB.

## Wildland AFOR (workbook mapping)

Workbook: `AFORs/Wildland-Fires-After-Fire-Operation-Report.xlsx` — main form sheet **WILDLAND FIRE AFOR**.

| Workbook area | Storage |
|---------------|---------|
| A. Dates/times (call received, fire started, arrival, controlled) | `incident_wildland_afor.call_received_at`, `fire_started_at`, `fire_arrival_at`, `fire_controlled_at` |
| B. Caller/reporter — *caller/reported transmitted by*, *office/address of the caller*, *personnel on duty who received the call* | `caller_transmitted_by`, `caller_office_address`, `call_received_by_personnel` |
| C. Location of the incident & *approx distance of fire incident to FS* | `incident_location_description`, `distance_to_fire_station_km` |
| Engine dispatched (with A/D flow on form) | `engine_dispatched` |
| D. Actions taken — **primary only** (form has no “additional action taken” row) | `primary_action_taken` |
| E. Assistance / augmentation rows | `assistance_combined_summary`; repeating rows → `wildland_afor_assistance_rows` |
| G–I area type / causes / suppression | `area_type_summary`, `causes_and_ignition_factors`, `suppression_factors` (JSONB) |
| J–L buildings, ownership notes | `buildings_involved`, `buildings_threatened`, `ownership_and_property_notes` |
| M. Weather | `weather` JSONB — include **`fuel_moisture`**, **`fire_danger_rating`**, **`air_temperature`**, plus e.g. `weather_type`, `wind_direction`, `wind_speed_mph`, `relative_humidity` |
| N–O area burned & wildland fire type | `total_area_burned_display`, `total_area_burned_hectares`, `wildland_fire_type` (CHECK: see below) |
| P fire behavior | `fire_behavior` JSONB — e.g. `{ "elevation_ft", "relative_position_slope", "aspect", "flame_length_ft", "rate_of_spread_chains_per_hour" }` |
| P/Q alarm status timeline | `wildland_afor_alarm_statuses` (`alarm_status`, `time_declared`, `ground_commander`) — `alarm_status` CHECK: see below |
| R. Peso losses — two columns (**pre-incident value**, **losses**), each split into **property** and **contents** | `peso_losses` JSONB — shape below |
| S casualties | `casualties` JSONB — e.g. `{ "bfp": {"death","injured","missing"}, "civilian": {"death","injured","missing"} }` |
| T narration | `narration` |
| U/V problems & recommendations | `problems_encountered`, `recommendations` (JSONB arrays of strings) |
| Prepared/noted by | `prepared_by`, `prepared_by_title`, `noted_by`, `noted_by_title` |

### `peso_losses` JSON shape (section R)

Matches the form grid: pre-incident vs losses × property vs contents.

```json
{
  "pre_incident_value": { "property": null, "contents": null },
  "losses": { "property": null, "contents": null }
}
```

Use numeric PHP amounts where known; `null` if unknown.

### Wildland fire type (`wildland_fire_type`)

Stored as text; **`incident_wildland_afor_fire_type_check`** allows (case-insensitive, trimmed) one of:

`fire`, `agricultural land fire`, `brush fire`, `forest fire`, `grassland fire`, `grazing land fire`, `mineral land fire`, `peatland fire`

(`fire` is allowed as an alias for the generic first line on some forms; prefer `agricultural land fire` when that is what was meant.)

### Alarm status (`wildland_afor_alarm_statuses.alarm_status`)

**`wildland_afor_alarm_status_value_check`** allows exactly:

`1st Alarm`, `2nd Alarm`, `3rd Alarm`, `4th Alarm`, `Task Force Alpha`, `Task Force Bravo`, `General Alarm`, `Ongoing`, `Fire Out`, `Fire Under Control`, `Fire Out Upon Arrival`, `Fire Under Investigation`, `Late Reported`, `Unresponded`, `No Firefighting Conducted`

All wildland AFOR data **links** to `wims.fire_incidents(incident_id)` via `incident_wildland_afor`; **no duplicate** `fire_incidents` rows. Optional `import_batch_id` ties imports to `data_import_batches`. `source` is constrained to `AFOR_IMPORT` | `MANUAL`.

## Intentional breaking / semantic differences vs legacy `wims_schema` snapshot (archived)

- **Auth:** Snapshot shows `wims.users.user_id` → `auth.users(id)`; v2 uses **Keycloak** via `keycloak_id UUID NOT NULL UNIQUE` — **no** `auth.users`.
- **Roles:** Snapshot allows only `ENCODER`, `VALIDATOR`, `ANALYST`, `ADMIN`, `SYSTEM_ADMIN`; v2 adds **`NATIONAL_ANALYST`** and **`REGIONAL_ENCODER`** in `users_role_check`.
- **Barangay:** Snapshot has legacy `barangay` varchar on `incident_nonsensitive_details` alongside `barangay_id`; v2 is **`barangay_id` FK only** (no free-text `barangay` column).
- **Citizen / trust:** Snapshot omits `trust_score` / `description` on `citizen_reports`; those are in v2 initial DDL.
- **`fire_incidents`:** Snapshot has **no** `location` column in the excerpt (older model); v2 requires **`GEOGRAPHY(POINT,4326) NOT NULL`**.
- **Security:** v2 uses `raw_payload VARCHAR(65535)` and `suricata_sid CHECK (>0)` on `security_threat_logs` as in `schema_v2.sql`.

## Seeds

- **Reference seed:** `src/postgres-init/03_seed_reference.sql` — NCR row with `ON CONFLICT (region_code) DO NOTHING`.

## Bootstrap order (Postgres container)

Scripts under `/docker-entrypoint-initdb.d/` run in sorted order: `01_wims_initial.sql` → `02_wims_schema.sql` (Compose bind-mount of `schema_v2.sql`, idempotent `\ir`) → `03_seed_reference.sql` → `init-db.sh` (Keycloak DB/user only — **not** WIMS DDL).

## Keycloak

Database/user creation for Keycloak stays in `src/postgres-init/init-db.sh` only; it is **not** duplicated inside WIMS SQL.

## Integration test: `test_wims_initial_schema_bootstrap.py`

- Requires **`psql` on PATH**, a superuser URL, and reachable PostgreSQL + PostGIS.
- **`WIMS_SCHEMA_BOOTSTRAP_ADMIN_URL`:** optional override (default maintenance DB is `127.0.0.1:5432/postgres`; if **`DATABASE_URL`** points at `@postgres:` — e.g. `docker compose run backend` — the test derives `...@postgres:5432/postgres` automatically).
- If the server is unreachable, the test is **skipped** (pytest exit 0).
