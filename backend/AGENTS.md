# backend Agent Instructions

## Read First

- `backend/api/routes/` — route definitions per domain
- `backend/services/` — business logic
- `backend/schemas/` — Pydantic request/response contracts
- `backend/models/` — SQLAlchemy ORM models
- `backend/tests/` — pytest tests

Architecture references:
- `system-wiki/backend/api-route-map.md` — FastAPI route ownership
- `system-wiki/database/schema-overview.md` — table/migration map
- `system-wiki/security/security-baseline.md` — auth/RBAC/RLS

## Backend Rules

- **Routes stay thin.** Parse request body/params, call a service method, return response. No business logic in route handlers.
- **Services contain business logic.** Every non-trivial operation lives in `backend/services/`. Services are stateless (or take an explicit DB session).
- **Schemas define contracts.** Pydantic schemas in `backend/schemas/` are the source of truth for request/response shapes. Routes and services type-check against them.
- **No direct DB access from routes.** Use SQLAlchemy models through services. Never write raw SQL in a route handler.
- **RLS context must be set before queries.** `set_rls_context(db, user_id)` in `database.py` must be called after every `db.commit()` mid-handler.
- **Dependency order matters.** `get_current_wims_user` before `get_db_with_rls` in route signatures — `request.state.wims_user` must be populated before RLS context is set.
- **Admin session for test seeding.** Use `_AdminSessionLocal` (admin DB URL, bypasses RLS) when seeding test data, not `_SessionLocal`.
- **Run `ruff format .` before committing.** The single most common CI blocker on this repo.

## CI Gates

| Gate | Command |
|------|---------|
| 1 — Lint | `ruff check .` (exit 0) |
| 2 — Format | `ruff format --check .` (auto-fix: `ruff format .`) |
| 3 — Tests | `pytest -v --tb=short` (from `src/backend/`) |

## Common Test Failure Patterns

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| `'UUID' object has no attribute 'replace'` | UUID passed where string expected | `str()` UUID values in fixture overrides |
| Queries return 0 rows after `db.commit()` | RLS context reset on commit | Call `set_rls_context(db, user_id)` again after each `db.commit()` |
| INSERT succeeds but rows invisible | Fixture used `_SessionLocal` instead of `_AdminSessionLocal` | Use `_AdminSessionLocal` (admin URL, bypasses RLS) |
| `ModuleNotFoundError: No module named 'auth'` | pytest run outside `src/backend/` | Always run pytest from `src/backend/` |

Full CI pre-flight (gates 1-5): `docs/agents/ci-preflight.md`

## Python Conventions

- Python 3.10+, 4-space indent, double quotes
- `snake_case` for functions, modules, variables
- Typed FastAPI route signatures where practical
- Routes grouped by domain under `api/routes/`
- No broad formatting churn
