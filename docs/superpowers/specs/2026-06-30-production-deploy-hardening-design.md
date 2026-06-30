# Production Deploy Hardening: Static IP Reconcile, Suricata Startup, and Ledgered Live Migrations

**Date:** 2026-06-30
**Status:** Draft
**PR strategy:** One combined PR
**Pattern:** Docker Compose deploy hardening + production migration runner + operational safeguards
**Scope:** `.github/workflows/deploy.yml`, `src/docker-compose.yml`, live SQL migration execution, Suricata container startup, deployment contract tests, and deployment docs.
**Base branch assumption:** current `origin/master` contains `src/postgres-init/78_siem_config_patch.sql`; therefore the next SQL bootstrap file for this PR is `79_schema_migrations.sql`.

---

## Problem

The `master` deploy for commit `907b6df` failed during the SSH deploy step after CI and image builds succeeded. The deploy script suppressed the actual Compose error (`compose up ... 2>/dev/null`), so the GitHub Actions log only showed a generic retry failure.

Live VPS diagnosis on `wims@194.233.81.162:/opt/wims-bfp/src` identified three independent deploy fragilities.

### Root Cause 1 — static-IP drift after PR #487

PR #487 pinned core services to low static IPs because several containers use `extra_hosts` to bypass unreliable Docker DNS after network recreation:

| Service | Required IP | Observed IP before remediation | Why it matters |
|---|---:|---:|---|
| `postgres` | `172.18.0.3` | `172.18.0.133` | Keycloak/backend/celery `extra_hosts` point to `.3` |
| `redis` | `172.18.0.5` | `172.18.0.130` | Celery/Suricata `extra_hosts` point to `.5` |
| `openbao` | `172.18.0.8` | `172.18.0.131` | OpenBao bootstrap `extra_hosts` point to `.8` |
| `keycloak` | `172.18.0.7` | `172.18.0.7` | Already correct |
| `ollama` | `172.18.0.4` | `172.18.0.4` | Already correct |

Docker Compose did not force-recreate existing containers just because `ipv4_address` changed. Newly recreated services had `/etc/hosts` entries pointing at the static IPs, while the old infrastructure containers were still on dynamic addresses. Result: Keycloak and Celery logged `No route to host`.

### Root Cause 2 — Suricata read-only config mount breaks image entrypoint

`wims-suricata` bind-mounted the custom config over the image's default path:

```yaml
./suricata/suricata.yaml:/etc/suricata/suricata.yaml:ro
```

The `jasonish/suricata:7.0.5` entrypoint runs:

```sh
chown -R suricata:suricata /etc/suricata
```

With a read-only file mounted inside `/etc/suricata`, the entrypoint exits before Suricata starts. Live log symptom:

```text
chown: changing ownership of '/etc/suricata/suricata.yaml': Read-only file system
```

### Root Cause 3 — live deploy replays bootstrap SQL while app traffic holds locks

The deploy workflow replays every file in `src/postgres-init/*.sql` against the live DB after Compose has already started the app tier. This is fragile because:

1. `src/postgres-init/` is a bootstrap directory, not a ledgered migration system.
2. Several old files are not idempotent on an existing production DB.
3. Backend startup patches also perform DDL.
4. Live backend/celery sessions can hold `AccessShareLock`/transaction locks while deploy DDL waits.

Observed hang: the manual migration loop stopped at `03_users.sql`. Postgres showed the `psql` session blocked on `wims.users`, while backend startup DDL sessions were waiting on `DROP POLICY IF EXISTS users_self_or_admin_select ON wims.users`.

---

## Goal

Ship one PR that makes production deploys repeatable and diagnosable without relying on hand-edited VPS state.

After the PR is merged and deployed:

1. The normal GitHub deploy workflow can recover from stale dynamic IPs by force-recreating only affected fixed-IP infrastructure containers while preserving volumes.
2. `compose up` failures print useful logs in GitHub Actions.
3. `wims-suricata` starts from committed Compose config without a VPS-only override.
4. Live DB changes are applied by a ledgered migration runner, not by replaying every historical bootstrap SQL file on every deploy.
5. Old non-idempotent bootstrap files are baselined on existing deployments and never replayed unless explicitly handled.
6. Future live migrations are applied once, checksummed, lock-bounded, and fail the deploy if they fail.
7. The temporary VPS file `/opt/wims-bfp/src/docker-compose.hotfix-20260630.yml` is no longer required after the fixed deploy runs.

