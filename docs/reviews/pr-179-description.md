# PR #179 — feat/kanban-batch-1

**Branch:** `feat/kanban-batch-1`
**Base:** `master` @ `f221bfb`
**Size:** ~75 files, ~+4700 / −300 lines
**Date:** 2026-05-30

## Summary

Batch 1 of kanban-board issues plus post-review fixes and public-pages merge. 22 commits covering analyst UX, public map, TLS hardening, encryption expansion, SSE infrastructure, and ~12 bugfixes found during re-review + desk-check.

## Features

| Issue | Description |
|-------|-------------|
| #113 | Curated default export columns (9 fields) |
| #115 | Copy incident ID controls |
| #116 | Descriptive export filenames |
| #117 | Action-oriented select-page labels |
| #118 | damage_cost Top-N metric |
| #119 | Export column parity (frontend ↔ backend) |
| #120 | Rows-per-page selector (10/25/50/100) |
| #126-#135,#147 | Public Fire Report Areas map — civilian pressure clusters, BFP station markers, emergency services endpoint, polling/degraded behavior |
| #150 | Expanded AES-256-GCM encryption to narrative_report, casualty_details, estimated_damage_php |
| #153,#154 | Enforce TLS 1.3-only + ChaCha20-Poly1305 cipher suite |
| #175 | Real-time SSE notification infrastructure (Redis pub/sub, EventSource hook) |

## Post-Review Fixes (from re-review `docs/reviews/pr-179-re-review.md`)

| Finding | Fix |
|---------|-----|
| **B1 — SSE publishing dead from 5 sync endpoints** | Added `publish_incident_event_sync()` and `publish_verification_event_sync()` to `event_bus.py`. Replaced 5 dead `asyncio.get_running_loop()` + `except RuntimeError: pass` blocks with direct sync calls. Removed unused `import asyncio` from `admin.py` and `workflow.py`. |
| **B2 — Dead EmergencyPanel** | Removed unrendered component, unused state, dead useEffect, and unused imports from `PublicFireMapInner.tsx` (−79 lines). |
| **B3 — Dead no-op pii_dict** | Removed `if not pii_dict: pii_dict = {}` from `regional.py`. |
| **B4 — Dead Redis pool constants** | Wired `_REDIS_POOL_MAX_CONNECTIONS` into `aioredis.from_url()`, removed unused `_REDIS_POOL_SIZE`. |

## Additional Fixes (desk-check findings)

- **SSE frontend**: Replaced `EventSource.onmessage` with per-event-type `addEventListener` — backend emits named events (`event: incident.updated`) which bypass `onmessage` entirely.
- **Encryption plaintext leak**: NULL `narrative_report`/`casualty_details` in `incident_sensitive_details` and `estimated_damage_php` in `incident_nonsensitive_details` when encrypted blob is authoritative.
- **Dead pii_for_blob no-ops**: Removed identical dead reassignments in `incidents.py` and `commit.py`.
- **Redis backoff**: Added 30s cooldown to prevent per-request reconnect storms when Redis is unreachable. Distinguishes "never initialized" (sentinel) from "known-bad" (None).
- **status_filter validation**: Added regex validation against allowed `verification_status` values (DRAFT/PENDING/PENDING_VALIDATION/VERIFIED/REJECTED). Fixed empty-string gap (falsy but not None → no filter clause). Eliminated unused bind-parameter.
- **Test isolation**: Wrapped `app.dependency_overrides` in try/finally so assertion failures don't leak overrides to subsequent tests.
- **barangay dimension**: Added `barangay` to top-N route regex and `VALID_TOP_N_DIMENSIONS` column map.
- **Local nginx**: Added `docker-compose.override.yml` + `nginx.local.conf` for HTTP-only local dev (cherry-picked from `feat/public-pages-visual-unification`).

## Merged Branches

- `feat/public-pages-visual-unification` — public pages visual unification with `/fire-stations` style, NearbyPublicReportAreas component, civilian API + ref API expansions.

## Deferred (acknowledged gaps)

| # | Item | Status |
|---|------|--------|
| #127 | Cluster algorithm spec params (500m bucket, 10km, 1hr, min-3, cap-50) | Follow-up |
| #128 | Stale-if-error cache (serve-stale, 503 degraded) | Follow-up |
| #131 | Shared `fireLocation` state | Follow-up |

## Verification

- Backend: ruff check passes, Python AST parse passes on all modified files
- Frontend: TypeScript type-check passes on modified files
- Re-review: sub-agent three-axis review confirmed all B1-B4 resolved
- No schema migrations, no secrets, no auth/RBAC changes

## Commit Log

```
fed5d4b Merge branch 'feat/public-pages-visual-unification' into feat/kanban-batch-1
aa7b1e8 fix(nginx): add local dev config (HTTP-only) via docker-compose.override.yml
b853346 fix(analytics): add barangay to top-N dimension route regex and column map
31b9668 fix(test): wrap app.dependency_overrides in try/finally to prevent test leak
8eb581c fix(map): validate status_filter and fix unused bind-param / empty-string gap
338993d fix(map): add Redis connection backoff to prevent per-request reconnect storms
b336020 fix(encryption): NULL plaintext columns for fields routed to encrypted blob
4fa2473 fix: remove dead no-op pii_for_blob reassignments in incidents.py and commit.py
98aa063 fix(sse): frontend EventSource uses addEventListener for named SSE events
66c25b1 fix(sse): replace dead asyncio SSE publishing with sync functions + dead code removal
079413f fix(map): swap emergency services query from ref_cities to ref_fire_stations
dd18305 fix(map): emergency services query — join ref_regions via ref_provinces
3038df9 style: ruff format — 7 files reformatted
6f9968b fix(ci): resolve lint and parse errors
62bffc5 fix(review): address blocking findings from kanban-batch-1 review
2313a5e docs: update system wiki — new routes, gap register, security baseline
1c4d3b6 feat(#175): real-time SSE notification infrastructure
322e82c feat(#150): expand AES-256-GCM encryption to narratives, casualties, property damage
e23dfff feat(#153,#154): enforce TLS 1.3 + cipher suite hardening
b922cb9 feat(#118,#126-#135,#147): damage_cost metric + public map feature
0d7e416 feat(#113,#115,#116,#117,#119,#120): analyst UX QoL bundle
228f5cc feat: public pages visual unification with /fire-stations style
```
