# L0 Architectural Map

## Core Domains
- **Identity and Access**: Keycloak OIDC + JWT validation for protected backend routes. Strict Role-Based Access Control (`REGIONAL_ENCODER`, `NATIONAL_VALIDATOR`, `NATIONAL_ANALYST`, `SYSTEM_ADMIN`).
- **Incident Lifecycle**: Official incidents (`wims.fire_incidents`) utilizing PostGIS for geospatial tracking. Soft deletes enforced (`deleted_at`).
- **Civilian Intake and Centralized Triage**: Public report submission (`wims.citizen_reports`) to a `PENDING` queue. Only the `NATIONAL_VALIDATOR` can promote/verify these into official incidents.
- **Offline-First Regional Operations**: PWA-driven offline encoding via Dexie.js. Encrypted AES-256-GCM data bundles synced to the backend when connectivity is restored.
- **Security Telemetry & XAI**: Suricata EVE ingestion, threat log storage, and localized AI narrative analysis via Qwen2.5-3B (Ollama) strictly for human-in-the-loop (HITL) review by the `SYSTEM_ADMIN`.
- **Analytics**: Read-only geospatial heatmaps and executive statistical aggregations strictly scoped for the `NATIONAL_ANALYST`.

## Runtime Architecture (Single-Segmented VPS)
- **Frontend**: Next.js App Router (`src/frontend/src/app`), React 19, TypeScript, TailwindCSS, Leaflet (Mapbox), Dexie.js (Offline Cache).
- **Backend API**: FastAPI (`src/backend/main.py`, `src/backend/api/routes`), SQLAlchemy/GeoAlchemy2 for spatial ORM.
- **Database**: PostgreSQL 15 + PostGIS (`wims` schema), completely isolated in the Docker bridge network.
- **Async/Infra**: Celery + Redis for heavy spatial/AI tasks, Nginx as the reverse proxy gateway, Suricata IDS, Ollama (`qwen2.5:3b`).

## Critical User Flows (Top 3)
1. **Public Crowdsourced Reporting**
   - Civilian Reporter submits payload (`POST /api/civilian/reports`) -> Hits public VPS Nginx -> FastAPI saves to `citizen_reports` as `PENDING` -> Rendered as unverified pin on the National Validator's PostGIS heatmap.
2. **Offline-First Regional Sync**
   - `REGIONAL_ENCODER` loses internet -> Encodes incidents locally into Dexie.js -> Network returns -> PWA mathematically seals data into an AES-256-GCM bundle -> `POST /api/regional/bundle/sync` -> FastAPI decrypts, validates, and commits to `wims.fire_incidents`.
3. **AI-Assisted Threat Detection**
   - Suricata flags anomaly -> Celery worker parses `eve.json` -> Sends raw log to local Ollama (Qwen2.5) -> AI generates human-readable forensic narrative -> `SYSTEM_ADMIN` reviews narrative on dashboard.