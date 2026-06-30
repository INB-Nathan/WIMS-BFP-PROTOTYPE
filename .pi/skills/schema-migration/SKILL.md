---
description: Add or modify SQL bootstrap files, create tables, add RLS policies, audit triggers, or modify the database schema.
---

# Schema Migration

Use this skill when the agent needs to add or modify SQL bootstrap files in `src/postgres-init/`, create new database tables, add RLS policies, audit triggers, or modify the schema.

## Rules

1. **Lexical order matters.** Files are applied in strict `LC_ALL=C sort` order with `ON_ERROR_STOP=1`. New files must get the next sequential number (e.g., `49_...` → `50_...`).

2. **Schema prefix is mandatory.** All tables, functions, triggers, and policies go under the `wims.` schema. Never create objects in `public`.

3. **RLS is mandatory.** Every `wims.*` table must have:
   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
   - `CREATE POLICY ... USING (wims.current_user_id() = ...)` or appropriate role check
   - A helper function in `09_rls_helpers.sql` or `10_rls_policies.sql` if the policy pattern is new

4. **Audit triggers are required for mutation.** Tables that are INSERT/UPDATE/DELETE targets need an `AFTER` trigger writing to `wims.audit_log`. Follow the pattern in `63_fire_incidents_insert_audit_trigger.sql` (SECURITY DEFINER, GUC guard).

5. **PII must be encrypted.** If adding PII columns, add an encrypted counterpart (AES-256-GCM via `utils/crypto.py`). Plaintext PII columns must be NULL for new writes.

6. **Materialized views** go after all base tables. Prefix with a high number (e.g., `60_*`). Add `REFRESH` handling.

7. **Seed/demo data** goes in numbered files after schema objects (e.g., `70_*`).

## Steps

1. Identify the next available sequence number: `ls src/postgres-init/*.sql | tail -1`
2. Create the new file with the next number and a descriptive kebab-case name.
3. Include all required RLS, audit, and encryption wiring.
4. Test locally: apply the file against a throwaway Postgres with `ON_ERROR_STOP=1`.
5. Update `system-wiki/database/sql-init-files.md` if the new file adds a notable table or behavior.
