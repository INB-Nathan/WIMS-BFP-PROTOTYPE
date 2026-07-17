# WIMS-BFP System Wiki Index

Last updated: 2026-07-18
Indexed wiki pages: 89
Last changes: 2026-07-18 adds a compact auth-state indicator to the public `/report` wizard that reuses `AuthContext` via `useAuth()` (neutral loading / signed-in / guest-with-`/login` states) with no second session fetch or client JWT parsing, keeping anonymous reporting ungated; `report/page.tsx` and `components/report-wizard/Wizard.tsx` are documented in [[frontend/route-map]]. 2026-07-18 restyles capability-token `/tracking/v2/{report_id}/{tracking_token}` as a shared public-surface receipt with a QR code and copyable secure token, while preserving its safe route/timeline projection. 2026-07-18 moves `/profile` into the persisted public-surface shell only for CIVILIAN_REPORTER sessions, preserving the staff sidebar/header shell for all other roles. 2026-07-17 completes the public navigation follow-up with an auth-aware mobile drawer, stable loading skeleton, profile/logout menu, shared landing tokens, and a public-surface Fire Stations directory. 2026-07-17 makes the public navbar session-aware, limits anonymous destinations, gives authenticated users a role-dashboard path, removes chrome from `/login`, and aligns the Keycloak SSO theme with the persisted public mode. 2026-07-17 validates the committed Suricata 8 configuration in CI, keeps 53 WIMS custom SIDs directly loaded, and refreshes ET Open rules without merging custom rules. 2026-07-17 renders public civilian pressure as area circles and published, linked VERIFIED incidents as perimeter polygons (with a point fallback), and restyles `/verify-sent` in the shared public surface. 2026-07-17 migrates the authenticated `/contributor` dashboard to the shared public-surface shell with a two-card report/verification summary, bounded current-status activity, filterable/paginated private reports, and a compact station-enabled map; no contributor API or auth contract changed. 2026-07-17 replaces the synthetic perimeter prototype with the online, role-gated production workspace for verified incidents; manually drawn GeoJSON is saved as `MANUAL_DRAW` and area is PostGIS-authoritative. 2026-07-17 adds the capability-token tracking timeline with stage-whitelisted metadata and the light route map/inspector workspace; missing geometry remains text-only to preserve the no-coordinate public tracking boundary. The public theme now defaults to light for first-time visitors, and report-location progression requires coordinates or a landmark. 2026-07-16 refines the shared public header: public/civilian routes use the sticky frosted WIMS-BFP header while `/` retains its page-owned landing header, and `/report` omits the redundant report CTA/FAB. 2026-07-14 hardens issue #558 PR2 review findings: whitespace-only audit queries are ignored, OpenBao public-key errors are attributed correctly, and verifier ZIP member/aggregate limits prevent excessive in-memory allocation. The PR2 secure admin/validator ZIP export routes, strict manifest schemas, ZIP-safe online/offline verification, and operator CLI remain covered. PR1 added the OpenBao signer foundation, canonical hash-chain CSV, deterministic ReportLab PDF primitives, and runbook/security routing. 2026-07-13 adds the manual-only WIMS Wayfinder workflow for batch-confirmed GitHub decision maps, concurrency-safe claims, serialized map updates, and post-map implementation issue promotion. 2026-07-13 follow-up fixes retire the dead `?update_report_id=` browser entry path and make notification clicks reopen the correct stored secure tracking URL via `/tracking?report_id=...` compatibility resolution. Slice M (2026-07-13) retires the public device-ID tracking list endpoint in favor of secure `/tracking/v2/{report_id}/{tracking_token}` capability links and updates the route/security/docs surface accordingly. Slice L (2026-07-13) completes the normalized contributor reliability engine by adding the 24-hour EXIF/report timestamp-consistency evidence signal, pinning the activity window to the current UTC month plus five previous UTC calendar months, and removing the retired `wims.photo_bonus_for_report(INTEGER)` helper from the final schema via Alembic `0013` + bootstrap `92_remove_legacy_photo_bonus_function.sql`.
Purpose: project-local knowledgebase for agents routing themselves to relevant WIMS-BFP context.