---

## Non-goals

- Do not remove the static-IP/`extra_hosts` approach in this PR. The live VPS has already demonstrated Docker DNS unreliability after network recreation, and Suricata host networking still needs explicit Redis resolution.
- Do not rewrite all historical SQL bootstrap files for full idempotency in this PR.
- Do not wipe Docker volumes or recreate the production database.
- Do not change frontend/backend API contracts.
- Do not move business logic into routes or frontend code.

---

## Single-PR implementation plan

Use one PR with three implementation phases because the current rollout request is to ship PR1+PR2 together. Keep commits separable inside the PR for review, but merge/deploy as one unit. Because Phase B is higher risk than the urgent Suricata/deploy-log hotfix, this combined PR must include a migration runner `--dry-run` mode and a rehearsal against a production DB snapshot before the first live ledger run.

### Phase A — Compose and deploy recovery hardening

#### A1. Suricata config mount fix

Modify `src/docker-compose.yml` without dropping existing live keys. The snippet below is illustrative and must be merged into the current service while preserving `container_name`, `restart: unless-stopped`, `extra_hosts`, and the existing healthcheck:

```yaml
wims-suricata:
  image: jasonish/suricata:7.0.5
  network_mode: "host"
  cap_add:
    - NET_ADMIN
    - NET_RAW
    - SYS_NICE
  command: -c /etc/wims-suricata/suricata.yaml --af-packet=${SURICATA_INTERFACE:-eth0} --runmode workers
  volumes:
    - ./suricata/logs:/var/log/suricata
    - ./suricata/rules:/var/lib/suricata/rules
    - ./suricata/suricata.yaml:/etc/wims-suricata/suricata.yaml:ro
```

Rationale:

- Keep the image entrypoint so Suricata can drop to the non-root `suricata` user.
- Avoid mounting a read-only file inside `/etc/suricata`, which the entrypoint chowns.
- Add `SYS_NICE` because the entrypoint only runs `fix_perms`/drops privileges when both `sys_nice` and `net_admin` are available.
- Verify `src/suricata/suricata.yaml` does not depend on files from the old bind-mounted `/etc/suricata/suricata.yaml` path. The current config references `/etc/suricata/classification.config` and `/etc/suricata/reference.config`; those should come from the image defaults after the custom YAML moves to `/etc/wims-suricata/suricata.yaml`.

#### A2. Static-IP reconciliation in deploy workflow

Modify `.github/workflows/deploy.yml` to add `ensure_static_ip_allocations()` before the main `compose up`.

Required behavior:

1. Inspect the running container IPs for:
   - `wims-postgres` → `172.18.0.3`
   - `wims-ollama` → `172.18.0.4`
   - `wims-redis` → `172.18.0.5`
   - `wims-keycloak` → `172.18.0.7`
   - `wims-openbao` → `172.18.0.8`
2. If any are missing or mismatched:
   - stop app-tier containers (`backend`, `celery-worker`, `frontend`, `nginx-gateway`) and dependent one-shots as needed;
   - remove stale one-shot containers (`keycloak-bootstrap`, `openbao-bootstrap`, `ollama-model-pull`);
   - recreate fixed-IP infrastructure in dependency order, not as one unordered batch:
     1. recreate `postgres`, `redis`, `openbao`, and/or `ollama` if mismatched;
     2. wait for recreated infrastructure health (`pg_isready`, Redis ping, OpenBao reachable/unsealed if applicable, Ollama healthy);
     3. recreate `keycloak` if mismatched, after Postgres is reachable;
   - keep all named volumes intact.
3. Do not remove named volumes.
4. Print the before/after drift messages to the deploy log.

#### A3. Stop swallowing Compose errors

Replace:

```bash
compose up -d --build --wait --wait-timeout 600 2>/dev/null
```

with log capture:

```bash
COMPOSE_UP_LOG="/tmp/wims-compose-up-${BUILD_ATTEMPT}.log"
if compose up -d --build --wait --wait-timeout 600 >"$COMPOSE_UP_LOG" 2>&1; then
  tail -n 80 "$COMPOSE_UP_LOG" || true
else
  tail -n 200 "$COMPOSE_UP_LOG" || true
  compose ps -a || true
  exit 1
fi
```

