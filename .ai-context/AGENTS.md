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