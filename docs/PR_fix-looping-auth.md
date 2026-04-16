## Pull Request — WIMS-BFP

### Title
Fix Keycloak auth loop and bootstrap reliability for contributor setup

### Summary
This PR stabilizes authentication and first-run startup behavior by aligning Keycloak realm users and backend user resolution with database records, and by replacing fragile shell-based Keycloak DB bootstrap with SQL-based bootstrap that runs automatically on fresh Postgres initialization.

Primary outcomes:
- Prevent repeated Keycloak startup failures caused by missing `keycloak` role/database.
- Reduce login failures caused by missing user-role mappings and Keycloak/WIMS user identity mismatches.
- Keep contributor setup closer to "clone + compose up" on fresh volumes.

### Why This Change Was Needed
Observed issues during local bring-up and auth validation:
- Keycloak startup loop when Postgres did not have the `keycloak` role/database pre-created.
- Shell init script execution fragility in container init context.
- Login inconsistencies due to realm role/user mapping gaps.
- `JWT sub -> wims.users.keycloak_id` mapping failures for seeded users.

This PR addresses those root causes in repository code/bootstrap instead of requiring manual recovery commands.

### Changes Made (What + Why)

1) Added SQL bootstrap for Keycloak DB/user provisioning
- File: `src/postgres-init/00_keycloak_bootstrap.sql`
- What:
  - Creates role `keycloak` only if missing.
  - Creates database `keycloak` only if missing.
  - Grants DB and schema privileges required by Keycloak.
- Why:
  - Replaces shell-based bootstrap dependency with idempotent SQL executed by Postgres init automatically on fresh volume initialization.

2) Removed shell bootstrap script
- File removed: `src/postgres-init/init-db.sh`
- What:
  - Deleted shell script that previously created `keycloak` role/database.
- Why:
  - Shell execution was fragile in this environment and was a repeated source of startup failures.
  - SQL bootstrap is more deterministic in Docker Postgres init flow.

3) Improved backend identity resolution safety and compatibility
- File: `src/backend/auth.py`
- What:
  - Keeps primary lookup by `keycloak_id = token.sub`.
  - Adds fallback lookup by `preferred_username` for legacy/unlinked rows.
  - Adds mismatch guard: reject if username row is already linked to a different `keycloak_id`.
- Why:
  - Allows controlled transition when existing user rows are not yet linked.
  - Prevents accidental or malicious cross-account linking.

4) Aligned Keycloak realm roles and seeded users
- File: `src/keycloak/bfp-realm.json`
- What:
  - Added missing `NATIONAL_VALIDATOR` realm role.
  - Added `realmRoles` assignments to seeded users.
  - Added deterministic user `id` values for seeded users.
- Why:
  - Ensures tokens carry expected role context.
  - Keeps seeded users consistent with DB bootstrap assumptions for reliable development login flows.

5) Added deterministic seeded Keycloak-linked users in WIMS DB bootstrap
- File: `src/postgres-init/01_wims_initial.sql`
- What:
  - Inserts/updates dev users with fixed UUID `keycloak_id` values matching realm seeded user IDs.
- Why:
  - Ensures immediate `JWT sub -> wims.users` resolution in fresh environments.
  - Avoids first-login dead ends in dev where mapping is missing.

### Validation Performed
- Verified compose/init flow now includes SQL bootstrap file in `postgres-init`.
- Verified source changes are present in branch diff:
  - `src/postgres-init/00_keycloak_bootstrap.sql` (new)
  - `src/postgres-init/init-db.sh` (deleted)
  - `src/backend/auth.py` (updated)
  - `src/keycloak/bfp-realm.json` (updated)
  - `src/postgres-init/01_wims_initial.sql` (updated)

Note:
- Postgres init scripts execute only on first initialization of a data volume. Existing local volumes may require one-time reset to pick up new init scripts.

### Production Guidance (What Should Change Before Prod)
These changes are suitable for local/dev stabilization. Before production rollout, update the following:

1) Remove hardcoded/test credentials and users
- Do not keep seeded test users with static passwords in realm export.
- Move bootstrap admin/test credentials to secret manager or deploy-time secure injection.

2) Avoid deterministic user UUID strategy in production
- Keep deterministic IDs for local/dev only if needed.
- Prefer dynamic user lifecycle:
  - create/link WIMS user at first successful login, or
  - run secure sync job from IdP to app DB.

3) Harden Keycloak and token validation settings
- Use strict issuer/hostname configuration for production URL.
- Ensure TLS termination and `https` issuer consistency.
- Maintain strict audience/client checks.

4) Harden database bootstrap and privileges
- Store Keycloak DB password in secrets, not plain compose defaults.
- Consider least-privilege grants for app/runtime roles.
- Keep idempotent SQL migrations with audited versioning.

5) Remove `start-dev` runtime mode for Keycloak
- Use production Keycloak startup and persistence settings.
- Ensure realm import/deploy strategy is controlled and repeatable.

6) Add CI verification gates
- Add health-check integration test for full auth path:
  - Keycloak login -> JWT -> backend protected route -> RLS context.
- Add migration/bootstrap smoke test for fresh database startup.

### Risk / Rollback Notes
- Main risk is behavior difference for already-initialized local DB volumes where init scripts will not re-run.
- Rollback approach:
  - Revert changed files and restore previous bootstrap mechanism, or
  - keep SQL bootstrap and reinitialize local volumes to normalize environment state.

### Checklist
- [x] Auth startup path reviewed end-to-end
- [x] Keycloak DB bootstrap moved to SQL init
- [x] Role and user mapping alignment added
- [x] Backend identity mismatch safeguard added
- [ ] CI pipeline green (run in PR pipeline)
- [ ] Production secrets hardening completed