### Phase B — Ledgered live migration runner

The deploy workflow must stop replaying every bootstrap SQL file directly.

#### B1. Add migration ledger table

Create a new SQL file, proposed name:

```text
src/postgres-init/79_schema_migrations.sql
```

Contents create only the ledger table/indexes/policies/triggers for fresh databases. Because this is a `wims.*` table, it must follow the repository schema rules: RLS is mandatory and mutations need an audit trigger.

```sql
CREATE TABLE IF NOT EXISTS wims.schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('baseline', 'applied', 'failed')),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER,
  deploy_commit TEXT,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at
ON wims.schema_migrations(applied_at DESC);

ALTER TABLE wims.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.schema_migrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schema_migrations_admin_select ON wims.schema_migrations;
CREATE POLICY schema_migrations_admin_select
ON wims.schema_migrations FOR SELECT
USING (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS schema_migrations_admin_write ON wims.schema_migrations;
CREATE POLICY schema_migrations_admin_write
ON wims.schema_migrations FOR INSERT
WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS schema_migrations_admin_update ON wims.schema_migrations;
CREATE POLICY schema_migrations_admin_update
ON wims.schema_migrations FOR UPDATE
USING (wims.current_user_role() = 'SYSTEM_ADMIN')
WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');
```

Also add an `AFTER INSERT OR UPDATE` trigger, modeled on `63_fire_incidents_insert_audit_trigger.sql`, that uses a `SECURITY DEFINER` function with `SET search_path = wims, pg_catalog` and writes a `SCHEMA_MIGRATION_LEDGER_CHANGE` row to `wims.system_audit_trails` with `table_affected='wims.schema_migrations'`, `record_id=NULL`, and JSON details for filename/status/deploy_commit. No PII is stored.

Do **not** insert rows from this SQL file. The live migration runner owns baselining and per-file recording.

#### B2. Add migration runner script

Create:

```text
src/backend/scripts/apply_live_migrations.py
```

Run inside a one-off backend container so it has:

- `psql` from the backend image (`postgresql-client` already installed),
- `/postgres-init` read-only mount,
- `DATABASE_ADMIN_URL` for admin-level migration execution,
- same Compose network/`extra_hosts` as backend.

Required Compose change for the runner: add this read-only mount to the `backend` service (or pass an equivalent one-off `-v` in the deploy command):

```yaml
services:
  backend:
    volumes:
      - ./postgres-init:/postgres-init:ro
```

Do not rely on the Postgres service's `/docker-entrypoint-initdb.d` mount; `compose run --rm --no-deps -T backend ... --dir /postgres-init` only sees the backend service filesystem.

Runner requirements:

1. Parse args:
   - `--dir /postgres-init`
   - `--baseline-existing`
   - `--baseline-through 79_schema_migrations.sql`
   - `--lock-timeout 30s`
   - `--deploy-commit "$DEPLOY_COMMIT"`
   - `--dry-run`
   - optional escape hatch: `--allow-failed-checksum-change`
2. Connect using `DATABASE_ADMIN_URL`.
   - Guardrail: fail fast with a clear message unless the connection user is a superuser or has `BYPASSRLS`. The initial implementation relies on the current production admin URL (`postgres`) bypassing FORCE RLS for ledger writes. If this is later hardened to a non-superuser DDL role, ledger mutations must move behind explicit `SECURITY DEFINER` functions before this guard is relaxed.
3. Ensure the full governed `wims.schema_migrations` ledger exists even if `79_schema_migrations.sql` has not been run yet.
   - Avoid two divergent sources of truth: `ensure_ledger_schema()` must execute the ledger DDL from `src/postgres-init/79_schema_migrations.sql` (or both the SQL file and runner must be generated from a shared template). Do not duplicate an independently maintained copy of the ledger DDL in Python.
   - The DDL must cover table, index, RLS enable/force, policies, audit trigger function, and audit trigger.
   - In `--dry-run`, do not create/alter the ledger; inspect what exists and print the plan only.
4. Acquire a Postgres advisory lock for the whole runner process, e.g. `pg_try_advisory_lock(hashtext('wims-live-migrations'))`.
   - If lock cannot be acquired, exit non-zero.
   - Keep the advisory-lock connection open until all file execution and ledger writes are finished; subprocess `psql` calls do not hold this lock themselves.
