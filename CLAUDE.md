# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, Test, and Development Commands

```bash
# Full stack — clean-slate init (wipe volumes, fresh build, cold start)
cd src && docker compose down -v
cd src && docker compose build --no-cache
cd src && docker compose up -d

# Full stack — restart (preserves data volumes)
cd src && docker compose down
cd src && docker compose up --build -d

# Backend
cd src/backend && pytest -v
cd src/backend && ruff check .

# Frontend
cd src/frontend && npm run dev
cd src/frontend && npx vitest run
cd src/frontend && npm run lint

# Local CI simulation
make ci-local

# Format
make format
```

> **Clean-slate init:** First boot runs all 74 SQL bootstrap files in `postgres-init/` and imports the Keycloak realm. Subsequent boots skip both. Use `down -v` when you want a fully fresh database (schema + seed data + Keycloak users).

## Architecture

WIMS-BFP is a Dockerized full-stack incident management system for the Philippine Bureau of Fire Protection.

```
src/
├── backend/                # FastAPI + Celery (Python 3.10+)
│   ├── api/routes/         # incidents, analytics, triage, regional, admin, civilian
│   ├── models/             # SQLAlchemy ORM models
│   ├── schemas/            # Pydantic request/response schemas
│   ├── services/           # AI/XAI, analytics, duplicate detection
│   ├── tasks/              # Celery tasks (Suricata, exports, drafts)
│   └── utils/              # crypto (AES-256-GCM), session revocation, audit
├── frontend/               # Next.js 16 (App Router), React 19, TypeScript, TailwindCSS 4
├── postgres-init/          # 74 SQL bootstrap files — see system-wiki/database/sql-init-files.md
├── keycloak/               # Realm import JSON (bfp-realm.json)
├── openbao/                # OpenBao init/bootstrap for KMS
├── suricata/               # Suricata IDS rules/log mounts
├── nginx/                  # Nginx edge gateway config
├── docker-compose.yml      # 14 services: postgres, redis, mailhog, keycloak,
│                           # keycloak-bootstrap, openbao, openbao-bootstrap,
│                           # ollama, ollama-model-pull, backend, celery-worker,
│                           # frontend, wims-suricata, nginx-gateway
└── docker-compose.override.yml / docker-compose.ci.yml / docker-compose.prod.yml
```

## Key Patterns

### Auth and RLS

Keycloak JWT tokens carry WIMS roles. Backend auth (`auth.py`) extracts roles from `realm_access.roles` or `resource_access.<client>.roles` using the precedence order: `CIVILIAN_REPORTER` → `REGIONAL_ENCODER` → `NATIONAL_VALIDATOR` → `NATIONAL_ANALYST` → `SYSTEM_ADMIN`.

**Row Level Security** uses a PostgreSQL GUC `wims.current_user_id` set via `SET LOCAL wims.current_user_id` at the start of each transaction. The `database.py` `set_rls_context()` function applies this. All `wims.*` tables have RLS policies bound to this GUC.

Dependency order matters: `get_current_wims_user` must be listed **before** `get_db_with_rls` in route signatures so `request.state.wims_user` is populated before RLS context is set.

**Session revocation** is implemented in `utils/session.py` via Redis. When a user is deactivated, their `keycloak_id` + revocation timestamp is stored in Redis. Every request through `auth.py` checks this blacklist to instantly reject revoked JWTs.

### PII Encryption

PII fields (`caller_name`, `caller_number`, `owner_name`, `occupant_name`) in `wims.incident_sensitive_details` are encrypted at rest with AES-256-GCM via `utils/crypto.py`. Plaintext columns are always `NULL` for new writes. The key comes from `WIMS_MASTER_KEY` env var. Decryption failures log a `CRITICAL` event and fall back to legacy plaintext columns (fail-closed).

### Incident Pipeline

Two parallel intake paths feed official AFOR incidents:

**Public DMZ (zero-trust, unauthenticated):**  
`POST /api/v1/public/report` → `wims.fire_incidents` (direct). Used for zero-trust submissions from anonymous reporters.

