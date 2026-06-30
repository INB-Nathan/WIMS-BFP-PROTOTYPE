---
title: Endpoint RBAC Map
created: 2026-06-30
updated: 2026-06-30
type: operations
tags: [wims-bfp, rbac, endpoints, auth, routing]
sources:
  - src/frontend/src/app/
  - src/frontend/src/components/Sidebar.tsx
  - src/frontend/src/lib/roleRedirect.ts
  - src/backend/auth.py
  - src/backend/api/routes/
  - src/backend/main.py
  - src/nginx/nginx.conf
  - backend/api-route-map.md
  - frontend/route-map.md
  - security/security-baseline.md
status: draft
---

# Endpoint RBAC Map

Complete mapping of every public-facing URL and RBAC-enforced endpoint in the WIMS-BFP system, organized by access level and role.

## Legend

| Column | Meaning |
|--------|---------|
| **URL** | Browser-facing URL path (under `https://wimsbfp.tech`) |
| **Allowed Roles** | WIMS roles permitted to access this endpoint |
| **Internal API** | Backend FastAPI route (if applicable) |
| **Description** | Purpose and key notes |

## Public Endpoints (No Authentication Required)

These endpoints require no Keycloak JWT, no session, and no WIMS role. Rate-limited at the nginx edge and/or Redis application layer.

| URL | Allowed Users | Internal API | Description |
|-----|--------------|--------------|-------------|
| `/` | All | — (Next.js SSR) | **Public Incident Reporting** — Civilian DMZ form for anonymous fire/emergency reports. Includes map picker, category selector, and location services. Sends to `POST /api/v1/public/report`. |
| `/fire-stations` | All | `GET /api/ref/fire-stations` (no-auth) | **Public Fire Station Directory** — Nationwide BFP station map with name, address, and coordinates. Supports proximity search when location is shared. |
| `/tracking` | All | `GET /api/civilian/reports/{id}` (status) | **Public Report Tracking** — `?id=<report_id>` lookup for incident report status. Displays verification status and estimated response timeline. |
| `/privacy` | All | — (Next.js SSR) | **Privacy Policy** — RA 10173 (Data Privacy Act) compliance notice, data handling practices, and contact information for the Data Protection Officer. |
| `/health` | All | — (nginx direct) | **System Health Check** — Lightweight nginx-level health probe returning `{"status":"ok","via":"nginx-gateway"}`. Used by uptime monitors and CI readiness checks. |
| `/auth/**` | All | — (proxied to Keycloak) | **Keycloak Authentication** — All Keycloak OIDC endpoints: login, token exchange, logout, account management, password reset. Handled by Keycloak directly; nginx proxies to `keycloak:8080`. |
| `/api/v1/public/**` | All | `POST /api/v1/public/report` | **Public DMZ API** — Zero-trust unauthenticated endpoints. Currently only `POST /api/v1/public/report` for anonymous incident submission. Rate-limited at 3/IP/hr via Redis sliding-window. |
| `/api/auth/consent` | All | `POST /api/auth/consent` | **Public Consent Logging** — Records civilian consent for data processing per RA 10173. No auth required. Rate-limited per IP. |
| `/api/ref/fire-stations` | All | `GET /api/ref/fire-stations` | **Fire Stations JSON API** — Returns BFP station list with coordinates. No auth. Supports `lat`/`lon` query params for nearest-5 proximity search. |
| `/api/ref/emergency-services` | All | `GET /api/ref/emergency-services` | **Emergency Services JSON API** — Returns 911 emergency number + BFP station list. Redis-cached for 24h with stale-7d fallback. |
| `/api/public/clusters` | All | `GET /api/public/clusters` | **Public Incident Clusters** — Aggregated root-map area markers from civilian reports. Redis-cached. No raw cluster/report IDs exposed. |

## Authentication Endpoints (Handled by Frontend Auth Layer)

These Next.js routes process OIDC authentication flow. They don't require a pre-existing session — they _create_ or _destroy_ one.

