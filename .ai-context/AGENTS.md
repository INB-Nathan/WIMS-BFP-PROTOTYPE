# Rules of Engagement for Future Agents

## 1) Mission and Constraints
- Preserve the WIMS-BFP hybrid architecture: Next.js PWA frontend, FastAPI backend, PostgreSQL/PostGIS, Keycloak auth, Celery/Redis async jobs.
- **NO SUPABASE:** Do not write Supabase Edge Functions or use the Supabase JS Client. All backend logic belongs in FastAPI or Celery.
- **Sovereign Trust:** AI operations (Qwen2.5-3B) must run locally via Ollama. Do not integrate OpenAI or any external SaaS APIs.

## 2) Where Code Goes
- **Frontend Pages/Routes**: `src/frontend/src/app`.
- **Frontend Offline Storage**: `src/frontend/src/lib/db.ts` (Dexie.js logic).
- **Backend HTTP Endpoints**: `src/backend/api/routes` (Keep handlers thin).
- **Backend Business Logic & Cryptography**: `src/backend/services` (AES-256-GCM logic).
- **Background Async Work**: `src/backend/tasks` (Celery workers for AI and Log parsing).
- **Database Initialization**: `src/postgres-init/01_wims_initial.sql` (canonical); archived superseded SQL under `archive/sql/`.

## 3) API and Auth Rules
- Every protected route MUST use auth dependencies from `src/backend/auth.py` validating Keycloak JWTs.
- Use EXACT WIMS-BFP role names: `REGIONAL_ENCODER`, `NATIONAL_VALIDATOR`, `NATIONAL_ANALYST`, `SYSTEM_ADMIN`.
- The `NATIONAL_VALIDATOR` is the ONLY role permitted to write to the `is_verified` state.
- Public endpoint exception: Civilian report submission (`/api/civilian/reports`) remains unauthenticated by design.

## 4) Data and Geospatial Rules
- Use `GEOGRAPHY(POINT, 4326)` semantics for all incident and report locations in PostGIS.
- **No Hard Deletes:** Data is never destroyed. Implement soft-deletes (`deleted_at` timestamp).

## 5) Async and Performance Rules
- Any process taking > 500ms (PostGIS spatial aggregation, parsing large offline bundles, XAI inference) MUST be routed to a Celery task.
- AI operations are STRICTLY explainable diagnostics. The AI cannot block IPs, execute code, or perform automated database mutations.

## 6) Frontend Conventions
- Utilize the Next.js App Router and existing UI components (`LayoutShell`, Leaflet map pickers).
- Always wrap mutations in offline-first checks: If `navigator.onLine` is false, write to Dexie.js instead of calling `apiFetch`.

## 7) Testing and Validation
- Backend: Run `pytest` in `src/backend` testing Keycloak RBAC failures and PostGIS bounds.
- Frontend: Run tests in `src/frontend` verifying Dexie.js offline behavior.
- Ensure Red-Green TDD is strictly followed as per the `.mdc` constraints.

## 8) Documentation Discipline
- Keep `constitution.md`, `glossary.md`, and `architectureoverview.md` aligned with code changes.
- Update `.ai-context` files if dependencies change.

## Cursor Cloud specific instructions

### Service overview

The application runs as a Docker Compose stack from `src/docker-compose.yml`. Core services: **postgres** (PostGIS), **redis**, **keycloak**, **backend** (FastAPI/uvicorn), **celery-worker**, **frontend** (Next.js), **nginx-gateway** (reverse proxy on port 80). Optional: **ollama** (AI), **wims-suricata** (IDS).

### Starting the stack

```bash
cd src && docker compose up --build -d
```

A `docker-compose.override.yml` is provided in `src/` to stub out Ollama and Suricata (both optional) and remove cgroup resource limits that fail in Cloud Agent VMs. The override also removes the backend's dependency on Ollama. Do not delete this file.

### Cgroup / resource-limit caveat

Docker containers with `deploy.resources.limits` (CPU/memory) will fail with a cgroup error in the Cloud Agent VM. The override file uses `!reset` YAML tags to clear these. If adding new services with resource limits, add corresponding `!reset` entries in the override.

### Lint, test, and build commands

See `README.md` for canonical commands. Quick reference:
- **Frontend lint**: `cd src/frontend && npm run lint` (pre-existing lint errors exist — 102 errors, mostly `@typescript-eslint/no-explicit-any`)
- **Frontend tests**: `cd src/frontend && npx vitest run` (some theme-audit tests fail pre-existing; set `NEXT_PUBLIC_BASE_URL=http://localhost` for login tests)
- **Backend tests**: `cd src/backend && source .venv/bin/activate && pytest -v --ignore=tests/test_fire_incident_location.py` (55 pass, 33 errors from integration tests needing Redis/Postgres; `test_fire_incident_location.py` has a broken import `from backend.models...` — skip it)
- **Frontend build**: `cd src/frontend && npm run build`

### Local development (outside Docker)

- **Node.js 20** via nvm: `source ~/.nvm/nvm.sh && nvm use 20`
- **Python 3.11** venv: `source src/backend/.venv/bin/activate`
- Frontend deps: `cd src/frontend && npm ci`
- Backend deps: `cd src/backend && pip install -r requirements.txt`

### Access URLs (when Docker stack is running)

- Frontend: http://localhost
- Keycloak admin: http://localhost/auth (admin / admin)
- Backend API: http://localhost/api
- Public endpoint (no auth): `POST /api/civilian/reports` with JSON `{latitude, longitude, description}`