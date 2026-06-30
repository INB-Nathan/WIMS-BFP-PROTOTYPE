---
description: Run the 5-gate CI pre-flight (lint, format, pytest, frontend checks, SQL migrations) before pushing or opening a PR.
---

# CI Pre-flight

Use this skill when the agent considers pushing, committing, rebasing, or opening a PR on this repo. Runs the 5-gate CI pre-flight before any push.

## Steps

1. **Gate 1 — Backend ruff lint**: `cd src/backend && ruff check .` — fix any F401/F821/E711/W291/W293/E302/E303 until exit 0.

2. **Gate 2 — Backend ruff format**: `cd src/backend && ruff format --check .` — auto-fix with `ruff format .` if it fails, then re-check.

3. **Gate 3 — Backend pytest**: `cd src/backend && pytest -v --tb=short` (pytest.ini already has the CI ignore list in `addopts`). Watch for:
   - UUID→str conversion in fixture overrides
   - RLS context reset after `db.commit()` — re-call `set_rls_context(db, user_id)`
   - Fixtures using `_SessionLocal` instead of `_AdminSessionLocal` for seed data

4. **Gate 4 — Frontend**: `cd src/frontend && npm run lint && npx vitest run && npm run build`. Build env vars: `NEXT_PUBLIC_AUTH_API_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_BASE_URL` (safe dummy values work locally).

5. **Gate 5 — SQL migrations** (if `.sql` files were added/changed): replay all `src/postgres-init/*.sql` in lexical order with `ON_ERROR_STOP=1` against a throwaway Postgres.

6. Only after all 5 gates pass: `git status`, `git add <specific files>`, `git commit`, `git push`.
