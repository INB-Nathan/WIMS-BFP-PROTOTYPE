# Coding Standards & Conventions

## Project Structure

This repository is a Dockerized WIMS-BFP full-stack prototype. Primary implementation lives in `src/`:

| Path | Purpose |
|------|---------|
| `src/backend/` | FastAPI API, Celery tasks, models, schemas, pytest tests |
| `src/frontend/` | Next.js App Router, React components, client libs, public assets, Vitest tests |
| `src/postgres-init/` | Database bootstrap SQL (lexical order, `ON_ERROR_STOP=1`) |
| `src/keycloak/` | Keycloak realm imports and custom providers |
| `src/nginx/` | Nginx gateway config |
| `src/suricata/` | Suricata rules/log mounts |
| `docs/` | Project notes and documentation |
| `scripts/` | Seed and utility scripts |
| `system-wiki/` | Project-local agent knowledgebase |

## Python (Backend)

- **Python 3.10+** style
- **4-space indentation**, double quotes
- Typed FastAPI route signatures where practical
- `snake_case` for functions, modules, variables
- Explicit Pydantic schemas in `schemas/`
- Routes grouped by domain under `src/backend/api/routes/`
- Run `ruff format .` before committing — the single most common CI blocker

## TypeScript/React (Frontend)

- `PascalCase` for components and files
- `camelCase` for functions and variables
- Colocate tests beside code (`Component.test.tsx`)
- Follow existing ESLint and Next.js conventions
- Avoid broad formatting churn

## Testing Guidelines

**Backend:**
- Pytest discovery configured in `src/backend/pytest.ini` with `testpaths = tests`
- Name files `test_*.py`
- Integration-heavy cases under `src/backend/tests/integration/`
- Always run from `src/backend/` (pytest.ini uses relative `pythonpath = .`)

**Frontend:**
- Vitest, React Testing Library, jsdom
- Name files `*.test.ts` or `*.test.tsx`

**Before opening a PR:** Run relevant tests for the areas you changed.

## Commit & Pull Request Guidelines

- Conventional Commit-style subjects, scoped when useful:
  - `feat(#46): add incident validation endpoint`
  - `fix(auth): handle expired token refresh`
  - `style: fix trailing whitespace`
- PRs include: problem/solution summary, linked issues, test results, screenshots for UI changes
- Call out schema, auth, environment, or data-volume impacts explicitly
- Never commit real secrets; Docker Compose values are development defaults only

## Infrastructure

The Docker stack runs **14 services**:
postgres, redis, mailhog, keycloak, keycloak-bootstrap, openbao, openbao-bootstrap, ollama, ollama-model-pull, backend, celery-worker, frontend, wims-suricata, nginx-gateway

**Offline/PWA subsystem:** The frontend has a full offline-first stack with IndexedDB stores (`offlineOps`, `cachedIncidents`, `analytics-cache`), singleton connectivity monitor, dual-path sync engine (PR #271 offlineOps + PR #272 legacy incident-queue), per-user key isolation, and offline-aware API wrappers for all roles. See `system-wiki/architecture/pwa-tests-cicd.md`.

## Build, Test & Development Commands

| Action | Command |
|--------|---------|
| Full stack up | `cd src && docker compose up --build` |
| Full stack down | `cd src && docker compose down` |
| Backend tests | `cd src/backend && pytest -v` |
| Frontend dev server | `cd src/frontend && npm run dev` |
| Frontend production build | `cd src/frontend && npm run build` |
| Frontend lint | `cd src/frontend && npm run lint` |
| Frontend tests | `cd src/frontend && npx vitest run` |

**Frontend deps:** `npm ci` (prefer when `package-lock.json` exists) or `npm install`.

**Backend non-Docker:** Install `src/backend/requirements.txt` in a Python 3.10+ virtual environment.

**Frontend build env vars** (safe dummy values):
```bash
export NEXT_PUBLIC_AUTH_API_URL="http://localhost:8080/auth"
export NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

Full CI pre-flight with gates 1-5: `docs/agents/ci-preflight.md`