5. Sort `*.sql` in `LC_ALL=C` lexical order.
   - This ordering must match the repository's bootstrap/CI assumption for `src/postgres-init`. Do not use `ls -v` in live deploys. Future filenames must keep zero-padded numeric prefixes so C-locale order remains obvious and deterministic.
6. Compute SHA-256 for every SQL file.
7. Existing DB baseline behavior:
   - If the ledger has zero rows and a known production table exists (e.g. `wims.users`), insert files up to and including `--baseline-through 79_schema_migrations.sql` as `status='baseline'` with their checksums and `deploy_commit`.
   - Do not execute historical files during the baseline step.
   - Do **not** baseline files after `--baseline-through`; if a later SQL file exists, apply it normally as a new live migration.
   - This is what prevents old non-idempotent files (`03_users.sql`, `13_export_reports.sql`, etc.) from replaying on production without accidentally swallowing future migrations.
   - This combined PR must not modify existing historical SQL files and must not include functional SQL migrations after `79_schema_migrations.sql`. Any functional DB change must be a later PR/new migration so the first ledger deploy can baseline safely.
8. Fresh DB behavior and future migration authoring rule:
   - Fresh DB bootstrap still runs `src/postgres-init/*.sql` via the Postgres Docker entrypoint.
   - The first later deploy sees an existing DB and empty ledger, then baselines the already-applied files through the configured cutoff.
   - Because Docker entrypoint bootstrap and the live runner coexist, every new SQL file after `79_schema_migrations.sql` must be re-runnable/idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`, guarded `DO $$` blocks, etc.). Otherwise a fresh DB can bootstrap a future `80_*.sql` file and then have the first runner invocation try to apply it again because `--baseline-through` intentionally remains `79_schema_migrations.sql` for unledgered existing databases.
   - Do not advance `--baseline-through` past `79_schema_migrations.sql` on production unless a snapshot rehearsal proves the target unledgered database already has the later migration effects. This prevents swallowing required migrations on old existing DBs that missed the first ledger rollout.
9. `--dry-run` behavior:
   - Must not execute SQL files.
   - Must not create, update, or delete ledger rows.
   - Must print the exact planned actions (`baseline`, `skip`, `apply`, checksum-drift failure, failed-row retry) and return non-zero on fatal plan issues such as checksum drift, inaccessible `/postgres-init`, missing `79_schema_migrations.sql`, or unsafe admin/RLS configuration.
10. Normal future behavior:
   - If a filename is absent from the ledger, execute it once with:
     ```bash
     psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -c "SET lock_timeout = '30s';" -f "$file"
     ```
   - On success, insert `status='applied'`, checksum, duration, deploy commit.
   - On failure, insert/update `status='failed'`, checksum, duration, error text, then exit non-zero.
   - A row with `status='failed'` is **not** treated as applied. If the checksum is unchanged, retry that file on the next runner invocation and update the row to `applied` on success. If the checksum changed while status is `failed`, allow retry only with an explicit `--allow-failed-checksum-change` flag or require a new forward-fix migration; do not silently treat it as drift-free.
11. Checksum drift behavior:
    - If a filename exists with `status IN ('baseline', 'applied')` and a different checksum, fail fast.
    - Historical migration files become immutable after baselining.
12. Logging:
    - Print `baseline`, `skip`, `apply`, `applied`, and `failed` lines.
    - Do not print secrets or connection URLs.

#### B3. Update deploy workflow to use the runner

Replace the current direct SQL replay loop and adjust deployment ordering so new app containers do not start before required live migrations.

Target deploy order:

0. Define/export deploy metadata in the workflow and SSH environment, e.g. `DEPLOY_COMMIT=${{ github.sha }}`; the deploy script must not reference an unset `$DEPLOY_COMMIT`.
1. Validate Compose config and clean stale containers.
2. Reconcile static-IP infrastructure drift (`ensure_static_ip_allocations`).
3. Build images without starting the app tier:
   ```bash
   compose build backend celery-worker keycloak frontend
   ```
4. Ensure infrastructure dependencies are running/healthy, without starting backend/frontend/nginx yet:
   ```bash
   compose up -d --wait --wait-timeout 600 \
     postgres redis openbao openbao-bootstrap ollama ollama-model-pull keycloak keycloak-bootstrap mailhog wims-suricata
   ```
5. Stop app tier just before live migrations. Existing app containers should still be the previous known-good containers at this point:
   ```bash
   compose stop backend celery-worker frontend nginx-gateway || true
   ```
6. Run the migration runner dry-run first, then the mutating runner if the plan is clean:
   ```bash
   compose run --rm --no-deps -T backend \
     python scripts/apply_live_migrations.py \
       --dir /postgres-init \
       --baseline-existing \
       --baseline-through 79_schema_migrations.sql \
       --lock-timeout 30s \
       --deploy-commit "$DEPLOY_COMMIT" \
       --dry-run

   compose run --rm --no-deps -T backend \
     python scripts/apply_live_migrations.py \
       --dir /postgres-init \
       --baseline-existing \
       --baseline-through 79_schema_migrations.sql \
       --lock-timeout 30s \
       --deploy-commit "$DEPLOY_COMMIT"
   ```
7. If either migration runner invocation fails, restart the previous app tier for availability, then exit non-zero so the deploy is marked failed:
   ```bash
   compose start backend celery-worker frontend nginx-gateway || true
   exit 1
   ```
8. If migrations succeed, start/recreate the full production stack from the newly built images:
   ```bash
   compose up -d --wait --wait-timeout 600
   ```
9. Preserve the existing backend/public health-check and rollback block after the final app-tier start. The `src-backend-rollback:latest` rollback remains a post-start health fallback; it is separate from the migration-failure path, which should only restart the previous app tier and fail the deploy before new images are promoted as healthy.

Important: new live migrations must now be blocking. Do not continue silently on migration failure after the ledger runner is in place. The failure path should preserve availability by restarting the previous app tier when possible, but it must not append a successful deploy history entry.

### Phase C — tests, docs, and operational cleanup

#### C1. Contract tests

Add/update backend tests:

1. `tests/test_suricata_redis_host_networking.py`
   - Suricata must keep `network_mode: host`.
   - Suricata must use `extra_hosts: ["redis:172.18.0.5"]`.
   - Suricata config must mount at `/etc/wims-suricata/suricata.yaml:ro`.
   - Suricata command must include `-c /etc/wims-suricata/suricata.yaml`.
   - Suricata must not bind-mount over `/etc/suricata/suricata.yaml`.
   - `SYS_NICE` must be in `cap_add`.

2. New `tests/test_live_migration_runner_contract.py`
   - Runner defines/creates `wims.schema_migrations`.
   - `79_schema_migrations.sql` enables/forces RLS and defines admin-only policies.
   - `79_schema_migrations.sql` defines an audit trigger for ledger INSERT/UPDATE.
   - Runner does not maintain a divergent ledger DDL copy; it sources `79_schema_migrations.sql` or a shared template.
   - A schema-equivalence test applies the SQL-file path and the runner ensure path to two throwaway DBs/schemas and compares the resulting table, policies, trigger function, trigger, and index definitions.
   - Runner refuses unsafe admin/RLS configuration unless the connection user can bypass RLS or the implementation uses SECURITY DEFINER ledger-write functions.
   - Runner sorts SQL files lexically with `LC_ALL=C` semantics.
   - Runner computes SHA-256.
   - Runner baselines an existing DB through `--baseline-through 79_schema_migrations.sql` instead of applying historical files when ledger is empty and `--baseline-existing` is set.
   - Runner does not baseline files after `--baseline-through`.
   - Runner documents/enforces that future post-79 migration files are idempotent/re-runnable.
   - `--dry-run` does not mutate the DB and prints the same planned baseline/apply/skip/failure decisions as the non-dry-run path.
   - Runner fails on checksum drift for `baseline`/`applied` rows.
   - Runner retries same-checksum `failed` rows instead of skipping them.
   - Runner invokes `psql` with `ON_ERROR_STOP=1` and `lock_timeout`.
   - Runner fails deploy on new migration failure.

3. Workflow/static test (required):
   - Deploy workflow must not contain `compose up ... 2>/dev/null`.
   - Deploy workflow must call `ensure_static_ip_allocations`.
   - Deploy workflow must define/export `DEPLOY_COMMIT`.
   - Deploy workflow must call `apply_live_migrations.py` instead of looping over every SQL file directly.
   - Backend service or one-off deploy command must provide `/postgres-init` to the runner read-only.
   - Existing backend health-check rollback using `src-backend-rollback:latest` must remain after the final app-tier start.

#### C2. Compose validation

Run:

```bash
cd src
POSTGRES_PASSWORD=postgres \
KC_DB_PASSWORD=keycloak \
KEYCLOAK_ADMIN_PASSWORD=admin \
PUBLIC_BASE_URL=https://wimsbfp.tech \
WIMS_MASTER_KEY=0123456789abcdef0123456789abcdef \
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

