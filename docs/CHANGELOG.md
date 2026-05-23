# Changelog

All notable changes to the WIMS-BFP project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] — 2026-05-02

### Added
- **Security & Audit:** Implemented a centralized **System Audit Logging** utility in the backend, integrated into Triage, Incident Verification, and User Management workflows.
- **Security:** Added **Instant Session Revocation** via Redis. Force Logout now immediately invalidates active JWTs across the system.
- **Admin Hub:** New **System Health Dashboard** featuring real-time connectivity and latency monitoring for Database, Redis, and Keycloak.
- **Admin Hub:** New **Active Session Viewer** allowing administrators to monitor and terminate suspicious sessions in real-time.
- **Civilian Features:** **Public Report Status Tracker** (/report/track) allowing citizens to securely track reports without authentication.
- **Triage Workflow:** Implemented **Bulk Promotion** capability, allowing encoders to process multiple reports in a single batch transaction.

### Fixed
- **Audit UI:** Fixed frontend data mapping for Audit Logs (variable name mismatch between API and Table).
- **User Admin:** Standardized frontend roles (`CIVILIAN_REPORTER`, `REGIONAL_ENCODER`, etc.) to match strict backend validation.
- **Auth Flow:** Fixed "ghost maneuvering" by adding real-time token revocation checks in the backend middleware.

### Changed
- **Deactivation Logic:** Account deactivation now triggers both Keycloak disabling and immediate session purging for maximum security.
- **Auth Callback:** Refactored the authentication sync flow to include a backend-side session verification step.

## [Unreleased]

### Added
- **Session Management — list active sessions endpoint:** `GET /api/admin/sessions/{user_id}` returns all active Keycloak sessions for a given user (SYSTEM_ADMIN only). Accepts the internal WIMS `user_id` (UUID) and resolves the Keycloak UUID server-side so the raw Keycloak ID is never exposed to the client. Response includes IP address, session start time, and last access time. (`src/backend/api/routes/sessions.py`, `src/backend/services/keycloak_admin.py`)
- **Session Management — terminate sessions endpoint:** `DELETE /api/admin/sessions/{user_id}/{session_id}` revokes all active Keycloak sessions for a user (SYSTEM_ADMIN only). Note: python-keycloak does not expose a single-session revoke API; all sessions are terminated. (`src/backend/api/routes/sessions.py`)
- **Session Management — admin UI:** System Admin Hub now shows a live **Active Sessions** metric card (replacing the `—` placeholder), a **Sessions** column in the Identity Governance user table with a clickable session count badge, and a sessions detail modal displaying IP address and timestamps in Asia/Manila (PHT) timezone with a **Terminate All** button. (`src/frontend/src/app/admin/system/page.tsx`)
- **`logout_user_sessions(keycloak_id)`:** New helper in `keycloak_admin.py` that calls `adm.user_logout()` directly to revoke all active sessions without disabling the account. Used by the password change and role change backchannel logout flows. Errors are non-fatal (logged as warnings). (`src/backend/services/keycloak_admin.py`)
- **`get_user_sessions(keycloak_id)`:** New helper in `keycloak_admin.py` that returns the list of active Keycloak sessions for a user. Returns an empty list on error rather than propagating exceptions. (`src/backend/services/keycloak_admin.py`)
- **Frontend session API client:** `fetchUserSessions(userId)` and `terminateUserSessions(userId, sessionId)` added to `src/frontend/src/lib/api.ts` for SYSTEM_ADMIN session management flows.

