# Source and Infrastructure Instructions

## Scope

Applies to `src/` and descendants. It supplements the root `AGENTS.md`.
Backend and frontend changes must also follow their nearer scoped files:

- `backend/AGENTS.md`
- `frontend/AGENTS.md`

This file is the canonical instruction scope for Compose and the infrastructure
implemented under `src/`; `../infra/AGENTS.md` is a compatibility routing index.

## Read Before Editing

| Area | Primary files and context |
|---|---|
| Compose/runtime topology | `docker-compose.yml`, the selected overlay, `.env` contract |
| Database/migrations | `backend/alembic/`, `postgres-init/` — read models + schemas for column/types, grep for RLS/grants |
| Keycloak | `keycloak/` — read realm JSON, theme files, SPI sources |
| Nginx | `nginx/nginx.conf`, `nginx/nginx.local.conf`, `nginx/nginx.ci.conf` |
| OpenBao | `openbao/`, `docs/operations/openbao-kms-runbook.md` |
| Suricata/IDS | `suricata/`, backend ingestion/tasks |
| Backend/frontend | The nearer `AGENTS.md` — discover routes from the live tree (`find api/routes/ -name '*.py'`) |

Read every Compose fragment participating in the target environment. Never infer
production behavior from the base file alone.

## Compose and Environment Rules

- Base/local: Compose automatically combines `docker-compose.yml` with
  `docker-compose.override.yml`.
- CI security stack: use `docker-compose.yml` plus `docker-compose.ci.yml`.
- Production: use `docker-compose.yml` plus `docker-compose.prod.yml` and the
  production env file. Do not load the local override into production commands.
- Preserve the PostgreSQL 15/PostGIS 3.4 compatibility pin unless a separately
  approved data-volume migration exists.
- When changing a service, inspect its image tag, ports, networks/static addresses,
  volumes, healthcheck, restart policy, `depends_on` conditions, resource limits,
  and all overlays. Do not claim stack-wide properties after checking one service.
- Keep public exposure behind Nginx unless an existing documented exception
  requires a loopback binding. Check every resulting port with `docker compose
  config`, not only source YAML.
- Never place secrets in Compose, Dockerfiles, realm JSON, scripts, or docs. Add
  placeholders to the appropriate example/env contract and fail clearly when a
  required production value is missing.
- Build-time `NEXT_PUBLIC_*` values are embedded in frontend output; treat them as
  public configuration, never secrets.

## Database and Migration Contract

There are two related paths; changes often need both:

1. `postgres-init/*.sql` is the canonical clean-volume bootstrap. PostgreSQL's
   Docker entrypoint processes files in lexical filename order on first volume
   creation only.
2. `backend/alembic/versions/` is the upgrade/deploy path for fresh and persistent
   databases. Existing volumes do not replay `postgres-init/`.

Rules:

- New persistent-schema changes require a new Alembic revision. Do not rely on
  editing an old bootstrap file or on first-boot behavior to update live data.
- Keep clean bootstrap SQL aligned when a fresh install also needs the change.
  Prefer a new, clearly ordered, idempotent SQL file over silently changing old
  migration semantics; if an old bootstrap file must change, pair it with an
  upgrade path for existing databases.
- Do not rewrite released Alembic history or downgrade semantics without explicit
  approval and a recovery plan.
- Preserve lexical ordering, schema qualification, and transaction behavior.
  Direct Docker/psql bootstrap and its contract tests use fail-fast
  `ON_ERROR_STOP=1`; Alembic revision `0001` is a documented exception that logs
  an individual SQL-file failure and continues, so inspect its logs/resulting
  schema and do not silently widen that fail-open behavior.
- Do not add `IF NOT EXISTS` or `OR REPLACE` merely to hide drift; use idempotency
  only when repeat execution is part of the contract.
- A new application table needs explicit grants, RLS enable/force/policies,
  service-account behavior, audit/immutability decisions, and enforcement tests.
- Keep PostGIS types/functions as the spatial source of truth.
- Use a disposable database for migration/bootstrap validation. Never test
  downgrades, resets, or `down -v` against a persistent developer or production
  volume without explicit approval.

## Service-Specific Safety

- **Keycloak:** realm imports and bootstrap behavior are persistent-state
  sensitive. Updating JSON does not prove an existing realm changed. Keep mirrored
  realm sources synchronized where the current workflow requires it and validate
  custom providers through their build/tests.
- **Nginx:** security/routing changes usually need equivalent treatment in
  production, local, and CI configs. Preserve TLS, headers, real-client-IP trust,
  rate limits, upload limits, SSE buffering rules, and `/auth/` ownership.
- **OpenBao:** initialization, unseal, tokens, Transit keys, and rotation are
  explicit security steps. Never simplify them or commit generated credentials.
- **Suricata:** host networking/capabilities and Redis/static-host mappings are
  Linux/VPS-sensitive. Detection knowledge belongs in rules; the LLM narrative is
  not the detector. Preserve SID uniqueness and validate rule syntax/contracts.
- **Celery/runtime services:** maintain the service/util boundary for external
  APIs and keep worker/backend schema, env, storage, and network contracts aligned.

### Celery beat singleton

The `celery-worker` service runs `celery ... worker --beat`
(see `docker-compose.yml`). The embedded `--beat` makes that single container the
Celery scheduler, so the beat is a de-facto SINGLETON. Do not set
`deploy.replicas > 1` or run multiple `celery-worker` instances without first
moving `--beat` to a dedicated single-instance beat service or adding leader
election; otherwise duplicate beat schedulers launch and double-fire periodic
tasks (e.g. `tasks.expire_content`). The idempotency of `tasks.expire_content`
(only transitions already-expired PUBLISHED rows) is a safety net, not a license
to run duplicate schedulers.

## Validation

Choose the checks matching the files changed, then follow the root preflight rule
before a push/PR.

```bash
# Effective local configuration (uses src/.env when present)
cd src && docker compose config --quiet

# Deterministic CI and structural production validation with committed placeholders
cd src && docker compose --env-file ../.env.example \
  -f docker-compose.yml -f docker-compose.ci.yml config --quiet
cd src && docker compose --env-file ../.env.example \
  --env-file .env.production.example \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet

# Target production interpolation (authorized local env file; do not print it)
cd src && docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet

# Alembic status/upgrade against a disposable target database
cd src/backend && alembic heads
cd src/backend && alembic upgrade head
```

For infrastructure contracts, run the relevant backend tests (for example
`backend/tests/test_infra_config.py`, Nginx, Suricata, RLS, or migration tests) and
state which infrastructure-heavy suites remained excluded. A clean `docker compose
config` is not a build, startup, migration, or health-check result; report those
separately.

## Destructive and Production Operations

`docker compose down -v`, image removal, database restore/downgrade, realm reset,
OpenBao reinitialization, production SSH, and production Compose changes require
explicit user approval. Before execution, state the host/environment, expected
data impact, rollback path, and verification command.