| URL | Allowed Users | Internal API | Description |
|-----|--------------|--------------|-------------|
| `/login` | All (pre-auth) | — (Next.js SSR) | **WIMS-BFP Login Page** — Employee-facing sign-in page. Renders BFP branding, calls `signinRedirect()` to Keycloak. Post-authentication redirects to role-specific dashboard. |
| `/callback` | All (post-auth) | `POST /api/auth/callback` | **OIDC Callback Handler** — Receives Keycloak authorization code, exchanges for tokens, sets HttpOnly session cookies, redirects to role dashboard. |
| `/api/auth/session` | All (with cookie) | `GET /api/auth/session` (frontend) | **Session Check** — Next.js API route that returns current user profile: `{user, role, assignedRegionId}`. Used by `AuthContext` for hydration. |
| `/api/auth/refresh` | All (with refresh token) | `POST /api/auth/refresh` (frontend) | **Token Refresh** — Silently refreshes the access token via the refresh token cookie. Called proactively every 4 minutes. |
| `/api/auth/logout` | All (authenticated) | `POST /api/auth/logout` (frontend) | **Logout** — Clears session cookies, revokes tokens, redirects to login. Frontend-only route. |
| `/api/auth/change-email` | All (authenticated) | `POST /api/auth/change-email` | **Email Change Initiation** — Two-step email change flow. Password + optional TOTP verified against Keycloak, verification code sent to new email. |
| `/api/auth/verify-email` | All (authenticated) | `POST /api/auth/verify-email` | **Email Verification** — Second step of email change. Confirms 6-digit code sent in step 1. |

## Shared Authenticated Endpoints (Any Authenticated WIMS Role)

All authenticated staff roles can access these pages. Role-specific features are conditionally rendered.

| URL | Allowed Roles | Internal API | Description |
|-----|--------------|--------------|-------------|
| `/dashboard` | All staff | `GET /api/dashboard/widgets` | **Main Dashboard** — Role-based landing page. Shows a welcome banner with role-specific CTA cards. Redirects to role dashboard on first load. |
| `/home` | All staff | `GET /api/operations/**` | **Operations Board** — Incident command center. Operations CRUD with linked civilian reports on an interactive map. NATIONAL_VALIDATOR can create/edit/delete operations; other roles view only. |
| `/profile` | All staff | `GET /api/user/me/profile`, `PATCH /api/user/me` | **User Profile** — View and edit personal information, change password, update contact details. Email changes require two-step verification. |
| `/incidents/[id]` | All staff | `GET /api/incidents/{id}` | **Incident Detail View** — Read-only detailed view of a specific incident record. Role-specific actions (verify, edit, archive) shown conditionally. |
| `/incidents/create` | All staff | `POST /api/incidents` | **Create Incident** — New incident form. Field visibility varies by role (encoders see AFOR fields, analysts see evidence fields). |
| `/incidents/import` | All staff | — | **Import Incident Data** — Upload CSV or structured data to create incidents in bulk. |
| `/incidents/new` | All staff | — | **Quick New Incident** — Streamlined single-incident creation flow with minimal fields. |
| `/api/auth/keycloak-event` | Server-to-server | `POST /api/auth/keycloak-event` | **Keycloak Audit SPI Ingest** — Internal endpoint called by Keycloak's `wims-audit-event-listener` SPI. Bearer token auth (`WIMS_KEYCLOAK_EVENT_SECRET`). Records login events, password resets, and lockouts. |
| `/api/events/stream` | All staff | `GET /api/events/stream` | **SSE Real-Time Event Stream** — Server-sent events for real-time notifications via Redis pub/sub. Channel subscriptions gated by role at connect time. |
| `/api/geocode/**` | All staff | `GET /api/geocode/reverse`, `/search` | **Geocoding Proxy** — Nominatim reverse geocode and address search proxy. Cached. Used for map location lookups. |
| `/api/incidents/**` | All staff | `GET /api/incidents`, `POST /api/incidents` | **Incident CRUD** — General incident listing and creation. Role-specific filtering applied via RLS. |
| `/api/ref/regions` | All staff | `GET /api/ref/regions` | **Region Reference Data** — PH region list. Requires auth. Optional `region_id` filter. |
| `/api/ref/provinces` | All staff | `GET /api/ref/provinces` | **Province Reference Data** — PH province list. Requires auth. Optional `region_id` filter. |
| `/api/ref/cities` | All staff | `GET /api/ref/cities` | **City Reference Data** — PH city/municipality list. Requires auth. Optional `province_id` or `province_ids` filter. |