### Changed
- **`ssoSessionMaxLifespan`:** Keycloak realm setting changed from 36000 s (10 h) to 28800 s (8 h) per FRS Task 1.D.3. Apply via Keycloak admin console (Realm Settings → Sessions → SSO Session Max) or re-import `src/keycloak/bfp-realm.json` on a fresh volume. (`src/keycloak/bfp-realm.json`)
- **`accessTokenLifespan`:** Keycloak access tokens remain short-lived at 300 s (5 min). The prior proposal to increase this to 3600 s (1 h) was rejected; the accepted fix is proactive refresh via `POST /api/auth/refresh` while the Keycloak/browser session remains valid. (`src/keycloak/bfp-realm.json`, `src/frontend/src/app/api/auth/refresh/route.ts`, `src/frontend/src/context/AuthContext.tsx`)
- **Proactive JWT refresh:** AuthProvider now refreshes the HttpOnly `access_token` cookie every 4 minutes, retries session loading once after a 401 by refreshing, and refreshes when the tab regains focus/visibility. This fixes premature `JWT Signature has expired` errors without broadening access-token lifetime. (`src/frontend/src/context/AuthContext.tsx`)
- **Cookie lifetime alignment:** `access_token` cookie `maxAge` is now 300 s to match the Keycloak access-token lifespan; `refresh_token` cookie `maxAge` is 28800 s to match the 8 h SSO session max. (`src/frontend/src/app/api/auth/sync/route.ts`, `src/frontend/src/app/api/auth/refresh/route.ts`)
- **Backchannel logout on password change:** `PATCH /api/user/me/password` now calls `logout_user_sessions()` after a successful password change, immediately revoking all active sessions on all devices. The frontend then calls `logout()` with a 1.5 s delay so the user sees a confirmation message before being redirected to login. (`src/backend/api/routes/user.py`, `src/frontend/src/app/profile/page.tsx`)
- **Backchannel logout on role change:** `PATCH /api/admin/users/{id}` now fetches the user's current role before applying the update and calls `logout_user_sessions()` when the role changes, ensuring stale JWT role claims are invalidated immediately. (`src/backend/api/routes/admin.py`)
- **Keycloak admin client — switched to master admin credentials:** `_get_admin_client()` now authenticates as the Keycloak master admin user (`KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD`) against the `master` realm instead of using the `wims-admin-service` service account client credentials. The service account approach produced persistent 403 errors on all admin operations (`set_user_password`, `user_logout`, `get_sessions`) regardless of assigned realm-management roles. (`src/backend/services/keycloak_admin.py`, `src/docker-compose.yml`)
- **Minimum password length — 8 → 12 characters:** Frontend validation in the profile password change form updated to match Keycloak's configured password policy (minimum length 12). Previously the frontend accepted 8-character passwords that Keycloak then rejected with `invalidPasswordMinLengthMessage`, returning a 502 to the user. (`src/frontend/src/app/profile/page.tsx`)
- **Sessions router registered:** `sessions.router` added to `src/backend/main.py` under the `/api/admin` prefix alongside the existing admin router. (`src/backend/main.py`)

### Security
- **Backchannel logout on security events (Task 1.D.4):** Password change and admin role change now both trigger immediate session revocation across all devices via Keycloak's user logout API. Users must re-authenticate after either event regardless of remaining session lifetime.
- **Session visibility and forced logout for admins (Task 1.D.5):** SYSTEM_ADMIN users can now view all active sessions per user (IP, start time, last access) and forcibly terminate them from the admin hub, providing a full session governance capability.

### Fixed
- **Bootstrap script execution order:** Renamed `002_validator_workflow.sql` → `05_validator_workflow.sql` and `002a_fix_ivh_legacy.sql` → `06_fix_ivh_legacy.sql`. Postgres init scripts execute in lexicographic order; numeric prefixes must align with logical dependencies (00 keycloak bootstrap, 01 schema DDL, 02 schema includes, 03 reference data, 04 indexes, 05+ migrations, 99 verification). Previous "002" prefix sorted before "01", causing FK constraint failures and "schema does not exist" errors on fresh initialization.
- **Encoder region assignment:** Added encoder_test to region assignment in `05_validator_workflow.sql` migration. REGIONAL_ENCODER users require assigned_region_id for authorization checks; missing value caused client-side dashboard redirect loops during development.
- **Admin client configuration:** Added `wims-admin-service` OAuth2 service account client to Keycloak realm (`src/keycloak/bfp-realm.json`) and configured backend environment variables (`KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` in `src/docker-compose.yml`). Backend keycloak_admin.py service now successfully authenticates for admin operations (user lifecycle management); previously raised RuntimeError on `/api/admin/users/*` endpoints, returning 500 errors.
- **Fresh stack initialization:** All three fixes combined allow `docker compose down -v && docker compose up -d --build` to complete successfully without FK constraint errors, missing schema errors, or 500 admin endpoint errors.