**Civilian staging:**  
1. `POST /api/civilian/reports` → `wims.citizen_reports` (pending, structured staging)
2. `GET /api/triage/pending` → validator reviews → `POST /api/triage/{id}/promote`
3. Promotion creates official record in `wims.fire_incidents`
4. Regional encoders import AFOR workbooks via `POST /api/regional/afor/import` → `POST /api/regional/afor/commit` (structural or wildland)
5. Analysts read via `/api/analytics/*`

### Keycloak Configuration

Keycloak uses `--import-realm` with `IGNORE_EXISTING` strategy. Once the realm exists, the JSON is NOT re-imported. Users are created in Keycloak but NOT synced to PostgreSQL — run `scripts/seed-dev-users.sh` after first boot.

Two issuer URLs exist: backend fetches JWKS from `keycloak:8080` (Docker internal) but validates tokens against `localhost` (browser-visible, set via `KC_HOSTNAME=localhost`).

### AI/XAI Pipeline

Suricata IDS → EVE JSON → Celery worker → FastAPI extracts metadata → prompt template → Ollama (Qwen2.5-3B) → narrative → `security_threat_logs`. The SLM is a translator (JSON → plain English), not a threat detector. Suricata rules carry the security knowledge.

### Offline/PWA

The frontend supports offline-first operation for encoders, validators, analysts, and admin. Key modules:
- `src/frontend/src/lib/offlineStore.ts` — IndexedDB layer with stores for `offlineOps`, `cachedIncidents`, `analytics-cache`, per-user key isolation, and legacy `incident-queue` compat (DB_VERSION 4).
- `src/frontend/src/lib/syncEngine.ts` — Dispatches pending ops on connectivity restore; dual-path for both `offlineOps` (PR #271) and legacy `incident-queue` (PR #272).
- `src/frontend/src/lib/connectivity.ts` — Singleton monitor with exponential backoff recheck loop.
- `src/frontend/src/lib/api/offline*.ts` — Offline-aware read wrappers for analytics, regional, validator, and admin.
- Public manifest at `src/frontend/public/manifest.webmanifest`.

See `system-wiki/architecture/pwa-tests-cicd.md` and `docs/PR-offline-first-encoder.md`.

## Agent Routing

Before non-trivial changes, read the relevant subsystem page:
- Auth/RBAC/RLS → `system-wiki/security/security-baseline.md`
- Incident workflow → `system-wiki/operations/agent-routing-guide.md`
- Analytics → `system-wiki/subsystems/regional-dashboard.md`
- Database schema → `system-wiki/database/schema-overview.md`
- Offline/PWA → `system-wiki/architecture/pwa-tests-cicd.md`

The `system-wiki/` directory is the authoritative agent-routing knowledgebase. Raw FRS files live in `system-wiki/raw/frs/`.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `x1n4te/WIMS-BFP-PROTOTYPE` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical triage labels are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-repo context: use `AGENTS.md`, `CLAUDE.md`, and `system-wiki/` for domain and architecture context. See `docs/agents/domain.md`.

## Testing

Backend pytest discovery: `testpaths = tests` in `pytest.ini`. Integration tests under `src/backend/tests/integration/`. Frontend tests use Vitest + React Testing Library + jsdom. Run `make ci-local` before opening a PR.

## Key Environment Variables

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | backend, celery | PostgreSQL connection |
| `DATABASE_ADMIN_URL` | backend | Postgres superuser for DDL patches |
| `KEYCLOAK_REALM_URL` | backend | Keycloak JWKS endpoint (Docker internal) |
| `KEYCLOAK_ISSUER` | backend | JWT `iss` validation (browser-visible) |
| `WIMS_MASTER_KEY` | backend | AES-256-GCM encryption key for PII |
| `REDIS_URL` | backend, celery | Rate limiting + Celery broker + session blacklist |
| `OLLAMA_URL` | backend | Local LLM for XAI narratives |
| `NEXT_PUBLIC_API_URL` | frontend | Backend API base URL |
| `NEXT_PUBLIC_AUTH_API_URL` | frontend | Keycloak auth URL (required; build fails if unset) |
| `NEXT_PUBLIC_BASE_URL` | frontend | Public base URL (required; build fails if unset) |

> Frontend build requires `NEXT_PUBLIC_AUTH_API_URL` and `NEXT_PUBLIC_BASE_URL`. Safe dummy values: `NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth` `NEXT_PUBLIC_BASE_URL=http://localhost:3000`.