## SYSTEM_ADMIN — Administration Endpoints

| URL | Allowed Roles | Internal API | Description |
|-----|--------------|--------------|-------------|
| `/admin` | SYSTEM_ADMIN | — | **Admin Dashboard** — Landing page with navigation to all admin subsystems. Shows quick stats and system overview cards. |
| `/admin/system` | SYSTEM_ADMIN | `GET /api/admin/monitoring/system` | **System Governance & Telemetry** — Identity governance, active sessions, worker status, system metrics, and threat telemetry HITL review. Central admin hub. |
| `/admin/system/config` | SYSTEM_ADMIN | `GET /api/admin/config`, `PATCH /api/admin/config/{key}` | **System Configuration** — M9c configuration management UI. Edit system-wide settings (worker timeouts, NPC contact info). Changes are audit-logged. |
| `/admin/system/rate-limits` | SYSTEM_ADMIN | `GET /api/admin/rate-limits`, `PATCH /api/admin/rate-limits` | **Rate Limit Configuration** — Auth-flow rate-limit threshold/window management. Pydantic-validated, audit-logged with `RATE_LIMIT_UPDATED` action. |
| `/admin/monitoring` | SYSTEM_ADMIN | `GET /api/admin/security-logs`, `POST /api/admin/security-logs/{id}/analyze`, `PATCH /api/admin/security-logs/{id}`, `POST /api/admin/security-logs/block-source-ip`, `GET /api/admin/security-logs/rollups` | **Security Monitoring & SIEM** — Real-time threat telemetry viewer. XAI analysis, HITL verdict (CONFIRM_THREAT / FALSE_POSITIVE / REQUEST_MORE_INFO), IP blocklist management, SIEM hourly/daily rollups, create-incident-from-alert. |
| `/admin/breach` | SYSTEM_ADMIN | `GET /api/admin/breach`, `GET /api/admin/breach/{id}`, `PATCH /api/admin/breach/{id}` | **Breach Notification Management** — RA 10173 NPC 72h breach tracking. View, update status, add notes with forensic audit trail (old_values/new_values). Includes NPC contact card. |
| `/admin/audit` | SYSTEM_ADMIN | `GET /api/admin/audit-logs`, `POST /api/admin/audit-logs/analyze` | **System Audit Log** — Forensic audit trail viewer. Filters by user, action_type, table, IP, date range. Batch SLM behavioral analysis via Ollama. |
| `/admin/anomalies` | SYSTEM_ADMIN | `GET /api/admin/anomalies`, `PATCH /api/admin/anomalies/{id}` | **Anomaly Detection Dashboard** — Behavioral anomaly viewer (bulk delete, off-hours activity, privilege escalation, rapid IP switch, suspicious queries, password reset abuse). Aggregate counts, type/severity facets, status transitions (NEW→ACKNOWLEDGED→RESOLVED). |
| `/admin/backups` | SYSTEM_ADMIN | `POST /api/admin/backup`, `GET /api/admin/backups`, `GET /api/admin/backup/{filename}`, `POST /api/admin/restore` | **Backup & Restore Management** — Trigger on-demand backups, list available backups, download encrypted backup files, restore from backup. AES-256-GCM or OpenBao Transit encryption. |
| `/api/admin/users/**` | SYSTEM_ADMIN | `POST /api/admin/users`, `GET /api/admin/users`, `PATCH /api/admin/users/{id}` | **User Management API** — Create, list, update WIMS users. CRUD operations on `wims.users`. |
| `/api/admin/active-sessions` | SYSTEM_ADMIN | `GET /api/admin/active-sessions` | **Active Sessions API** — List all active user sessions with device info. |
| `/api/admin/users/{id}/logout` | SYSTEM_ADMIN | `POST /api/admin/users/{id}/logout` | **Force Logout API** — Terminate a specific user's session. Audit-logged. |
| `/api/admin/health` | SYSTEM_ADMIN | `GET /api/admin/health` | **System Health API** — Detailed health status of all backend services (Postgres, Redis, Keycloak, Ollama). |
| `/api/admin/monitoring/workers` | SYSTEM_ADMIN | `GET /api/admin/monitoring/workers`, `POST /api/admin/monitoring/workers/prune` | **Worker Monitoring API** — Celery worker status, heartbeat health, prune stale offline workers. |
| `/api/admin/security-logs/block-by-filter` | SYSTEM_ADMIN | `POST /api/admin/security-logs/block-by-filter` | **Bulk IP Block API** — Filter-scoped bulk block. Hard-capped at 500 IPs. Dry-run preview available. |
| `/api/admin/security-logs/bulk-action` | SYSTEM_ADMIN | `POST /api/admin/security-logs/bulk-action` | **Bulk Security Action API** — Batch dismiss, false-positive, or block-IP for selected log IDs. |
| `/api/admin/ip-blocklist` | SYSTEM_ADMIN | `GET /api/admin/ip-blocklist`, `DELETE /api/admin/ip-blocklist/{ip}` | **IP Blocklist API** — List active blocks with derived block_count, unblock IP. |
| `/api/admin/analytics/backfill` | SYSTEM_ADMIN | `POST /api/admin/analytics/backfill` | **Analytics Backfill API** — Trigger materialized view refresh for analytics data. |
| `/api/admin/scheduled-reports` | SYSTEM_ADMIN | `POST`, `GET`, `PATCH /api/admin/scheduled-reports` | **Scheduled Reports API** — Manage automated report generation schedules. |
| `/api/admin/audit-logs/analyze` | SYSTEM_ADMIN | `POST /api/admin/audit-logs/analyze` | **Audit Analysis API** — Batch SLM analysis of audit logs for behavioral patterns. |

