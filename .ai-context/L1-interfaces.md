# L1 Interfaces

## Key Data Models (I/O Contracts)

### Primary relational entities (`wims` schema)
- `users`
  - **Inputs**: `keycloak_id`, `username`, `role`, optional `assigned_region_id`.
  - **Outputs/usage**: Auth resolution, RBAC checks, region scoping.
- `fire_incidents`
  - **Inputs**: `region_id`, `encoder_id`, `location` (`GEOGRAPHY(POINT, 4326)`), `verification_status`.
  - **Outputs/usage**: Dashboard tracking, PostGIS heatmaps, centralized triage workflows.
- `citizen_reports`
  - **Inputs**: Geospatial point + free-text description (Public VPS edge).
  - **Outputs/usage**: Triage queue entries for the `NATIONAL_VALIDATOR`.
- `security_threat_logs`
  - **Inputs**: Suricata-derived source/destination/SID/severity/raw payload.
  - **Outputs/usage**: Admin review + AI narrative fields (`xai_narrative`, `xai_confidence`).

### Core backend DTOs (Pydantic)
- `IncidentCreate` -> `{ latitude, longitude, description, verification_status? }`
- `OfflineBundleSync` -> `{ encrypted_payload, auth_tag, iv, region_id }`
- `CivilianReportCreate` -> `{ latitude, longitude, description }`
- `XaiNarrativeResponse` -> `{ log_id, xai_narrative, xai_confidence, generated_at }`

## API Surface

### FastAPI Backend (`/api/*`)
- `POST /api/auth/callback` -> Synchronizes Keycloak session.
- `GET /api/user/me` -> `{ email, username, role, user_id, assigned_region_id }`.
- `POST /api/civilian/reports` -> (Unauthenticated) accepts public crowdsourced alerts.
- `GET /api/triage/pending` -> `NATIONAL_VALIDATOR` queue.
- `POST /api/triage/{report_id}/verify` -> ONLY `NATIONAL_VALIDATOR` can execute.
- `POST /api/regional/bundle/sync` -> Uploads and decrypts Dexie.js offline bundles.
- `GET /api/analytics/heatmap` -> Returns aggregated PostGIS data for `NATIONAL_ANALYST`.
- `GET /api/admin/security-logs` -> Fetches Suricata logs with attached XAI narratives.

### Next.js Route Handlers (`/api/auth/*`)
- `GET /api/auth/session` -> Current session/user context.
- `POST /api/auth/sync` -> Syncs callback/token to backend, sets secure HTTP-only auth cookie.
- `POST /api/auth/logout` -> Clears session via Keycloak backchannel.

## Public Function Signatures (Cross-Boundary)

### Auth and Access Dependencies (`src/backend/auth.py`)
- `get_current_user(request: Request) -> dict`
- `require_role(allowed_roles: list[str]) -> Callable` (e.g., `require_role(["NATIONAL_VALIDATOR"])`)
- `get_system_admin(current_user: dict) -> dict`
- `get_national_analyst(current_user: dict) -> dict`

### Data and Task Services (`src/backend/services`, `src/backend/tasks`)
- `decrypt_offline_bundle(payload: bytes, key: bytes) -> dict`
- `generate_xai_narrative(suricata_log: dict) -> str` (Celery Task calling Ollama)
- `ingest_suricata_eve() -> int` (Celery Task)

### Frontend API Boundary (`src/frontend/src/lib/api.ts`)
- `syncOfflineQueue() -> Promise<void>` (Dexie.js to FastAPI background sync)
- `submitCivilianReport(data) -> Promise<void>`
- `fetchHeatmapData(filters) -> Promise<GeoJSON>`