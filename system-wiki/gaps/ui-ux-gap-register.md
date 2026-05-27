---
title: UI/UX Gap Register
created: 2026-05-14
updated: 2026-05-27
type: gap
tags: [wims-bfp, gap, ui-ux, needs-verification]
sources: [raw/ui-ux, ui-ux/evaluation-loginpage-keycloaksso.md, ui-ux/evaluation-system-admin-hub.md, ui-ux/evaluation-national-analyst.md, src/frontend/src/components/Sidebar.tsx, src/frontend/src/app/dashboard/regional/page.tsx, src/frontend/src/app/dashboard/validator/page.tsx]
status: needs-review
---

# UI/UX Gap Register

UI/UX improvement gaps identified during user desk-check evaluations (2026-05-14). Functional/auth bugs are in [[gaps/functional-bug-register]].

## Login Page + Keycloak SSO (`/login`)
| Issue | Detail | Status |
|---|---|---|
| Sign-in container misalignment | Hero section and sign-in form are vertically stacked/misaligned on desktop | Needs implementation |
| Hero icon loss on Keycloak redirect | After Keycloak redirect, hero illustration/icon disappears | Needs implementation |
| TOTP digit-separation UX | 6-box TOTP input with auto-advance and backspace behavior; no visual digit grouping | Needs implementation |

Source: [[ui-ux/evaluation-loginpage-keycloaksso]]

## System Admin Hub (`/admin`)
| Issue | Detail | Status |
|---|---|---|
| Linear vertical flow | Cards stacked vertically — wastes horizontal space; should use grid/HCI card layout | Needs implementation |
| Missing M9 metrics | No VPS usage, container status, PWA sync status, AI model latency, DB query latency cards | Needs implementation |
| Technology heartbeat charts | No live health charts for monitored components | Needs implementation |
| Tabbed Activity & Governance | Activity log and governance controls should be tabbed, not separate pages | Needs implementation |
| Region selector UX | Uses increment/decrement instead of dropdown populated from `ref_regions` | Needs implementation |
| No pagination | Admin hub lists (users, incidents) lack pagination controls | Needs implementation |
| No full-text filter/search | No search bar for filtering lists | Needs implementation |
| Regional heatmap missing on `/home` | Per-role heatmap not rendered for any role | Needs implementation |
| No system-wide announcement feature | No banner/toast for global announcements visible on `/home` | Needs implementation |
| Configuration Management (M9.c) | No UI for setting M9 monitoring thresholds | Needs implementation |
| Modal consolidation | Excessive modals; should redirect to detail pages instead | Needs implementation |

Source: [[ui-ux/evaluation-system-admin-hub]]

## Home Page (`/home`)
| Issue | Detail | Status |
|---|---|---|
| Sidebar label says Home | `/home` remains the route, but the authenticated sidebar and breadcrumbs should present it as Operations | Fixed in code; needs browser verification |
| Missing regional heatmap | Per-role heatmap not rendered for any role | Needs implementation |
| No system-wide announcement feature | No banner/toast for global announcements | Needs implementation |

## Regional Encoder + National Validator Dashboards
| Issue | Detail | Status |
|---|---|---|
| Dashboard not first in role navigation | Encoder/validator sidebars showed Home before role dashboards and used role-prefixed dashboard labels | Fixed in code; needs browser verification |
| Synced indicators too prominent | Global `SyncStatusBar` and regional local synced badge competed with dashboard content | Fixed in code; needs browser verification |
| Regional incident row discoverability | Regional rows were clickable but discoverability depended on helper text | Fixed in code with keyboard-focusable rows and delayed "Click to view" hover/focus hint; needs browser verification |
| Validator View/Archive repetition | Validator queue used a generic View button beside row actions and prominent Archive controls | Fixed in code with row click-to-view, delayed "Click to view" hint, and quieter finalized Archive action; needs browser verification |
| Persistent inline click hints | Delayed inline "Click to view" hints could linger and take table space | Fixed in code with delayed floating bubbles that hide on mouse movement/leave; needs browser verification |
| Validator status filter scanability | Validator used a native status dropdown and hid pending workload urgency | Fixed in code with All/Pending/Accepted/Rejected quick chips, date-range/date-basis dropdowns, and a pending-only red indicator; needs browser verification |
| Regional recent workload visibility | Regional list did not default to current-day workload or provide richer today context | Fixed in code with Today-by-modified default, date-range/date-basis dropdowns, API date bounds, and Today incident cards; needs browser verification |
| Regional Today card density/readability | Today cards needed tighter pairings, clearer label/value hierarchy, and stronger affected-count emphasis | Fixed in code with dark-red labels, paired caller/classification rows, district/city separation, compact last-modified header, and emphasized count tiles; needs browser verification |
| Regional Today card visual density | Incident cards were visually cramped and overused red uppercase labels | Fixed in code with muted labels, clearer primary/secondary hierarchy, roomier card padding, grouped sections, subtler hover state, and calmer affected-count chips; needs browser verification |
| Seeded incidents in encoder workload | Deterministic analyst seed incidents appeared in regional encoder dashboard data | Fixed in code by filtering `AFOR-SEED-*`/`SEEDED` import batches from regional encoder list and stats; needs data verification |
| Category summary mismatch | Vehicular/transportation incidents could appear in rows while dashboard cards showed 0 due to alias mismatch | Fixed in code by aggregating `VEHICULAR` and `TRANSPORTATION` aliases in regional/validator cards; needs browser verification |
| Deleted drafts inflating rejected workload | Legacy/inconsistent deleted draft rows could leak into rejected workload indicators | Fixed in code by excluding `DELETED_DRAFT` history rows from regional status summary; needs data verification |
| Manual incident date ergonomics | Create/edit form required manually picking today's incident date | Fixed in code with a Set to today shortcut using the Asia/Manila calendar date; needs browser verification |

