---
title: PR QA — May 2026 Batch (PRs #102–#105)
created: 2026-05-17
updated: 2026-05-17
type: operations
tags: [wims-bfp, pr-qa, agent-routing]
sources: [pr-102, pr-103, pr-104, pr-105]
status: verified
---

# PR QA — May 2026 Batch (PRs #102–#105)

## Summary

Four PRs merged onto master in sequence. All four approved after systematic QA. Key finding: PR #105's service account concern was resolved — `svc_suricata` is already provisioned in `03_users.sql`.

| PR | Author | Issue | Domain | Verdict |
|----|--------|-------|--------|---------|
| [[pr-qa/pr-102-m4-postfix-afour-persistence-audit-ux]] | laqqui | — | Regional/AFOR/audit | ✅ APPROVE |
| [[pr-qa/pr-103-system-monitoring-prometheus]] | orljorstin | #70 | Infrastructure/monitoring | ✅ APPROVE |
| [[pr-qa/pr-104-xai-incident-narratives]] | orljorstin | #69 | Analytics/XAI | ✅ APPROVE |
| [[pr-qa/pr-105-suricata-auto-incident]] | orljorstin | #68 | Security/IDS | ✅ APPROVE |

## Merge Order

Recommended order to avoid import conflicts in shared files (`admin.py`, `celery_config.py`):

```
1. PR #102 (laqqui) — M4 patch, minimal file overlap
2. PR #104 (orljorstin) — adds to analytics.py, ai_service.py, tasks/narrative.py
3. PR #103 (orljorstin) — adds to admin.py (monitoring routes), utils/metrics.py, tasks/monitoring.py
4. PR #105 (orljorstin) — adds to admin.py (XAI routes), suricata_ingestion.py, celery_config.py
```

PRs #104 and #103 both add routes to `admin.py` but in different sections. PR #105's additions to `admin.py` are distinct from #103's monitoring routes.

## Cross-PR Shared Changes

All four PRs share a common base of changes (commits from `f065468 feat(#47,#46)...` through `bea7325 feat(analytics)...`). These include:
- National analyst dashboard frontend (900+ lines of new pages and components)
- Seed incidents migration (`29_seed_incidents.sql`)
- Barangay geometry reversal (`31_barangay_geometry.sql`)
- Updated Docker Compose with new services (Ollama)
- Analytics read model updates
- Export task hardening

The shared base represents the analyst dashboard delivery (PRs #100–#101 equivalent). PRs #102–#105 are incremental features layered on top.

## New Migrations in This Batch

| Migration | PR | Purpose |
|-----------|----|---------|
| `29_fix_immutable_rule.sql` | #102 | Allow VERIFIED→REPLACED transition for validator archival |
| `29_seed_incidents.sql` | #102 | Seed 12 deterministic verified incidents for analytics demo |
| `31_barangay_geometry.sql` | #102 | Reverse barangay geometry column (not needed) |
| `32_worker_heartbeat.sql` | #103 | Celery worker liveness tracking table |
| `33_incident_ai_narrative.sql` | #104 | `ai_narrative` + `ai_narrative_confidence` columns |
| `34_security_incident.sql` | #105 | `security_alert_id` FK from fire_incidents to threat logs |

All idempotent. Total: 6 new migrations.

## New API Endpoints

| Method | Path | PR | Auth |
|--------|------|----|------|
| `GET` | `/metrics` | #103 | None (Prometheus scraping) |
| `GET` | `/api/admin/monitoring/workers` | #103 | SYSTEM_ADMIN |
| `GET` | `/api/admin/monitoring/system` | #103 | SYSTEM_ADMIN |
| `POST` | `/api/analytics/incidents/{id}/narrative` | #104 | ANALYST_OR_ADMIN |
| `POST` | `/api/analytics/incidents/batch-narratives` | #104 | ANALYST_OR_ADMIN |

## New Celery Tasks

| Task | PR | Schedule | Purpose |
|------|----|----------|---------|
| `tasks.monitoring.worker_heartbeat` | #103 | Every 30s (beat) | Worker liveness tracking |
| `tasks.narrative.batch_generate_narratives` | #104 | On-demand | Batch AI narrative backfill |

## New Test Files

| File | PR | Tests | Type |
|------|----|-------|------|
| `test_system_monitoring.py` | #103 | 7 | Unit (mocked) |
| `test_incident_narrative.py` | #104 | 8 | Integration |
| `test_suricata_auto_incident.py` | #105 | 10 | Unit (mocked) |

## FRS Gap Closures

This batch closes 4 of the FRS/codebase gap targets:

- **M6-G (XAI Narrative Generation)**: PR #104 — `POST /api/analytics/incidents/{id}/narrative`, batch endpoint, `ai_narrative` column
- **M6-F (Suricata IDS Integration)**: PR #105 — auto-incident creation, duplicate guard, `security_alert_id` FK
- **M9 (System Monitoring)**: PR #103 — Prometheus `/metrics`, worker heartbeat, system metrics admin endpoint (partial — admin-only, not in M9 dashboard UI)
- **M4 (Incident Workflow)**: PR #102 — AFOR import gaps, field persistence, audit trail fixes, VALIDATOR role routing, immutable rule fix

## QA Findings Summary

| Finding | PR | Severity | Status |
|---------|----|----------|--------|
| PR #102: VALIDATOR role 404 | #102 | Medium | Fixed in same PR |
| PR #102: Validator audit 500 error | #102 | High | Fixed in same PR |
| PR #102: Edited fields not persisting | #102 | High | Fixed in same PR |
| PR #103: `active_tasks` stub column | #103 | Low | Not fixed (acceptable) |
| PR #104: `asyncio.run()` in Celery task | #104 | Low | Not fixed (acceptable) |
| PR #104: Prompt injection risk | #104 | Low | Not fixed (internal model context) |
| PR #105: Service account FK concern | #105 | High | Resolved — account pre-provisioned in `03_users.sql` |

## Related Pages
- [[mocs/system-map]] — system-wide entry point
- [[operations/agent-routing-guide]] — which page to read before touching each subsystem
- [[gaps/frs-codebase-gap-register]] — updated with M6-F, M6-G, M9 gap closures
- [[backend/api-route-map]] — updated with new endpoints
- [[database/sql-init-files]] — updated with new migrations