#### C3. Documentation updates

Update:

- `system-wiki/architecture/infrastructure-config.md`
  - Suricata custom config mount path and entrypoint constraint.
  - Static low IP / dynamic high IP pattern.
- `system-wiki/database/sql-init-files.md`
  - Add `79_schema_migrations.sql`.
  - Explain that `postgres-init` remains first-boot bootstrap; live deploy uses ledger runner.
- `system-wiki/log.md`
  - Deployment incident and remediation summary.
- Optional: `docs/agents/ci-preflight.md`
  - Add migration-ledger validation under SQL gate.

---

## Rollout plan

### Pre-merge local validation

Run targeted checks:

```bash
cd src/backend
pytest -q tests/test_suricata_redis_host_networking.py tests/test_live_migration_runner_contract.py
ruff check tests/test_suricata_redis_host_networking.py tests/test_live_migration_runner_contract.py scripts/apply_live_migrations.py
ruff format --check tests/test_suricata_redis_host_networking.py tests/test_live_migration_runner_contract.py scripts/apply_live_migrations.py
```

Run the migration runner in `--dry-run` mode against a disposable DB fixture and against a production DB snapshot. The snapshot rehearsal is mandatory for the combined PR because the first live ledger run is the riskiest part of the change.

Validate YAML and shell syntax:

```bash
python - <<'PY'
from pathlib import Path
import yaml
for path in ['.github/workflows/deploy.yml', 'src/docker-compose.yml']:
    yaml.safe_load(Path(path).read_text())
PY

python - <<'PY'
from pathlib import Path
import yaml
wf = yaml.safe_load(Path('.github/workflows/deploy.yml').read_text())
for step in wf['jobs']['deploy']['steps']:
    if step.get('name') == 'Deploy via SSH':
        Path('/tmp/deploy-step.sh').write_text(step['with']['script'])
        break
PY
bash -n /tmp/deploy-step.sh
```

Run compose config validation (command from C2).

Before merge, rehearse against a production DB snapshot:

1. Restore a recent production dump/snapshot into an isolated Postgres instance or cloned Docker volume.
2. Run the new runner with `--dry-run` and confirm it plans to baseline through `79_schema_migrations.sql`, apply nothing after the cutoff, and reports no checksum drift.
3. Run the new runner without `--dry-run` on the snapshot and confirm it records baseline rows, does not execute historical non-idempotent files, and leaves app-critical tables intact.
4. Record the rehearsal command/output in the PR description.

### Merge/deploy sequence

1. Commit the combined PR.
2. Push and wait for CI.
3. Merge to `master` only after the snapshot rehearsal passes.
4. Let GitHub Actions deploy run normally.
5. Confirm deploy log shows:
   - static-IP check passed or reconciled,
   - migration runner dry-run/snapshot rehearsal was completed before merge,
   - migration runner baselined existing files through `79_schema_migrations.sql` on first live run,
   - no direct replay loop over every SQL file,
   - app tier restarted after migrations,
   - public health checks passed.
6. Confirm the temporary VPS override was removed by `git clean -fd`:
   ```bash
   ssh wims@194.233.81.162 'test ! -e /opt/wims-bfp/src/docker-compose.hotfix-20260630.yml && echo removed'
   ```
7. Verify production:
   ```bash
   curl -fsS https://wimsbfp.tech/health
   curl -fsS https://wimsbfp.tech/auth/realms/bfp/.well-known/openid-configuration >/dev/null
   curl -fsS https://wimsbfp.tech/login >/dev/null
   curl -fsS https://wimsbfp.tech/api/public/emergency-services >/dev/null
   ssh wims@194.233.81.162 'docker exec wims-ollama ollama list | grep qwen2.5:3b'
   ```
8. Verify static IPs:
   ```bash
   ssh wims@194.233.81.162 'for c in wims-postgres wims-redis wims-openbao wims-keycloak wims-ollama; do docker inspect "$c" --format "{{.Name}} {{range $n,$v := .NetworkSettings.Networks}}{{$n}}={{$v.IPAddress}} {{end}}"; done'
   ```