## REGIONAL_ENCODER — Encoder Endpoints

| URL | Allowed Roles | Internal API | Description |
|-----|--------------|--------------|-------------|
| `/dashboard/regional` | REGIONAL_ENCODER, ENCODER | `GET /api/regional/incidents`, `GET /api/regional/stats` | **Regional Encoder Dashboard** — Incident list with Today/Date Range filters. Summary cards (Total This Week, category/wildland counts). Rejected alerts with dismiss. Calendar picker for date-range filtering. |
| `/dashboard/regional/audit` | REGIONAL_ENCODER, ENCODER | `GET /api/regional/audit-log` | **Encoder Activity Log** — Personal audit trail of CRUD operations on incidents. |
| `/dashboard/regional/offline-work` | REGIONAL_ENCODER, ENCODER | — (IndexedDB local) | **Offline Work Queue** — Pending offline operations (create/update) queued while disconnected. Badge count in sidebar. |
| `/dashboard/regional/drafts` | REGIONAL_ENCODER, ENCODER | `PATCH /api/regional/incidents/draft/{id}`, `DELETE /api/regional/incidents/draft/{id}` | **Draft Incidents** — List and manage saved drafts. Resume editing or discard. |
| `/dashboard/regional/conflicts` | REGIONAL_ENCODER, ENCODER | `GET /api/incidents/check-duplicate` | **Incident Conflict Resolution** — Review and resolve duplicate incident conflicts detected during AFOR import or manual entry. |
| `/dashboard/regional/incidents/[id]` | REGIONAL_ENCODER, ENCODER | `GET /api/regional/incidents/{id}`, `PUT /api/regional/incidents/{id}`, `DELETE /api/regional/incidents/{id}` | **Regional Incident Detail** — Formal report-style read-only detail page. Section navigation, edit/delete/withdraw/submit/archive actions. Pending-sync local IDs render from IndexedDB. |
| `/dashboard/regional/incidents/local/[localId]` | REGIONAL_ENCODER, ENCODER | — (IndexedDB) | **Local Incident Detail** — Redirect shim to `/dashboard/regional/incidents/{localId}` for offline-created incidents. |
| `/afor/create` | REGIONAL_ENCODER, ENCODER | `POST /api/regional/incidents` | **Manual AFOR Entry** — Full incident form with AFOR fields. Draft autosave per authenticated user (`wims:incident_draft:{user.id}`). |
| `/afor/import` | REGIONAL_ENCODER, ENCODER | `POST /api/regional/afor/import`, `POST /api/regional/afor/commit` | **AFOR Workbook Import** — Upload and commit AFOR spreadsheets. Validation preview before commit. Supports structural and wildland AFOR formats. |
| `/api/regional/incidents` | REGIONAL_ENCODER | `GET` (list), `POST` (create) | **Regional Incidents API** — List/create incidents scoped to encoder's assigned region. |
| `/api/regional/incidents/{id}` | REGIONAL_ENCODER | `PUT`, `DELETE`, `PATCH /submit`, `PATCH /archive`, `PATCH /unarchive` | **Regional Incident CRUD API** — Full lifecycle management: update, delete, submit for review, archive, unarchive. |
| `/api/regional/incidents/{id}/force-replace` | REGIONAL_ENCODER | `POST` | **Force Replace API** — Replace an incident record while preserving history. |
| `/api/regional/incidents/draft/{id}` | REGIONAL_ENCODER | `PATCH`, `DELETE` | **Draft API** — Update or delete saved drafts. |
| `/api/regional/incidents/{id}/unpend` | REGIONAL_ENCODER | `PATCH` | **Unpend Incident API** — Remove pending status from an incident. |
| `/api/regional/afor/import` | REGIONAL_ENCODER | `POST` | **AFOR Import API** — Upload AFOR workbook for parsing and validation. |
| `/api/regional/afor/commit` | REGIONAL_ENCODER | `POST` | **AFOR Commit API** — Commit validated AFOR data as official incident records. |
| `/api/regional/incidents/check-duplicate` | REGIONAL_ENCODER | `GET` | **Duplicate Check API** — Check incident for potential duplicates before creation. |
| `/api/regional/stats` | REGIONAL_ENCODER | `GET` | **Regional Stats API** — Aggregated incident statistics for the encoder's region. |