### Added
- **Keycloak configuration persisted to realm JSON:** Audience mapper, 5 custom roles, and 5 test users now in `src/keycloak/bfp-realm.json`. Previously all config was done via admin API and lost on container recreation.
- **Keycloak documentation:** `docs/ARCHITECTURE.md` now documents realm JSON vs scripts, auth env vars, and the KEYCLOAK_REALM_URL vs KEYCLOAK_ISSUER split.

- **XAI Pipeline documentation:** `docs/ARCHITECTURE.md` now documents the full Suricata → Qwen2.5-3B → narrative pipeline, including design principle (SLM translates, Suricata detects), component roles, NFR targets, and optimization priorities.

- **Regional Encoder CRUD — full lifecycle:** `POST /api/regional/incidents` (create with DRAFT status), `PUT /api/regional/incidents/{id}` (update with status gating), `DELETE /api/regional/incidents/{id}` (soft-delete). PII fields encrypted via AES-256-GCM. Status gates: DRAFT/PENDING/REJECTED editable, VERIFIED blocked (403); soft-delete DRAFT only.
- **Integration tests — Regional CRUD:** 15 tests in `tests/integration/test_regional_crud.py` covering create (minimal, nonsensitive, PII, unauthorized), read (list, detail, nonexistent), update (nonsensitive, sensitive, nonexistent, verified-blocked), delete (draft, nonexistent, pending-blocked, verified-blocked).
- **Database session refactor:** `get_db()` (bare session, no RLS) and `get_db_with_rls(request)` (RLS-aware) split to avoid dependency cycle. Eager initialization of `_engine` and `_SessionLocal` at module load.
- **Docs:** `CHANGELOG.md` moved to `docs/CHANGELOG.md`. Regional CRUD endpoints documented in `docs/API_AND_FUNCTIONS.md`. Database session management documented in `docs/ARCHITECTURE.md`.
- **Encoder UX — search bar:** Added search support in encoder incident listing/lookup flows for faster retrieval of submitted/imported incidents.
- **Validator workflow endpoints and UI:** Added region-scoped validator queue/action capabilities and validator dashboard/API client support to reflect encoder submissions in validator review.

### Changed
- **`database.py`:** Removed lazy initialization pattern (`_engine = None`, `_SessionLocal = None`). Engine and sessionmaker now initialized eagerly at import time. Added `load_dotenv()` before `SQLALCHEMY_DATABASE_URL` resolution to ensure `.env` is loaded before connection URL is read.
- **Error message leakage:** 4 instances of `str(e)` in `HTTPException.detail` replaced with generic messages + `logger.exception` in `regional.py`.
- **Docker lockdown:** Suricata container mounts changed to read-only (`:ro`), healthchecks added for postgres/redis/keycloak, `depends_on` with health conditions.
- **Encoder import reliability:** Improved Excel/AFOR parsing compatibility to better handle real-world workbook/input variations during encoder import.
- **Frontend incident details representation:** Updated UI rendering of incident details for clearer and more accurate presentation.

### Removed
- Stale files: `.ai-context/` (3 files), `SCHEMA_MERGE_NOTES.md`, `archive/sql/` (2 files), `implementation_plan.md`, `patch_realm.py`, `run_fire_incident_tests.sh`, `scan_xlsx.py`, `tasks.md`, `verify_coordinate_parser.py` (1,655 lines removed).

