---
title: FRS Codebase Gap Register
created: 2026-05-14
updated: 2026-05-29
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
- Civilian Reporting Phase 2: duplicate suggestion, durable singleton cluster materialization, validator claim/activity, terminal actions, correction, split/merge APIs and UI controls, timeout task, append timeline endpoint/UI, station hotline fallback, disabled legacy promotion/public DMZ, validator activity/history panel, map-based cluster inspection, merge-candidate discovery (backend + API client + UI), navigation shortcut help (Esc close, R refresh), and Phase 2 validator queue UI are implemented. **Open gaps:** (1) step ordering — `page.tsx` defaults `step = 'context'`, docs require safety as first interactive step; (2) success screen emergency boundary — code shows 911/call-now box only for `isLifeSafety`, docs require it for ALL submissions; (3) tracking page emergency boundary — code shows 911 guidance only for `REJECTED_*` statuses, docs require it for ALL statuses including PENDING/UNDER_REVIEW/LINKED/ACTIONED; (4) submit error handling — monolithic catch block with generic error message, no 911 boundary, no error-type-specific guidance (validation/location vs rate limit vs network); (5) context challenge prompts — docs require "Is this current location where the fire is?" yes/no challenge when user selects SECONDHAND after using current GPS, and a confirmation prompt when selecting NEARBY after current GPS; code does not implement either challenge; (6) station phone fallback labeling — if `nearest_station_phone` is the backend fallback `911`, it must be labeled as "Emergency Number" not as "Nearest BFP Station"; code renders station name + phone as-is without this semantic distinction; (7) life-safety secondary affordance — docs require the category step for life-safety to show both a primary "Send now" that submits immediately with minimum fields and a secondary "Add details if safe" that opens optional details while keeping "Send now" as the primary action within that screen; current code only has a single "Fast Submit" button with no "Add details" affordance before it; (8) review step 911 boundary — docs require the 911 emergency boundary on every pre-submit screen including the non-life-safety review step; current code renders a bilingual "Do not move closer" notice but no 911 guidance between the data summary and the submit CTA; (9) calm emergency landing block — docs require `/report` to start with dominant 911 guidance (call 911 if in immediate danger, move away from smoke/fire, do not get closer to take photos) rendered as a passive static block before the first interactive step; code starts directly with the interactive step selection with no initial emergency guidance block; (10) GPS-denied/timeout 911 boundary — docs require 911 guidance to persist throughout the entire flow for life-safety reports and require location/submission failure microcopy to include 911 reminders; when GPS is denied or times out (lines 709-720), the location error panel shows only a "Try again / Subukan ulit" retry button with no 911 call-to-action, even when the user is on a life-safety path. The panel must display a bilingual 911 boundary reminder regardless of whether the user is on the life-safety path. Remaining verification target: full browser E2E smoke test for /report, /report/tracking, /incidents/triage.
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
- **M8d (HITL Structured Decision Audit Log)**: CLOSED — `39_hitl_decision.sql` adds `hitl_decision JSONB` to `security_threat_logs`; `PATCH /admin/security-logs/{log_id}` accepts structured `{ action, note }` with three-button HITL UI (Confirm Threat / False Positive / Request More Info); decision logged as JSONB with `reviewed_by` and `reviewed_at`; `resolved_at` set only on terminal decisions (CONFIRM_THREAT, FALSE_POSITIVE); `REQUEST_MORE_INFO` leaves `resolved_at` null.
- **M2b (Offline Encryption — AES-256-GCM)**: CLOSED — `offlineStore.ts` encrypts IndexedDB queue items with AES-256-GCM via Web Crypto API; per-user key stored in `crypto-keys` IndexedDB store, derived from user secret via PBKDF2; transparent encrypt on `addToQueue`/`updateQueuedIncident`, transparent decrypt on `getQueuedIncident`; `markSynced` operates on raw record (no payload read needed); closes ISSUE#139.
- **M2b (Offline CRUD — IndexedDB Queue Lifecycle)**: CLOSED — `offlineStore.ts` provides `getQueuedIncident`, `updateQueuedIncident`, `deleteQueuedIncident`, `markSynced`, `getPendingIncidents`; `syncEngine.ts` `syncPendingIncidents` POSTs pending items to backend, marks synced on success, returns `SyncResult { synced, failed, errors }`; closes ISSUE#140.
- **M2c (Sync Toast Notifications)**: CLOSED — `useAutoSync.ts` `doSync()` dispatches `toast.success`/`toast.warning`/`toast.error` based on `SyncResult` counts; `sonner` added to `package.json`; `<Toaster />` mounted in `layout.tsx`; closes ISSUE#142.
- **M4b (Verification Audit Hash + Sync Status)**: CLOSED — `40_verification_audit_fields.sql` adds `data_hash TEXT` (SHA-256) and `sync_status TEXT` to `wims.incident_verification_history`; trigger `_insert_incident_verification_history` computes hash on insert; stored procedure `verify_incident_command` records sync status; closes ISSUE#145.

## Related
- [[concepts/frs-module-map]]
- [[security/security-baseline]]
- [[gaps/ui-ux-gap-register]]
- [[gaps/functional-bug-register]]