## Start Here
- [[mocs/system-map]] — primary map of content and routing entry point.
- [[operations/agent-routing-guide]] — which page an agent should read before touching each subsystem.
- [[operations/local-dev-deploy-guide]] — clean-slate local deployment on Windows: local HTTP-only nginx override, known pitfalls (CRLF scripts, accidental production TLS config, password policy), seed users, verification.
- [[operations/vps-deploy-debug-guide]] — VPS deployment debugging: SSH access, stale container cleanup, nginx DNS cache, stuck containers, endpoint checks, CI troubleshooting.
- [[operations/manual-smoke-testing]] — role-based manual smoke-test runbook for Admin, Validator, and Analyst issue intake.

## Architecture
- [[architecture/system-overview]] — Dockerized full-stack architecture, runtime services, and evidence sources.
- [[architecture/context-map]] — source-of-truth hierarchy, root `CONTEXT.md` glossary, and how FRS, code, and this wiki relate.
- [[architecture/agent-instruction-hierarchy]] — scope and ownership of the eight first-party `AGENTS.md` files, including Pi discovery and generated-tree boundaries.
- [[architecture/infrastructure-config]] — Docker Compose, Nginx reverse proxy, Suricata IDS, Keycloak realm config (2641-line export).
- [[architecture/pwa-tests-cicd]] — PWA/offline-first (IndexedDB, sync engine, service worker), test infrastructure (30 test files), CI/CD pipelines (GitHub Actions).
- [[architecture/docs-and-scripts]] — Project documentation (10 files: ARCHITECTURE, CHANGELOG, API docs, M4 specs, PR docs) and utility scripts (14 files: seeding, geography, code generation, AFOR preview tool).

## Concepts
- [[concepts/frs-module-map]] — 15-module FRS map with current source availability and code anchors.
- [[prd/civilian-reporting-phase-2]] — PRD for the structured civilian reporting and validator triage Phase 2 workflow.
- [[plans/civilian-reporting-phase-2-implementation-issues]] — vertical implementation issue breakdown for the Phase 2 PRD.
- [[plans/architecture-refactor-phase-0-safety-baseline]] — verification baseline for staged architecture refactors.
- [[plans/architecture-refactor-phase-1-afor-parser-extraction]] — AFOR parser extraction plan.
- [[plans/architecture-refactor-phase-2-afor-commit-extraction]] — AFOR commit workflow extraction plan.
- [[plans/architecture-refactor-phase-3-regional-incident-lifecycle]] — regional incident lifecycle extraction plan.
- [[plans/architecture-refactor-phase-4-civilian-triage-workflow]] — civilian triage workflow extraction plan.
- [[plans/architecture-refactor-phase-5-analytics-query-interface]] — analytics query/filter Interface plan.
- [[plans/architecture-refactor-phase-6-frontend-api-slices]] — frontend API client slicing plan.

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
- [[frontend/validator-triage-shortcuts]] — safe keyboard shortcut reference for civilian report validator triage.

## Subsystems (Dashboard Deep-Dives)
- [[subsystems/admin-hub]] — System admin hub: identity, security telemetry, audit, backups, health.
  - [[subsystems/references/admin-api-ref]] — full function-level API reference for admin.py.
- [[subsystems/regional-dashboard]] — Regional encoder dashboard: AFOR import, incident CRUD, stats, drafts.
  - [[subsystems/references/regional-api-ref]] — full function-level API reference for regional.py.
  - [[subsystems/references/triage-api-ref]] — full function-level API reference for triage.py (pre-Phase 2 baseline).
- [[subsystems/validator-hub]] — National validator dashboard: verification queue, duplicate resolution, audit trail.
- [[subsystems/civilian-reporting-phase2]] — Civilian Reporting Phase 2 full subsystem record: public API, triage queue, merge-candidate discovery, cluster map, keyboard shortcuts, timeout job, test coverage.

## Database
- [[database/schema-overview]] — PostgreSQL/PostGIS tables plus the ordered clean-bootstrap SQL and Alembic persistent-upgrade paths.
- [[database/sql-init-files]] — Complete documentation of SQL init files: RLS policies, helper functions, analytics materialized views, immutable records, seed data, demo threat telemetry, and migration intent.

## Security
- [[security/security-baseline]] — auth, RBAC, RLS, audit, IDS/XAI, and fail-closed notes.
- [[security/asvs-l2-overrides]] — project-specific ASVS audit evidence paths and current compliance exceptions.

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