## NATIONAL_VALIDATOR — Validator Endpoints

| URL | Allowed Roles | Internal API | Description |
|-----|--------------|--------------|-------------|
| `/dashboard/validator` | NATIONAL_VALIDATOR | `GET /api/regional/validator/incidents`, `GET /api/regional/validator/stats` | **Validator Dashboard** — Verification queue with incident cards. Status filters (VERIFIED/PENDING/REJECTED). Daily metrics. |
| `/dashboard/validator/audit` | NATIONAL_VALIDATOR | `GET /api/regional/validator/audit-logs`, `GET /api/regional/validator/audit-logs/export` | **Validator Audit Trail** — Audit log of verification actions (approve, reject, correct). CSV export available. |
| `/dashboard/validator/map` | NATIONAL_VALIDATOR | `GET /api/validator/operational-map` | **Operational Map** — Map view of incidents with status filters. Authenticated, shows all incidents within scope. |
| `/incidents/triage` | NATIONAL_VALIDATOR | `GET /api/triage/queue`, `GET /api/triage/pending`, `POST /api/triage/clusters/{id}/claim`, `POST /api/triage/clusters/{id}/terminal-action`, `POST /api/triage/clusters/{id}/split`, `POST /api/triage/clusters/{target_id}/merge`, `GET /api/triage/clusters/{id}/merge-candidates` | **Civilian Triage Queue** — Phase 2 civilian report triage. Map-first spatial workspace with cluster inspection, claim workflow, terminal actions (PROMOTE/REJECT/REQUEST_INFO), split/merge, activity log. Two-step destructive confirmation. |
| `/api/regional/validator/incidents` | NATIONAL_VALIDATOR | `GET`, `PATCH /{id}/verification` | **Validator Incident Queue API** — List pending incidents and verify (approve/reject) specific records. |
| `/api/regional/validator/incidents/bulk-approve` | NATIONAL_VALIDATOR | `POST` | **Bulk Approve API** — Batch-approve multiple incidents at once. |
| `/api/regional/validator/incidents/{id}/archive` | NATIONAL_VALIDATOR | `PATCH` | **Archive/Unarchive API** — Archive or unarchive verified records. |
| `/api/regional/validator/incidents/{id}` | NATIONAL_VALIDATOR | `DELETE` (archived only) | **Delete Archived API** — Permanent deletion of archived records. |
| `/api/regional/validator/incidents/{id}/correct` | NATIONAL_VALIDATOR | `PATCH` | **Correct Verified Incident API** — Post-verification correction of incident details. With full audit trail. |
| `/api/regional/validator/incidents/{id}/diff` | NATIONAL_VALIDATOR | `GET` | **Incident Diff API** — Compare current vs. previous version of an incident. |
| `/api/regional/validator/incidents/{id}/history` | NATIONAL_VALIDATOR | `GET` | **Incident Revision History API** — Full version history of an incident. |
| `/api/triage/**` | NATIONAL_VALIDATOR | `GET /queue`, `GET /pending`, `POST /clusters/{id}/claim`, `POST /clusters/{id}/activity`, `GET /clusters/{id}/activity`, `POST /clusters/{id}/terminal-action`, `POST /reports/{id}/correct`, `POST /clusters/{id}/split`, `POST /clusters/{target_id}/merge`, `GET /clusters/{id}/merge-candidates` | **Triage API** — Full triage workflow: cluster inspection, claim, activity monitoring, terminal actions (promote/reject/request-info), split/merge, merge-candidate discovery (250m/1hr). |