### Fixed
- **`_SessionLocal` TypeError:** Tests failed with `'NoneType' object is not callable` due to lazy init not being called before test fixture import. Fixed by eager initialization.
- **Database hostname resolution:** Tests failed with `could not translate host name "postgres"` because `load_dotenv()` ran after `SQLALCHEMY_DATABASE_URL` was read. Fixed by loading `.env` before URL resolution.
- **Encoder commit/submit flow:** Fixed commit and submit behavior to reliably persist encoder actions and correctly transition records for downstream validator visibility.

### Added
- **Security — AES-256-GCM PII encryption:** Implemented zero-trust AES-256-GCM encryption for `incident_sensitive_details` PII blob. `caller_name`, `caller_number`, `owner_name`, and `occupant_name` are now stored exclusively in an encrypted blob (`pii_blob_enc`) with a 12-byte nonce (`encryption_iv`), bound to the record via AAD (`incident_id:N`). Plaintext PII columns are always `NULL` for new writes; decryption falls back to legacy columns if blob is absent. Commits `182fb46`, `65fd600` (`src/backend/utils/crypto.py`, `src/backend/api/routes/regional.py`).
- **Security — Hardened caller_info parsing:** Fixed `caller_info` parsing to correctly handle the slash-delimited `"Name / Number"` format at the top-level AFOR row field. All PII values are validated before inclusion in the encrypted blob; malformed or missing delimiters do not cause silent data loss.
- **Security — Audit trail:** SecurityProvider logs `CRITICAL` events (decryption failures) with `incident_id` only — never logs nonce, ciphertext, or plaintext.
- **Tests — Flat import refactor:** Refactored `src/backend/tests/` to use flat container imports (`from models.x import X` instead of `from backend.models.x`) for correct operation inside the Docker container at `/app`. Claude Code identified 1 file, 2 imports affected.

### Changed
- feat(auth): enforce role-based OTP for admin/validator with 7-day trusted device
- **Regional encoder UI:** Dashboard incident table with server `total`, `limit`/`offset` pagination (page sizes 10 / 25 / 50), `category` and `status` filters, and region-scoped detail at `/dashboard/regional/incidents/[id]` using `GET /api/regional/incidents/{id}`. Client: `fetchRegionalIncident`, `buildRegionalIncidentsQueryString`, and pagination helpers in `src/frontend/src/lib/regional-incidents.ts`.
- **Regional AFOR — WGS84:** `POST /api/regional/afor/commit` requires JSON **`latitude`** and **`longitude`** (finite WGS84 numbers). `POST /api/regional/afor/import` preview includes **`requires_location`** when coordinates must be supplied before commit (templates do not embed reliable coords). Polygon/region-boundary checks are not enforced yet — follow-up if a shared geometry helper is added.
- **Regional AFOR — wildland:** Backend detection and parsing for the BFP wildland workbook (`WILDLAND_AFOR` vs structural `STRUCTURAL_AFOR` in `detect_afor_template_kind` / `WildlandXlsxParser`), validation via `parse_wildland_afor_report_data`, and persistence into `wims.incident_wildland_afor` with optional `wildland_row_source` (`AFOR_IMPORT` | `MANUAL`) on `POST /api/regional/afor/commit` (`src/backend/api/routes/regional.py`).
- **Frontend:** `WildlandAforManualForm` for manual wildland entry; `/afor/create` toggle between structural (`IncidentForm`) and wildland flows with session handoff from import preview; `/afor/import` wildland-aware preview columns and dual template downloads (`src/frontend/src/app/afor/create/page.tsx`, `src/frontend/src/app/afor/import/page.tsx`, `src/frontend/src/components/WildlandAforManualForm.tsx`).
- **Static asset:** `src/frontend/public/templates/wildland_afor_template.xlsx` — downloadable wildland AFOR template linked from the import and create pages.
- **API client:** `commitAforImport` accepts optional `wildlandRowSource`; AFOR preview types include `form_kind` (`src/frontend/src/lib/api.ts`).
- **Tests:** `src/backend/tests/test_afor_import.py` — wildland detection and validation cases; `src/backend/tests/integration/test_regional_afor_unified_import.py` — regional import preview, commit, and `MANUAL` source (requires DB with `wims.incident_wildland_afor`).
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