## National Analyst Dashboard (`/dashboard/analyst`)
| Issue | Detail | Status |
|---|---|---|
| Heatmap aspect ratio wrong | Wide full-width heatmap; should be tall/portrait and side-positioned | Fixed in code; needs browser verification |
| Filter bar sizing | Filters should be larger and more prominent than "All Synced" badge | Fixed in code; needs browser verification |
| No incident container/list | No dedicated panel for individual incidents | Fixed in code; needs UI verification |
| Side panel non-functional | Incident detail side panel redirects back to dashboard | Fixed in code; needs UI verification |
| Filter missing columns | Filters do not cover all FRS M5.a.ii required fields (date range, casualty severity, property damage, location) | Core M5 filters fixed in code; wildfire-specific filters deferred |
| Export has no preview container | Export PDF/Excel buttons export immediately without a preview/filters container | Fixed in code; needs browser verification |
| Top municipalities view missing | FRS M5.a.iii requires "Top 10 municipalities" analytics view | Fixed in code; needs browser verification |
| Average response time by region missing | FRS M5.a.iii requires "Average response time by region" view | Fixed in code; needs browser verification |
| Analyst sidebar missing | No explicit `NATIONAL_ANALYST` section in `Sidebar.tsx` | Fixed in code; needs UI verification |
| Export backend incomplete | PDF/XLSX/download/audit backend infrastructure missing | Fixed in code; verify Celery retention/cleanup before production |
| Analyst detail/wildland routes missing | No read-only analyst full-page incident detail or wildland detail route | Fixed in code; needs UI verification |
| Dashboard scanability and incident-list failure state | Dashboard did not provide enough at-a-glance context, and the incident list surfaced raw 500 text during backend failures | Fixed in code; needs browser verification |
| Dedicated analyst workflow pages missing | Major dashboard functions had no focused pages for deeper controls, exports, calculations, and incident evidence | Fixed in code via `/dashboard/analyst/[workflow]`; needs browser verification |
| Incident list selection/export workflow | Incident list should be prominent, persist selected records across pagination, support selected-record CSV/PDF column-selection export, and provide separate full AFOR export with all AFOR fields; multi-incident full PDF should be one file with one incident per page/section | Phase 1 UI/selection fixed in code; Phase 2 modular export backend remains |

Source: [[ui-ux/evaluation-national-analyst]]

## National Analyst UX — Iteration 2 Review (2026-05-19)

Code-level HCI/UX issues confirmed by source inspection during a National Analyst perspective walkthrough. See GitHub issues [#111](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/111)–[#120](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/120).

| # | GitHub | Severity | Issue | Detail |
|---|---|---|---|---|
| 1 | [#111](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/111) | Critical | Phantom `barangay_name` column | `barangay_name` in `ALL_COLUMNS` (export picker) and `COLUMNS` (table) — always empty/N/A since barangay purge; trust-destroying for analysts |
| 2 | [#112](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/112) | Critical | `region_id` raw integer in exports | Every export row shows `4`, `5`, `17` instead of `Region IV-B (CALABARZON)`; `region_name` missing from `ALLOWED_EXPORT_COLUMNS` backend |
| 3 | [#113](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/113) | High | Export default columns low-signal | Default `slice(0, 6)` includes `barangay_name` and `region_id`; misses `alarm_level`, `general_category`, `estimated_damage_php` |
| 4 | [#114](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/114) | High | "Analyze selected" ignored by workflows | `selectedIncidentIds` passed to URL but receiving workflow re-queries by filter scope only; selection meaningless for heatmap/trends/top-N |
| 5 | [#115](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/115) | Medium | No copy incident ID affordance | Incident ID displayed as plain text in drawer and detail page; no clipboard copy button for cross-referencing |
| 6 | [#116](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/116) | Medium | Export filename opaque | All exports named `wims-bfp-analyst-export.csv` regardless of date range or format |
| 7 | [#117](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/117) | Medium | "Unselect page" label confuses | Button describes current state, not the action; leads to accidental mass-deselection |
| 8 | [#118](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/118) | Medium | Top-N missing `damage_cost` metric | Cannot rank municipalities by economic impact; only `incidents`, `response_time`, `casualties` |
| 9 | [#119](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/119) | High | Export picker missing 13 fields | `verification_status`, `created_at`, `fire_origin`, `extent_of_damage`, `structures_affected`, `households_affected`, `families_affected`, `individuals_affected`, `vehicles_affected`, `total_gas_consumed_liters`, `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`, `fire_station_name` absent from frontend `ALL_COLUMNS` and `COLUMN_LABELS` |
| 10 | [#120](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/120) | Medium | No rows-per-page selector | Incident list hardcoded to 25/100 rows; no user-control at national scale |

**Also noted (no GitHub issue yet):**
- `barangay_name` in `AnalystIncidentList` drawer `SummaryRow` — always shows "N/A"
- Sort state not persisted to URL — resets on navigation back to incident list
- Filter section labeled "Workflow Filters" in `[workflow]/page.tsx` vs "Analysis Filters" in dashboard — inconsistent naming

## Related
- [[ui-ux/evaluation-loginpage-keycloaksso]]
- [[ui-ux/evaluation-system-admin-hub]]
- [[ui-ux/evaluation-national-analyst]]
- [[concepts/frs-module-map]]
- [[gaps/functional-bug-register]]
