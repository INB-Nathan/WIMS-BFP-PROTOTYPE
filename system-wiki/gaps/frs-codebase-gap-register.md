---
title: FRS Codebase Gap Register
created: 2026-05-14
updated: 2026-05-19
type: gap
tags: [wims-bfp, gap, frs, needs-verification]
sources: [raw/frs, raw/codebase/codebase-snapshot-2026-05-14.md]
status: needs-review
---

# FRS Codebase Gap Register

This register prevents agents from hallucinating completion. A module is not complete just because a route or table exists.

## High-Risk Verification Targets
- Immutable record hashing: verify `data_hash` covers all required incident/provenance fields.
- Analytics sync on verification/correction: verify transaction boundaries and error handling.
- Analytics geography: `analytics_incident_facts` has `municipality_name`/`province_name` via `28_analytics_geography_denorm.sql`; verify deployed DBs migrated and backfilled.
- National Analyst: Phase 1 workflow UI/selection done; Phase 2 modular selected/full-AFOR export backend pending.
- Export pipeline: CSV/PDF/XLSX writers + `GET /api/analytics/export/{task_id}` done; verify Celery result retention and file cleanup before prod.
- Analyst drill-down: `/api/incidents/analyst-list|/{id}|/{id}/wildland` done; verify seeded wildland data and browser flows before prod.
- RLS enforcement: verify role-region scoping through helpers and policies.
- Public DMZ: verify unauthenticated route has rate limiting/input validation.
- Notifications: PR #106 FCM opt-in + status dispatch done; verify SSE/Redis/email end-to-end behavior against M13. Rotate any committed service-account key before prod.
- Offline-first: verify IndexedDB encryption/sync semantics against M2.
- M9 System Monitoring: NOT yet implemented as a complete module — PR #103 adds backend monitoring pieces, but dashboard UI, 60s refresh, and full-text log search remain gaps.
- TOP-N barangay: OPTIONAL — `31_barangay_geometry.sql` adds geometry column + GiST; `_reverse_geocode_barangay` hooks exist; deferred until vetted polygon seed exists. Use municipality/fire-station/region for hotspot ranking.
- Selected-set analytics: Phase 2 backend module — aggregate charts remain filter-scoped; selected IDs drive table/export behavior only.

## FRS Gap Closures (May 2026 batch)
- **M6-G (XAI Narrative Generation)**: CLOSED — PR #104: narrative endpoint, batch generation, `ai_narrative` columns, Qwen2.5-3B via Ollama.
- **M6-F (Suricata IDS Integration)**: CLOSED — PR #105: HIGH severity auto-incident creation, duplicate guard, `security_alert_id` FK, service account pre-provisioned.
- **M9 (System Monitoring)**: PARTIAL — PR #103 adds Prometheus `/metrics`, admin endpoints, and worker heartbeat. Dashboard UI and full-text log search remain gaps.
- **M4 (Incident Workflow)**: CLOSED — PR #102: AFOR import fixes, field persistence, validator audit trail, VALIDATOR role routing, immutable rule fix.

## Related
- [[concepts/frs-module-map]]
- [[security/security-baseline]]
- [[gaps/ui-ux-gap-register]]
- [[gaps/functional-bug-register]]
