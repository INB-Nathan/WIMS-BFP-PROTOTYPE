---
title: Frontend Route Map
created: 2026-05-14
updated: 2026-07-13
type: frontend
tags: [wims-bfp, frontend, routing, implementation-map]
sources: [raw/codebase/codebase-snapshot-2026-05-14.md, src/frontend/src/app]
status: draft
---

# Frontend Route Map

Next.js App Router pages detected under `src/frontend/src/app`.

| Route | Source file |
|---|---|
| `/admin` | `admin/page.tsx` |
| `/admin/system` | `admin/system/page.tsx` | System admin hub with identity governance (#346), active sessions (#347), consolidated health & monitoring (#344), audit CTA (#352), and threat telemetry HITL review. Threat modal keeps reviewed alerts open after Confirm Threat/False Positive, shows inline backend-500 guidance, keeps View Related Evidence available for reviewed and unreviewed alerts, and uses staged XAI: stage 1 anomaly/evidence narrative first, then an explicit Generate Recommended Action button with persistent loading/status recovery. |
| `/admin/system/config` | `admin/system/config/page.tsx` | M9c admin configuration management UI including worker timeouts (#170, #247, #354) |
| `/admin/system/rate-limits` | `admin/system/rate-limits/page.tsx` | Auth-flow rate-limit configuration UI with validation, explanatory copy, and success/failure states (#363) |
| `/admin/monitoring` | `admin/monitoring/page.tsx` | Security monitoring with auth loading guard (#358) |
| `/admin/anomalies` | `admin/anomalies/page.tsx` | Anomaly detection with aggregate counts, dynamic type/severity filters, seed-data empty state (#356, #358, #362) |
| `/admin/audit` | `admin/audit/page.tsx` | Dedicated system audit page with advanced filters, pagination, offline caching, and action-type suggestions including `UPLOAD_BUNDLE` and `CIVILIAN_FOLLOWUP` (#352) |
| `/admin/breach` | `admin/breach/page.tsx` | Breach notifications with NPC contact card (#355), status confirmation modal with notes (#361), auth loading guard (#358) |
| `/afor/create` | `afor/create/page.tsx` |
| `/afor/import` | `afor/import/page.tsx` |
| `/callback` | `callback/page.tsx` |
| `/dashboard/analyst` | `dashboard/analyst/page.tsx` |
| `/dashboard/analyst/[workflow]` | `dashboard/analyst/[workflow]/page.tsx` |
| `/dashboard/analyst/incidents/[id]` | `dashboard/analyst/incidents/[id]/page.tsx` |
| `/dashboard/analyst/incidents/[id]/wildland` | `dashboard/analyst/incidents/[id]/wildland/page.tsx` |
| `/dashboard` | `dashboard/page.tsx` |
| `/dashboard/regional/audit` | `dashboard/regional/audit/page.tsx` |
| `/dashboard/regional/drafts` | `dashboard/regional/drafts/page.tsx` |
| `/dashboard/regional/incidents/[id]` | `dashboard/regional/incidents/[id]/page.tsx` | Numeric IDs fetch/cache server incidents; non-numeric local IDs render pending-sync incidents from encrypted `offlineOps` without a server fetch. |
| `/dashboard/regional/incidents/local/[localId]` | `dashboard/regional/incidents/local/[localId]/page.tsx` | Legacy redirect shim to `/dashboard/regional/incidents/{localId}`. |
| `/dashboard/regional` | `dashboard/regional/page.tsx` |
|| `/dashboard/validator/audit` | `dashboard/validator/audit/page.tsx` |
|| `/dashboard/validator` | `dashboard/validator/page.tsx` |
|| `/dashboard/validator/map` | `dashboard/validator/map/page.tsx` | Validator operational map with status filters |
|| `/home` | `home/page.tsx` | Authenticated Operations tab label for all sidebar roles; route path unchanged. `/home` renders a split Operations console: a 70% operational map paired with a 30% operations/report panel on desktop and a map-first stacked layout on mobile. National Validators can create operations with optional linked civilian reports, mark active operations `Keep overnight`, run the manual Reset Day archive flow, switch to the read-only Archived board, and restore archived operations by choosing a fire status. Regional Encoders, National Analysts, and System Administrators see linked report details read-only (no link/unlink/reset/restore controls). The `linkable-reports` search endpoint is `NATIONAL_VALIDATOR`-only. |
| `/incidents/[id]` | `incidents/[id]/page.tsx` |
| `/incidents/create` | `incidents/create/page.tsx` |
| `/incidents/import` | `incidents/import/page.tsx` |
| `/incidents/new` | `incidents/new/page.tsx` |
| `/incidents` | `incidents/page.tsx` |
| `/incidents/triage` | `incidents/triage/page.tsx` | Phase 2 civilian triage queue using `/api/triage/queue`, claim, cluster inspection, and terminal actions. The page is a map-first spatial triage workspace with a civilian triage canvas, investigation board, ranked queue fallback, and explicit `Inspect / Act` transition into the modal. The inspection modal at `components/triage/` is a large guarded action console with spatial panel, report evidence panel, and action rail. Terminal / Correct / Split / Merge / Activity behavior keeps two-step destructive confirmation, citizen-message previews, and the no-commit-keyboard-shortcut policy; see `frontend/validator-triage-shortcuts` and `operations/civilian-triage-hci-polish`. |
| `/login` | `login/page.tsx` | Employee-facing app login page. Do not place app pages under `/auth/*`; nginx reserves `/auth/` for Keycloak. |
| `/` | `page.tsx` | Public civilian emergency report form. Includes the safety-first report flow, in-memory `PhotoUpload` selection during the details step, and post-submit online photo attachment with submitted-screen retry/error status. Successful submissions expose the server-issued secure tracking URL (`/tracking/v2/{report_id}/{tracking_token}`) rather than a device-ID lookup path. |
| `/profile` | `profile/page.tsx` | Profile editing includes email/login-identity changes with current-password field, contact-number validation aligned to `^09\\d{9}$`, and warning/error display for backend partial profile-update responses. |
| `/tracking` | `tracking/page.tsx` | Compatibility landing page for public tracking. It no longer accepts report-ID lookup; instead it offers the caller's last stored secure tracking link when available and otherwise explains that tracking requires the exact secure URL. |
| `/tracking/v2/[report_id]/[tracking_token]` | `tracking/v2/[report_id]/[tracking_token]/page.tsx` | Capability-token public tracking page. Reads the safe projection from `GET /api/civilian/reports/{report_id}/track/{tracking_token}` and does not expose civilian coordinates or PII. |
| `/community` | `community/page.tsx` | Public Community Safety Hub with urgent notices, plain-text published content cards, language selection, filtering, and accessible loading/error/empty states. |
| `/admin/community` | `admin/community/page.tsx` | SYSTEM_ADMIN presentation-gated plain-text CMS editor with draft lifecycle actions; backend remains authoritative. |
| `/community/[slug]` | `community/[slug]/page.tsx` | Shareable public plain-text community content detail route. |
| `/contributor` | `contributor/page.tsx` | Authenticated CIVILIAN_REPORTER dashboard with private trust summary, monthly activity, and paginated report history. |

## UI Surface Clusters
- Auth/profile: `/login`, `/callback`, `/profile`, auth API routes. `/auth/login` is not a Next.js route; nginx redirects the exact legacy path to `/login`, while `/auth/` remains the Keycloak proxy namespace. Post-login routing uses `src/frontend/src/lib/roleRedirect.ts`: encoder roles land on `/dashboard/regional`, validator roles land on `/dashboard/validator`, system admins on `/admin/system`, and analysts on `/dashboard/analyst`; saved idle-session redirects are preserved only for specific same-origin workflow URLs, while generic `/home` or `/dashboard` redirects fall back to the role dashboard.
- Incident entry/import: `/incidents/*`, `/afor/*`, regional dashboard pages.
- Validation: `/dashboard/validator`, `/dashboard/validator/audit`, `/dashboard/validator/map`, `/incidents/triage`.
  - `/dashboard/validator/map` is the operational map with status filters (VERIFIED/PENDING/REJECTED), backed by `GET /api/public/clusters` for the public view and `GET /api/validator/operational-map` for the authenticated operational view.
- Regional encoder: `/dashboard/regional` defaults its incident list to Today by Date Modified, renders Today, Specific Date, and result sets of 6 or fewer incidents as richer cards with status-coloured 1px borders, exposes date-range controls plus an always-visible calendar picker that filters by modified date, and keeps activity-log access in the sidebar. Manual-entry draft autosave in `IncidentForm.tsx` is per authenticated user (`wims:incident_draft:{user.id}`), starts only after actual user input, and clears the legacy global draft key on discard/submit so first-login blank forms do not show restore banners. The summary cards show Total This Week plus category/wildland counts, and the rejected alert can be dismissed or can bypass date/classification filters to show all rejected incidents. `/dashboard/regional/incidents/[id]` uses a formal report-style read-only detail page with a compact header, non-status summary panel, larger animated desktop vertical dot section navigation fixed against the right viewport margin, grouped softened section cards, compact affected-count cells, cleaner tables, explicit 24H time indicators, and unchanged online edit/delete/withdraw/submit/map behavior. Pending-sync local IDs render from IndexedDB on the same route and support local view/edit/delete before sync.
- Shared authenticated shell: `components/Sidebar.tsx`, `Header.tsx`, and `LayoutShell.tsx` label `/home` as Operations, put role dashboards first for encoder/validator users, and no longer render the global sync status banner above every authenticated page. Global app CSS applies a 90% browser zoom baseline through `src/app/globals.css`.
- Analytics/reporting: `/dashboard/analyst`, `/dashboard/analyst/[workflow]`, `/dashboard/analyst/incidents/[id]`, `/dashboard/analyst/incidents/[id]/wildland`, `/`, `/tracking`. The sidebar now has an explicit `NATIONAL_ANALYST` navigation section pointing to `/dashboard/analyst`, dedicated analyst workflow routes, and `/profile`; analyst incident list/drawer/detail routes are implemented as read-only surfaces. The dashboard now includes the side-column heatmap layout, prominent filter bar, Recharts analytics panels, CSV/PDF/Excel export preview modal with full column label parity, active-filter export download flow with descriptive date-range filenames, and workflow launch cards. Top-N response-time rows show sample context (`metric_count` of `incident_count`) so averages can be reconciled against the Incident Analysis Set when some incidents lack response-time data, and dashboard Top-N metric/dimension selectors immediately refresh the ranking with the selected control values. `/dashboard/analyst/[workflow]` currently supports `comparative`, `heatmap`, `trends`, `response-time`, `top-n`, and `incident-explorer`, each with shared filters, export preview actions, a verified incident table with rows-per-page selector (25/50/100/250), and action-oriented "Check all on page" / "Uncheck all on page" labels. The analyst detail page and drawer both have a copy-incident-ID button. Phase 1 workflow selection is implemented with `sessionStorage` transfer IDs, selected-set handoff, local reset, persistent row selection across pagination, selected-set labels, and a 100-row Incident Explorer table. Workflow transfer hydration is keyed by the concrete `transfer` query value and the evidence table mounts only after hydration, preventing selected-set loops between analyst-list calls with and without `incident_ids`.
- Administration/security: `/admin`, `/admin/system`, `/admin/monitoring`, `/admin/anomalies`, `/admin/breach`.
  - **Auth loading guards** (#358): Monitoring, anomalies, and breach pages show a neutral loading state while auth resolves, then show "Access restricted" only for confirmed non-admin roles. System page already had this pattern.

## Related
- [[backend/api-route-map]]
- [[concepts/frs-module-map]]
