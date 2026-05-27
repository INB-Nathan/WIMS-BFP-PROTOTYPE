---
title: Frontend Route Map
created: 2026-05-14
updated: 2026-05-27
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
| `/admin/system` | `admin/system/page.tsx` |
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
| `/dashboard/regional/incidents/[id]` | `dashboard/regional/incidents/[id]/page.tsx` |
| `/dashboard/regional` | `dashboard/regional/page.tsx` |
| `/dashboard/validator/audit` | `dashboard/validator/audit/page.tsx` |
| `/dashboard/validator` | `dashboard/validator/page.tsx` |
| `/home` | `home/page.tsx` | Authenticated Operations tab label for all sidebar roles; route path unchanged. |
| `/incidents/[id]` | `incidents/[id]/page.tsx` |
| `/incidents/create` | `incidents/create/page.tsx` |
| `/incidents/import` | `incidents/import/page.tsx` |
| `/incidents/new` | `incidents/new/page.tsx` |
| `/incidents` | `incidents/page.tsx` |
| `/incidents/triage` | `incidents/triage/page.tsx` | Phase 2 civilian triage queue using `/api/triage/queue`, claim, cluster inspection, and terminal actions. |
| `/login` | `login/page.tsx` | Employee-facing app login page. Do not place app pages under `/auth/*`; nginx reserves `/auth/` for Keycloak. |
| `/` | `page.tsx` | Public civilian emergency report form. Submitted and updated reports link to `/tracking?id=<report_id>` for status checks. |
| `/profile` | `profile/page.tsx` |
| `/tracking` | `tracking/page.tsx` | Public report status/tracking guidance with `?id=<report_id>` lookup and notification opt-in. |

## UI Surface Clusters
- Auth/profile: `/login`, `/callback`, `/profile`, auth API routes. `/auth/login` is not a Next.js route; nginx redirects the exact legacy path to `/login`, while `/auth/` remains the Keycloak proxy namespace.
- Incident entry/import: `/incidents/*`, `/afor/*`, regional dashboard pages.
- Validation: `/dashboard/validator`, `/dashboard/validator/audit`, `/incidents/triage`.
- Shared authenticated shell: `components/Sidebar.tsx`, `Header.tsx`, and `LayoutShell.tsx` label `/home` as Operations, put role dashboards first for encoder/validator users, and no longer render the global sync status banner above every authenticated page.
- Analytics/reporting: `/dashboard/analyst`, `/dashboard/analyst/[workflow]`, `/dashboard/analyst/incidents/[id]`, `/dashboard/analyst/incidents/[id]/wildland`, `/`, `/tracking`. The sidebar now has an explicit `NATIONAL_ANALYST` navigation section pointing to `/dashboard/analyst`, dedicated analyst workflow routes, and `/profile`; analyst incident list/drawer/detail routes are implemented as read-only surfaces. The dashboard now includes the side-column heatmap layout, prominent filter bar, Recharts analytics panels, CSV/PDF/Excel export preview modal, active-filter export download flow, and workflow launch cards. `/dashboard/analyst/[workflow]` currently supports `comparative`, `heatmap`, `trends`, `response-time`, `top-n`, and `incident-explorer`, each with shared filters, export preview actions, and the verified incident table. Phase 1 workflow selection is implemented with `sessionStorage` transfer IDs, selected-set handoff, local reset, persistent row selection across pagination, selected-set labels, and a 100-row Incident Explorer table.
- Administration/security: `/admin`, `/admin/system`.

## Related
- [[backend/api-route-map]]
- [[concepts/frs-module-map]]
