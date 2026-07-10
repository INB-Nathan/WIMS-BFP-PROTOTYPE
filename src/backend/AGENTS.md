# Backend Instructions

## Scope and Context

Applies to `src/backend/` and descendants. It supplements the root and
`src/AGENTS.md`; neither security nor data-integrity rules may be relaxed here.

Read on demand:

- `api/routes/` — HTTP boundaries and dependency wiring
- `schemas/` — Pydantic request/response contracts
- `services/` — domain logic and external-system adapters
- `models/` — SQLAlchemy mappings, not the sole schema authority
- `tasks/` and `celery_config.py` — background orchestration and schedules
- `database.py`, `auth.py` — session, RLS, authentication, and RBAC boundaries
- `alembic/` plus `../postgres-init/` — persistent upgrades and clean bootstrap
- `tests/`, `pytest.ini`, `pyproject.toml` — test tiers and executable conventions

Architecture maps:

- `system-wiki/backend/api-route-map.md`
- `system-wiki/database/schema-overview.md`
- `system-wiki/security/security-baseline.md`
- the task-specific pack in `system-wiki/operations/agent-routing-guide.md`

## Implementation Boundaries

- Put new or changed non-trivial business logic in a domain service. Routes should
  validate/parse, resolve dependencies and authorization, invoke a service, and
  marshal the response.
- Some legacy routes still contain direct SQL and domain logic. Do not copy those
  exceptions, and do not refactor them opportunistically outside the requested
  scope.
- Define externally visible request/response shapes in `schemas/`. Coordinate
  contract changes with services, routes, frontend types/clients, and tests.
- Prefer existing service/util adapters over new wrappers. For new or changed
  external integrations, Celery tasks orchestrate those adapters rather than adding
  direct HTTP/SMTP/Firebase/Ollama calls. Existing direct-SDK legacy exceptions are
  not patterns to copy or unrelated refactor mandates.
- Use SQLAlchemy's parameter binding for values. User-selected sort/filter fields
  require a server-owned allowlist; never interpolate arbitrary input into SQL.
- Keep sync/async boundaries explicit. Do not block an async route with unbounded
  file, network, model, or subprocess work.

## Auth, Sessions, RLS, and Audit

- Protected domain queries use `get_db_with_rls` from `auth.py`. It explicitly
  depends on `get_current_wims_user`; do not reintroduce request-state or route
  parameter-order coupling.
- `get_db()` uses the admin URL for the authentication/bootstrap chicken-and-egg
  path. Do not use or extend it for protected domain reads/writes merely to bypass
  RLS.
- `SET LOCAL wims.current_user_id` is transaction-scoped. After a mid-operation
  `commit()` or `rollback()`, re-establish RLS context before another protected
  query in the new transaction.
- Test setup that must bypass RLS may seed through `_AdminSessionLocal`; request
  execution should use the same scoped dependency/session path as production.
- Background work must choose an explicit identity/context (`get_session(user_id)`
  or the established system task account) rather than relying on an unset GUC.
- Server-side role dependencies are the authorization boundary. UI role checks,
  request payload roles, or Keycloak presentation state are not substitutes.
- System audit and verification history are required append-only records. Verify
  UPDATE/DELETE enforcement against the final migrated schema (especially after a
  table replacement or partition migration) instead of assuming an earlier rule
  remains. Use the shared audit utility and established transaction behavior;
  never update/delete audit rows to make tests pass.

## PII, Files, and Spatial Data

- Use the current crypto-provider dispatch under `services/kms/` and the established
  `utils/crypto.py`/service-specific AAD format. Do not instantiate a new provider,
  invent AAD, or write a plaintext fallback without an approved migration design.
- Keep encrypted blob, provider, nonce/key-version, and plaintext-nullability
  invariants aligned on every write and read path.
- File/photo changes must preserve MIME/magic-byte/size validation, path isolation,
  encryption, metadata sanitization, transactional audit, and cleanup/reconciliation.
- Use PostGIS geography/geometry functions for persisted coordinates, distance,
  containment, and consensus. Preserve explicit geography-to-geometry casts where
  required.

## Schema Changes

Follow `src/AGENTS.md` for the dual Alembic/clean-bootstrap contract. In particular:

- add a new Alembic revision for existing databases;
- keep clean bootstrap SQL aligned when required;
- include grants, RLS, audit/immutability, PostGIS, and service-account effects;
- test fresh and upgrade paths on disposable databases;
- do not use startup self-heal or an old SQL edit as the only upgrade mechanism.

## Tests and Validation

Python support is 3.10+; main CI currently exercises Python 3.12 while Ruff targets
`py310`. Follow `pyproject.toml`: 4-space indentation, double quotes, 100-character
formatter line length, and Ruff's configured rule set. Do not add unrelated import
or formatting churn.

Run from `src/backend/`:

```bash
# Fast targeted loop
ruff check path/to/changed.py path/to/test_changed.py
ruff format --check path/to/changed.py path/to/test_changed.py
pytest path/to/test_changed.py -q

# Backend default suite
ruff check .
ruff format --check .
pytest -v --tb=short
```

Important test semantics:

- `pytest.ini` contains default `--ignore` entries for infrastructure-heavy suites;
  a green default `pytest` run is not evidence those suites passed.
- Read markers and fixtures before classifying a test as unit/integration. Database,
  Redis, Keycloak, OpenBao, Suricata, or Docker tests may require the Compose stack
  or an explicit `-o addopts=...` invocation.
- When auth/RLS dependencies are overridden, preserve the full dependency graph;
  seed with the admin session only where setup requires it and execute the request
  with a non-superuser/RLS-scoped session when policy enforcement is under test.
- A UUID/string fixture mismatch and lost `SET LOCAL` context after commit are
  common failures, but diagnose with evidence rather than applying a canned fix.

Before a push/PR, run the exact backend, migration, Docker, and relevant security
checks described by `.github/workflows/ci.yml` and `docs/agents/ci-preflight.md`.
Report every intentionally excluded or unavailable suite.
