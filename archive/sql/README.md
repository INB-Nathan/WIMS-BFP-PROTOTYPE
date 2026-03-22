# Archived SQL (consolidated)

Superseded or unused `.sql` files were merged into **`CONSOLIDATED_UNUSED_SQL.sql`** (with source path banners) and **removed** from `src/` to avoid drift against canonical bootstrap DDL.

**Current source of truth**

- `src/postgres-init/01_wims_initial.sql` — full WIMS schema
- `src/postgres-init/02_wims_schema.sql` — thin `\ir 01_wims_initial.sql` (idempotent second pass)
- `src/postgres-init/03_seed_reference.sql` — NCR seed

**What was archived**

| Former path | Role |
|-------------|------|
| `postgres-init/02_wims_schema.sql` (older snapshot) | Superseded layout; current `02` lives in `postgres-init` only |
| `postgres-init/03_seed_regions.sql` | No-op stub (superseded by `03_seed_reference.sql`) |
| `postgres-init/04_citizen_reports_columns.sql` | No-op stub (columns in `01`) |
| `postgres-init/05_add_national_analyst_role.sql` | No-op stub (roles in `01`) |
| `supabase/schema_v2.sql` (removed with `src/supabase/`) | Was duplicate thin `\ir`; replaced by `postgres-init/02_wims_schema.sql` |
| `supabase/wims_schema.sql` | Legacy pg_dump snapshot for diff only |
| `supabase/migrations/*.sql` | Old incremental migrations superseded by `01_wims_initial.sql` |
| `supabase/seeds/*.sql` | Dev seeds not referenced by app or compose |

Do not run `CONSOLIDATED_UNUSED_SQL.sql` as-is against a live database; it mixes historical migrations and duplicates. Use for audit/history only.