9. Verify migration ledger. Expect roughly one audit-trail row per baseline ledger insert during the first live run; this is acceptable baseline noise and should not be treated as an incident.
   ```bash
   ssh wims@194.233.81.162 'cd /opt/wims-bfp/src && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production exec -T postgres psql -U postgres -d wims -c "SELECT status, count(*) FROM wims.schema_migrations GROUP BY status ORDER BY status;"'
   ```

---

## Rollback plan

### If Compose deploy fails before migrations

- The deploy log now contains the `compose up` tail and `compose ps -a`.
- Fix the reported container issue or revert the PR.
- Do not run `docker compose down -v`.

### If Suricata fails after merge

Temporary fallback, if needed:

```yaml
services:
  wims-suricata:
    entrypoint: ["/usr/bin/suricata"]
```

Use only as a short-lived VPS override. The preferred fix is to correct the committed mount/command/capabilities.

### If migration runner fails on a new migration

- The runner records `status='failed'` and exits non-zero.
- Do not mark the migration as applied manually unless the DB state has been verified.
- Fix the SQL file or write a forward-fix migration.
- If the file was partially applied, use explicit repair SQL and update the failed ledger row only after verification.

### If the whole PR must be reverted

- Revert workflow/Compose/test/doc changes.
- Leave `wims.schema_migrations` in the database; it is additive and harmless.
- If the VPS hotfix file was removed and master does not yet contain the Suricata fix, recreate the temporary override before running `compose up`.

---

## Acceptance criteria

The combined PR is complete when all of the following are true:

1. **Deploy observability:** no deploy path suppresses `compose up` stderr; failed Compose attempts show the last 200 log lines and `compose ps -a`.
2. **Static IP self-heal:** deploy detects and reconciles stale dynamic IPs for postgres, redis, openbao, keycloak, and ollama without deleting volumes.
3. **Suricata startup:** `wims-suricata` starts without a VPS-only override while keeping the custom config read-only.
4. **Migration ledger:** `wims.schema_migrations` exists on fresh and live DBs.
5. **Ledger table governance:** `wims.schema_migrations` has RLS enabled/forced and an audit trigger for INSERT/UPDATE ledger changes.
6. **No historical replay:** first deploy with the runner baselines existing SQL files through `79_schema_migrations.sql` instead of executing old non-idempotent bootstrap files.
7. **No first-run migration swallowing:** SQL files after the configured baseline cutoff are not baselined; they are applied normally.
8. **Future migrations:** a new SQL file absent from the ledger on a live ledgered DB is applied once, checksummed, and recorded; post-79 SQL files are idempotent/re-runnable to protect fresh-DB bootstrap plus first-run runner behavior.
9. **Dry-run and rehearsal:** runner `--dry-run` is non-mutating, and the first live ledger deploy is rehearsed on a production DB snapshot before merge.
10. **Single ledger schema source:** runner and `79_schema_migrations.sql` cannot drift; tests prove equivalent resulting schema or both are generated from one source.
11. **RLS/admin guardrail:** runner fails fast if `DATABASE_ADMIN_URL` cannot bypass FORCE RLS or does not use SECURITY DEFINER ledger writes.
12. **Failed migration semantics:** failed rows are not skipped as applied; same-checksum failures are retried or explicitly handled.
13. **Checksum safety:** editing an already-applied SQL file causes deploy failure, not silent reapplication.
14. **Lock safety:** migration execution uses bounded lock waits and runs while app-tier services are stopped.
15. **Production health:** after the normal GitHub deploy, public health, Keycloak OIDC, frontend login, backend public API, and Ollama model checks pass.
16. **Hotfix cleanup:** `/opt/wims-bfp/src/docker-compose.hotfix-20260630.yml` is absent after the successful deploy.

---

## Known follow-ups outside this PR

- Fix or triage Suricata custom rule parse errors observed in logs. The container can be healthy while some custom signatures fail to load; that is a detection-quality issue, not the deploy-startup issue fixed here.
- Gradually make historical bootstrap SQL files idempotent or split them into `bootstrap/` vs `migrations/` directories.
- Add a human-readable migration authoring guide for future agents once the runner is landed. Until that guide exists, PR reviewers must enforce the post-79 idempotency/re-runnability rule manually.
