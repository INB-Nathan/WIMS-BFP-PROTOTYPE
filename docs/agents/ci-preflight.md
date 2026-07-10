# CI Pre-flight Routine

`.github/workflows/ci.yml` is the executable source of truth. Re-read it whenever
this runbook, tool versions, ignore lists, Compose files, or CI jobs change.

The merge gate currently requires five blocking jobs:

1. `migrations`
2. `frontend`
3. `backend`
4. `docker-build`
5. `security-scan`

Dependency audits and backend coverage are advisory (`continue-on-error`). A green
`make ci-local` is useful but is not equivalent to this gate.

## Validation Order

1. Run a focused test/repro for the changed behavior.
2. Run the affected subsystem lint/format/test/build checks.
3. Before a push or PR, run every applicable blocking gate locally or report the
   exact environment limitation and rely on the corresponding GitHub job.
4. Review `git diff`, `git diff --check`, and final `git status`.

Do not run destructive volume resets or production operations as preflight without
explicit approval.

## Backend Job

Main CI uses Python 3.12. The project supports Python 3.10+ and Ruff targets
`py310`, so changes must remain compatible with that range.

From `src/backend/`:

```bash
ruff check .
ruff format --check .
pytest -v --tb=short \
  --ignore=tests/test_rate_limiting.py \
  --ignore=tests/test_suricata_ingestion.py \
  --ignore=tests/test_infra_config.py \
  --ignore=tests/integration/test_wims_initial_schema_bootstrap.py \
  --ignore=tests/integration/test_auth_otp_policy.py \
  --ignore=tests/integration/test_database_schema.py \
  --ignore=tests/integration/test_rls_policy_enforcement.py \
  --ignore=tests/integration/test_sql_quality_audit.py
```

CI provides PostGIS and Redis services and runs `alembic upgrade head` before
pytest. Relevant environment values include:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wims_test"
export REDIS_URL="redis://localhost:6379/0"
export KEYCLOAK_REALM_URL="http://localhost:8080/auth/realms/bfp"
export KEYCLOAK_CLIENT_ID="wims-web"
export KEYCLOAK_AUDIENCE="wims-web"
export WIMS_MASTER_KEY="<valid non-production test key>"
```

### Pytest ignore semantics

`pytest.ini` contributes default `addopts` even when CI supplies explicit flags.
It currently adds the same infrastructure-heavy ignores **plus**
`tests/test_scheduled_reports.py`. Therefore a default or CI backend run does not
prove any ignored suite passed. Run an excluded suite explicitly in its required
Compose environment (overriding `addopts` when needed) and report it separately.

### Ruff failures

- Fix reported lint errors; do not add `noqa` without a real intentional exception.
- If `ruff format --check .` fails, run `ruff format` only on the intended files or
  `ruff format .`, review the resulting diff, and re-run the check.
- The configured Ruff rules are in `pyproject.toml`; do not invent an isort/import
  ordering requirement that is not enabled.

### Common evidence-led diagnostics

- UUID/string mismatch: inspect fixture overrides before adding `str()` blindly.
- Rows disappear after `commit()`: verify whether transaction-local RLS context was
  re-established.
- Seed rows are invisible: verify setup used the intended admin seed session and
  request execution used a non-superuser/RLS-scoped session.
- Import failures: confirm pytest was launched from `src/backend/` and inspect
  `pythonpath` in `pytest.ini`.

## Frontend Job

Main CI uses Node 20 and a clean lockfile install. From `src/frontend/`:

```bash
npm ci
npm run lint
npx vitest run
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp \
NEXT_PUBLIC_MAPBOX_TOKEN= \
NEXT_PUBLIC_BASE_URL=http://localhost \
npm run build
```

The build is part of the blocking job and performs Next.js/TypeScript production
validation. Report new lint warnings caused by the change even when only errors
block CI.

## Migration Job

CI starts a fresh PostGIS 15/PostGIS 3.4 database, installs backend dependencies,
and runs:

```bash
cd src/backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wims_test" \
  alembic upgrade head
```

The baseline Alembic revision bootstraps a fresh database from ordered
`src/postgres-init/*.sql` files (excluding its documented psql-only file), and later
revisions upgrade/repair the schema. It currently rolls back an individual failed
SQL file to a savepoint and logs the failure as non-fatal, so a zero Alembic exit
alone is not proof that every bootstrap file applied; inspect logs/schema and run
the relevant bootstrap contract tests. For migration changes, validate both:

- `alembic upgrade head` on a disposable fresh database; and
- the upgrade behavior from the prior revision/persistent-schema state when the
  change affects existing deployments.

Do not describe a manual SQL replay as the CI migration job. If the clean bootstrap
itself changed, also run its dedicated integration/SQL-quality tests in a disposable
environment. Those direct psql/bootstrap contracts preserve lexical ordering and
fail fast with `ON_ERROR_STOP=1`; the current Alembic `0001` behavior above is an
explicit non-fatal exception.

## Docker Build Job

CI copies the non-secret placeholder `.env.example` to `src/.env`, validates the
effective Compose config, and builds images:

```bash
cp .env.example src/.env  # only when no local src/.env must be preserved
cd src
docker compose config --quiet
docker compose build --parallel
```

Do not overwrite a developer's existing `src/.env`. A config parse success does not
prove images build or services become healthy; report each result separately.

For overlay changes, validate deterministic structural combinations with committed
non-secret placeholders:

```bash
cd src
docker compose --env-file ../.env.example \
  -f docker-compose.yml -f docker-compose.ci.yml config --quiet
docker compose --env-file ../.env.example \
  --env-file .env.production.example \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

The structural production command does not prove target values/secrets. When an
authorized local production file exists, validate actual interpolation without
printing it:

```bash
cd src
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

## Security Scan Job

CI builds the stack with `docker-compose.yml` plus `docker-compose.ci.yml`, waits for
the HTTP gateway, runs Nmap for unexpected ports, and runs the OWASP ZAP baseline
with `.zap/rules.tsv`. This is blocking.

Run the same stack/scan only in an isolated local environment with the required
Docker/network capability. If it is not practical locally, say so explicitly and
verify the GitHub `security-scan` job rather than claiming the gate passed.

## Fast Local Smoke Target

From the repository root:

```bash
make ci-local
```

This currently runs backend Ruff lint, frontend ESLint, backend default pytest, and
frontend Vitest. It omits Ruff format check, frontend build, Alembic migration,
Docker build/config validation, and the security scan.

## Before a PR or Push

- Target `master`, not stale `main`.
- Check the PR base with `gh pr view <N> --json baseRefName` when a PR exists.
- Review every skipped/default-ignored test and state why it was not run.
- Confirm no generated output, secret, local `.env`, Pi session/cache, or unrelated
  file is staged.
- Report command-by-command results; never summarize an unrun collection as green.
