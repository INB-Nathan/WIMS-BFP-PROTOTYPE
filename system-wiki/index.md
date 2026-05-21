# WIMS-BFP System Wiki Index

Last updated: 2026-05-19
Total synthesis pages: 31
Last changes: gap-register consolidated (M9 deferred, barangay optional), functional-bug-register F-01 to F-07 consolidated, F-06 fixed, analyst workflow Phase 1 status confirmed.
Purpose: project-local knowledgebase for agents routing themselves to relevant WIMS-BFP context.

## Start Here
- [[mocs/system-map]] — primary map of content and routing entry point.
- [[operations/agent-routing-guide]] — which page an agent should read before touching each subsystem.

## Architecture
- [[architecture/system-overview]] — Dockerized full-stack architecture, runtime services, and evidence sources.
- [[architecture/context-map]] — source-of-truth hierarchy and how FRS, code, and this wiki relate.
- [[architecture/infrastructure-config]] — Docker Compose, Nginx reverse proxy, Suricata IDS, Keycloak realm config (2641-line export).
- [[architecture/pwa-tests-cicd]] — PWA/offline-first (IndexedDB, sync engine, service worker), test infrastructure (30 test files), CI/CD pipelines (GitHub Actions).
- [[architecture/docs-and-scripts]] — Project documentation (10 files: ARCHITECTURE, CHANGELOG, API docs, M4 specs, PR docs) and utility scripts (14 files: seeding, geography, code generation, AFOR preview tool).

## Concepts
- [[concepts/frs-module-map]] — 15-module FRS map with current source availability and code anchors.

## Backend
- [[backend/api-route-map]] — FastAPI route files, endpoints, and likely module ownership.
- [[backend/services]] — Analytics read model, duplicate detection, Keycloak admin, AI/XAI service, Suricata ingestion.
- [[backend/utilities-and-tasks]] — Crypto (AES-256-GCM), audit trail, Redis session revocation, backup crypto, Celery export tasks (CSV/PDF/XLSX).
- [[backend/backend-infrastructure]] — Auth module (7 dependencies), database session (RLS GUC), FastAPI entry point, ORM models (6), Pydantic schemas (6), Celery config (3 periodic tasks).
- [[backend/remaining-routes]] — incidents.py (8 routes), analytics.py (15 routes), public_dmz.py, civilian.py (2), sessions.py (2), user.py (3), ref.py (3).

## Frontend
- [[frontend/route-map]] — Next.js App Router pages and UI surface mapping.
- [[frontend/frontend-infrastructure]] — Auth context, 47 API client functions, utility libraries, component tree documentation.
- [[frontend/components-deep]] — Deep docs for all 12 analytics/modal/layout components (props, state, effects, behavior).

## Subsystems (Dashboard Deep-Dives)
- [[subsystems/admin-hub]] — System admin hub: identity, security telemetry, audit, backups, health.
  - [[subsystems/references/admin-api-ref]] — full function-level API reference for admin.py.
- [[subsystems/regional-dashboard]] — Regional encoder dashboard: AFOR import, incident CRUD, stats, drafts.
  - [[subsystems/references/regional-api-ref]] — full function-level API reference for regional.py.
  - [[subsystems/references/triage-api-ref]] — full function-level API reference for triage.py.
- [[subsystems/validator-hub]] — National validator dashboard: verification queue, duplicate resolution, audit trail.

## Database
- [[database/schema-overview]] — PostgreSQL/PostGIS tables and migration source files.
- [[database/sql-init-files]] — Complete documentation of all 31 SQL init files: RLS policies, helper functions, analytics materialized views, immutable records, seed data, and migration intent.

## Security
- [[security/security-baseline]] — auth, RBAC, RLS, audit, IDS/XAI, and fail-closed notes.

## Gaps
- [[gaps/frs-codebase-gap-register]] — FRS/codebase verification targets (hashing, RLS, notifications, offline-first, M9).
- [[gaps/ui-ux-gap-register]] — UI/UX improvement gaps (login layout, admin hub layout, TOTP UX, etc.).
- [[gaps/functional-bug-register]] — functional/auth bugs (M12: audit record_id, first-login validation, username change, session timeout, MFA lockout).

## UI/UX Evaluations
- [[ui-ux/evaluation-loginpage-keycloaksso]] — login misalignment, hero icon loss, TOTP digit-separation.
- [[ui-ux/evaluation-system-admin-hub]] — linear layout, missing M9 metrics, no pagination/filters, region selector, announcement feature.
- [[ui-ux/evaluation-national-analyst]] — heatmap aspect ratio, missing incident container, filter coverage, export preview, missing analytics views (top municipalities, response time); cross-referenced with FRS M5 and GitHub issues #84–#89.

## PR QA
- [[pr-qa/pr-batch-2026-05-overview]] — May 2026 batch overview (PRs #102–#105)
- [[pr-qa/pr-102-m4-postfix-afour-persistence-audit-ux]] — M4 post-fix: AFOR, persistence, audit, UX polish
- [[pr-qa/pr-103-system-monitoring-prometheus]] — #70 Prometheus /metrics + worker heartbeat
- [[pr-qa/pr-104-xai-incident-narratives]] — #69 XAI incident narrative generation
- [[pr-qa/pr-105-suricata-auto-incident]] — #68 Suricata HIGH auto-incident creation

## Raw Source Captures
- `raw/frs/` — user-supplied FRS module files (11 now populated; 4 were empty and restored).
- `raw/ui-ux/` — user desk-check evaluations of login page and system admin hub.
- `raw/codebase/codebase-snapshot-2026-05-14.md` — generated repository snapshot used for initialization.
