# Changelog

All notable changes to the WIMS-BFP project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Documentation:** `README.md` — “Rebuilding Docker containers” with `docker compose build --no-cache` / `docker compose up -d` and the shorter `docker compose up --build -d` variant.
- **Schema docs:** `SCHEMA_MERGE_NOTES.md` — canonical WIMS bootstrap, wildland AFOR mapping, archive pointer.
- **Archive:** `archive/sql/CONSOLIDATED_UNUSED_SQL.sql` + `archive/sql/README.md` — superseded SQL (legacy migrations, seeds, stubs) consolidated for history only.
- **Testing:** `src/backend/tests/integration/test_wims_initial_schema_bootstrap.py` — disposable-DB bootstrap check (requires `psql`, optional when DB unavailable).
- Pre-push documentation audit pass:
  - `docs/ARCHITECTURE.md` refreshed with source-grounded stack, services, and flow details.
  - `docs/API_AND_FUNCTIONS.md` refreshed with verified backend routes, edge functions, frontend routes, and Next route handlers.
  - `README.md` tightened to keep documentation links and setup guidance aligned with current repository structure.

### Changed
- **Database bootstrap:** Single canonical DDL at `src/postgres-init/01_wims_initial.sql`; thin idempotent `\ir` in `02_wims_schema.sql`; reference seed in `03_seed_reference.sql`.
- **Docker (backend):** `postgresql-client` in the backend image; read-only mount `./postgres-init:/app/postgres-init` for integration tests.
- `.cursor/prompts/pre-push-audit-and-docs.prompt.md` was rewritten to enforce deterministic audit phases, strict write scope, and source-evidence-only documentation updates.

### Removed
- **`src/supabase/`** — Deno edge functions and leftover Supabase-oriented SQL paths removed; stack uses Keycloak + FastAPI + Postgres only. DB thin re-include is `src/postgres-init/02_wims_schema.sql`; Docker no longer bind-mounts a separate `schema_v2.sql`.
- **`src/get-tokens.mjs`** — Supabase auth helper script removed.
- Redundant virtualenv folders (`.venv`) and obsolete standalone SQL (previously under `supabase/migrations/`, `supabase/seeds/`, legacy `wims_schema.sql`, no-op postgres-init stubs) — superseded by archive + `01_wims_initial.sql`.

## [0.1.0] — 2026-03-14

### Added
- **Infrastructure:** Full Docker Compose orchestration with PostgreSQL/PostGIS, Redis, Keycloak, Ollama, Nginx gateway, Suricata IDS, Celery worker (`00657fe`, `13104b3`)
- **Authentication:** Complete OIDC PKCE flow via Keycloak; purged all legacy Supabase auth references; secured route contexts with role-based access (`e9d9a8a`)
- **Backend API:**
  - `POST /api/auth/callback` — Keycloak PKCE token exchange with user upsert
  - `GET /api/user/me` — JWT-protected user profile with JIT provisioning
  - `POST /api/incidents` — geospatial fire incident creation
  - `POST /api/civilian/reports` — public emergency report submission (no auth)
  - `GET /api/triage/pending` — pending citizen report queue
  - `POST /api/triage/{report_id}/promote` — promote citizen report to official incident
  - `GET/PATCH /api/admin/users` — user management (SYSTEM_ADMIN)
  - `GET/PATCH/POST /api/admin/security-logs` — threat log management with AI analysis
  - `GET /api/admin/audit-logs` — paginated audit trail
  - Rate-limiting middleware on `POST /api/auth/login` (Redis sliding window)
- **Supabase Edge Functions:** `analytics-summary`, `commit-incident`, `conflict-detection`, `security-event-action`, `upload-bundle`
- **Frontend pages:** Dashboard, incidents list/create/import/triage, incident detail with conflict detection, public report form, admin system hub, operations center (`/home`)
- **Database schema:** `wims` schema with PostGIS geography columns, soft-delete support, chain-of-custody audit trails, geographic reference tables (regions/provinces/cities/barangays)
- **Celery beat task:** Suricata EVE log ingestion every 10 seconds
- **Tests:** Adversarial integration suite for schema validation, infrastructure config tests (`9855eda`–`613e179`)

### Fixed
- Dark mode contrast classes on Threat Telemetry View modal in admin panel (`b8b33a0`)

### Security
- `.gitignore` rules for `.env`, `*.pem`, `*.key`, credential files (`1916a9b`)
- Untracked ignored files, caches, and runtime logs (`2817965`)

## [0.2.0] — 2026-03-17

### Added
- **UI/UX:** Complete transition to the CoreUI-inspired charcoal/white theme across the entire application.
- **UI/UX:** Updated login screen with modern split-screen layout.
- **UI/UX:** Dashboard summary cards and accordion drill-downs with server-side pagination.
- **Backend/Parser:** Implementation of the coordinate-mapped (`CELL_MAP`) XLSX parser for official AFOR templates (Sections A-L).
- **Backend/Parser:** Strict PostgreSQL `CHECK` constraint normalization via `ALARM_LEVEL_MAP` for consistent alarm level labels.
- **Frontend Features:** Automated pre-filling of `IncidentForm` via `sessionStorage` handoff from the AFOR Import review table.
- **Frontend Features:** PWA offline `Base64` sketch upload with two-step background synchronization.
- **Auth & Identity:** Automated user and role provisioning script (`setup_roles_and_users.ps1`) for Keycloak and PostgreSQL synchronization.

### Changed
- **AFOR Import:** Refactored the Import page preview table to use the new `sessionStorage` review flow.
- **Auth & Identity:** Fixed Keycloak silent relogin bug by implementing `signoutRedirect()` in the `AuthContext`.
- **Infrastructure:** Increased Nginx `client_max_body_size` to 50MB for supporting large AFOR templates and attachments.
- **DevOps:** Fixed Next.js Docker `.next/cache` `EACCES` permission error in the build pipeline.
- `.gitignore` — added `src/suricata/logs/` to prevent runtime log tracking.

### Removed
- **Dead Code:** Eliminated obsolete generic tabular editing UI and old review modals from the `incidents/import` and `afor/import` pages.

### Fixed
- **Cleanup:** Removed 19 tracked `__pycache__/*.pyc` files and `src/suricata/logs/eve.json` from the git index.