## NATIONAL_ANALYST — Analyst Endpoints

| URL | Allowed Roles | Internal API | Description |
|-----|--------------|--------------|-------------|
| `/dashboard/analyst` | NATIONAL_ANALYST | `GET /api/analytics/**`, `GET /api/incidents/analyst-list` | **Analyst Dashboard** — Full analytics workspace with tabbed views: Comparative, Heatmap, Trends, Response Time, Top-N Hotspots, Incident Explorer. Recharts panels, export preview (CSV/PDF/XLSX), workflow transfer. |
| `/dashboard/analyst/[workflow]` | NATIONAL_ANALYST | (`workflow` param selects view) | **Workflow-Specific View** — Dynamic route for focused views: `comparative`, `heatmap`, `trends`, `response-time`, `top-n`, `incident-explorer`. Shared filters and export actions. Phase 1 workflow handoff with sessionStorage transfer IDs. |
| `/dashboard/analyst/incidents/[id]` | NATIONAL_ANALYST | `GET /api/incidents/analyst/{id}`, `GET /api/incidents/analyst/{id}/sensitive` | **Analyst Incident Detail** — Read-only incident view with sensitive detail access (decrypted PII). Copy incident ID button. |
| `/dashboard/analyst/incidents/[id]/wildland` | NATIONAL_ANALYST | `GET /api/incidents/analyst/{id}/wildland` | **Wildland Incident Detail** — Extended wildland fire data for incidents with wildland classification. |
| `/api/incidents/analyst-list` | NATIONAL_ANALYST | `GET` | **Analyst Incident List API** — Paginated incident list for analysts. Supports `incident_ids` query param for selected-set evidence tables. |
| `/api/incidents/analyst/{id}` | NATIONAL_ANALYST | `GET` | **Analyst Incident Detail API** — Full incident data including decrypted fields. |
| `/api/incidents/analyst/{id}/sensitive` | NATIONAL_ANALYST | `GET` | **Analyst Sensitive Detail API** — PII and sensitive data (caller info, narrative, casualties, property damage). Decrypted server-side. |
| `/api/incidents/analyst/{id}/wildland` | NATIONAL_ANALYST | `GET` | **Analyst Wildland Detail API** — Wildland-specific incident data (fire behavior, weather, fuel model, suppression tactics). |
| `/api/analytics/**` | NATIONAL_ANALYST | 17 endpoints (see `backend/api-route-map.md`) | **Analytics API** — Heatmap GeoJSON, trends (daily/weekly/monthly/quarterly/yearly), comparative cross-region, response time by region, top-N hotspots, type distribution, top barangays, filter options, export (CSV/PDF/XLSX). |
| `/api/analytics/refresh-views` | NATIONAL_ANALYST | `POST` | **Refresh Materialized Views API** — Trigger refresh of analytics materialized views. |

