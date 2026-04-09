# WIMS-BFP System Architecture

## Stack Summary

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | Next.js 16, React 19, TypeScript, TailwindCSS 4 | `src/frontend/package.json`, `src/frontend/src/app/` |
| Backend | FastAPI + SQLAlchemy | `src/backend/main.py`, `src/backend/api/routes/` |
| Queue/Async | Celery + Redis | `src/backend/main.py`, `src/docker-compose.yml` |
| Database | PostgreSQL 15 + PostGIS 3.4 | `src/docker-compose.yml`, `src/postgres-init/` |
| Identity/Auth | Keycloak 24 with JWT/OIDC | `src/docker-compose.yml`, `src/backend/auth.py`, `src/backend/main.py` |
| AI/XAI | Ollama service, used by backend admin analysis path | `src/docker-compose.yml`, `src/backend/services/ai_service.py`, `src/backend/api/routes/admin.py` |
| IDS/Telemetry | Suricata + security log ingestion | `src/docker-compose.yml`, `src/backend/tasks/suricata.py` |
| Edge Gateway | Nginx | `src/docker-compose.yml`, `src/nginx/` |

> Constitution alignment: authentication is implemented around Keycloak, not Supabase auth.

## Key Directories

| Path | Role |
|---|---|
| `src/backend/` | FastAPI app entry (`main.py`), auth dependencies, SQLAlchemy access, Celery task registration. |
| `src/backend/api/routes/` | HTTP route modules for incidents, admin, civilian reporting, triage, analytics, regional, and reference endpoints. |
| `src/frontend/src/app/` | Next.js App Router pages, including dashboards, incident flows, public report, and auth callback. |
| `src/frontend/src/app/api/auth/` | Next route handlers for session, token sync cookie set, and logout cookie clear. |
| `src/postgres-init/` | DB bootstrap SQL (`01_wims_initial.sql`, thin `02_wims_schema.sql`, seeds). |
| `src/keycloak/` | Realm import JSON used by Keycloak container startup. |
| `src/suricata/` | IDS rules and runtime logs mount path. |

## Runtime Service Topology

All compose services run on `wims_internal`:

- `postgres`: primary relational and geospatial store; mounts init SQL.
- `redis`: cache/broker for rate limiting and Celery.
- `keycloak`: identity provider and realm host.
- `ollama`: local model runtime for security narrative generation.
- `backend`: FastAPI service exposing `/api/*` endpoints.
- `celery-worker`: async worker and beat scheduler.
- `frontend`: Next.js app.
- `wims-suricata`: IDS sensor with EVE output.
- `nginx-gateway`: edge reverse proxy exposing ports 80/443.

## High-Level Data Flow

The current repository shows a civilian-to-triage-to-incident pipeline:

1. Public submissions enter via `POST /api/civilian/reports` into `wims.citizen_reports` with pending status.
2. Triage users (`ENCODER`/`VALIDATOR`) review `GET /api/triage/pending` and promote with `POST /api/triage/{report_id}/promote`.
3. Promotion creates official records in `wims.fire_incidents` and links back to the civilian report.
4. Regional encoders import official AFOR workbooks via `POST /api/regional/afor/import` and commit via `POST /api/regional/afor/commit`. The backend classifies uploads as **structural** (standard AFOR cell map) or **wildland** (wildland sheet markers / sheet name); wildland commits persist to `wims.incident_wildland_afor` (and related child rows where used), with `source` distinguishing file import vs manual entry.
5. Analyst flows read incident data through `/api/analytics/*` (and regional users through `/api/regional/*` for listings and stats).
6. System-admin security workflows read/update threat logs and optional AI narratives through `/api/admin/security-logs*`.

This aligns with glossary terms: civilian intake, validator-centered verification, and sovereign-core processing boundaries.

## Auth and Access Control

- Frontend callback flow uses `oidc-client-ts` and then `POST /api/auth/sync` to persist `access_token` as an HttpOnly cookie.
- Backend protects role-sensitive paths via dependency guards (`get_current_wims_user`, `get_system_admin`, `get_analyst_or_admin`, `get_regional_encoder`).
- Role-sensitive examples:
  - Admin hub endpoints under `/api/admin/*` require `SYSTEM_ADMIN`.
  - Analyst endpoints under `/api/analytics/*` require analyst/admin guard.
  - Regional endpoints under `/api/regional/*` require regional encoder context.

## Security-Relevant Mechanics

- Login rate limiting is implemented in backend middleware for `POST /api/auth/login` using a Redis Lua sliding-window script.
- Suricata logs are mounted into worker-accessible paths and ingested by task modules.
- No hard-delete admin endpoint is defined in admin route modules; updates are mutation-oriented (user/log state updates and audit readout).
- PII fields (`caller_name`, `caller_number`, `owner_name`, `street_address`) are encrypted at rest using AES-256-GCM via `utils/crypto.py`. Plaintext PII columns are always `NULL` for new writes.

## Database Session Management

`database.py` uses eager initialization — `_engine` and `_SessionLocal` are created at module import time (not lazily). Two FastAPI dependency functions are exposed:

| Function | RLS Context | Use Case |
|---|---|---|
| `get_db()` | No | Bare session for tests and routes where RLS is not needed |
| `get_db_with_rls(request)` | Yes (via `SET LOCAL wims.current_user_id`) | Routes where `get_current_wims_user` has already resolved the user |

**Dependency ordering:** `get_current_wims_user` must be listed BEFORE `get_db_with_rls` in route dependency lists so `request.state.wims_user` is populated before RLS context is set.
