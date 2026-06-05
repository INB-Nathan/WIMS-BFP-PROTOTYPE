---
title: Project Documentation & Scripts
created: 2026-05-16
updated: 2026-05-31
type: meta
tags: [wims-bfp, docs, scripts, changelog, architecture-docs, seed-data]
sources: [AGENTS.md, CLAUDE.md, docs/, scripts/]
status: draft
---

# Project Documentation & Utility Scripts

## `docs/` Directory

### `ARCHITECTURE.md`
Comprehensive system architecture reference. Documents the full stack: Next.js/React frontend, FastAPI/SQLAlchemy backend, PostgreSQL+PostGIS, Keycloak 24 auth (JWT/OIDC), Celery+Redis async, Ollama AI pipeline, Suricata IDS, Nginx edge gateway. Covers 9 Docker containers, data flow, auth/access control, session revocation via Redis, XAI pipeline (Suricata → Qwen2.5-3B), and RLS.

### `CHANGELOG.md`
Release notes v0.1.0 through v0.3.0 + unreleased. v0.1.0: Docker orchestration, OIDC PKCE auth, API routes. v0.2.0: CoreUI theme, AFOR XLSX parser, PWA sketch upload. v0.3.0: audit logging, session revocation, admin health dashboard, bulk triage. Unreleased: session management, JWT refresh, backchannel logout, PII encryption, wildland AFOR.

### `API_AND_FUNCTIONS.md`
Manually maintained endpoint reference. Lists backend FastAPI routes by module (auth, incidents, civilian, triage, admin, analytics, regional, ref) plus Next.js routes. Historical \"edge functions\" module noted as now calling FastAPI directly.

### `M4-PR.md`
M4 incident workflow PR documentation. Lists 5 beyond-spec systems: encoder audit trail, duplicate detection, archive/REPLACED status, AFOR reference numbers, regional RBAC with 18 encoder accounts. Documents 7 bug fixes and 12-step test plan.

### `M4-INCIDENT-WORKFLOW-DETAILS.md` (395 lines)
Detailed M4 implementation spec. Covers M4-A through M4-I: PostGIS incident creation, AFOR spreadsheet import, duplicate detection, draft save with 30-day expiry, validator queue, side-by-side diff, bulk approve, validator audit trail. Plus 5 beyond-spec enhancements.

### `VALIDATOR_WORKFLOW_CHANGELOG.md`
Technical change log for encoder-to-validator workflow. 7 file changes: VerificationStatus enum, verification_history model, get_national_validator dep, 2 new endpoints, migration SQL, seed updates, validator dashboard frontend. 5 acceptance criteria.

### `PR_m4_incident_workflow.md`
Earlier checkpoint PR noting M4-A and M4-E met, M4-B/F "mostly met". 10 gaps including cross-region behavior and status terminology issues.

### `feat-mod-4-import-spreadsheet.md`
PR for spreadsheet import + validator workflow. 9 changed files: Excel parser, search bar, incident detail fixes, queue/diff/decision endpoints, audit trail, DB migration, dashboard UI, seeding updates.

### `docs/agents/`
Per-repo configuration for Matt Pocock engineering skills. `issue-tracker.md` records GitHub Issues via `gh` as the tracker, `triage-labels.md` maps the five canonical triage roles to repository labels, and `domain.md` routes skills to `AGENTS.md`, `CLAUDE.md`, and `system-wiki/` instead of absent root `CONTEXT.md` / `docs/adr/` files.

### Root Agent Guidance
`AGENTS.md` and `CLAUDE.md` both carry the repository agent-skills routing block so Codex-style and Claude-style agents use the same GitHub Issues tracker, triage label vocabulary, and domain context sources.

### `PR_fix-looping-auth.md`
PR fixing Keycloak auth loop. Replaced shell DB bootstrap with SQL (00_keycloak_bootstrap.sql), added fallback username lookup, aligned realm roles, deterministic user IDs. Production hardening guidance.

### `PR_fix-bootstrap-and-admin-config.md`
PR fixing bootstrap ordering, encoder region assignment, and admin client config. Renamed SQL files for correct sort order, added the NCR encoder region assignment, added wims-admin-service OAuth2 client, bootstrap verify guard.

### `PR-rls-and-fixes.md`
PR notes for the encoder/validator page refactor and M15a RLS fix. The current version keeps the RLS summary technical, removes the previous plain-language RLS explanation block, and adds Codex-authored UI/auth fixes covering role dashboard redirects, user-scoped manual-entry draft restore, login alert placement, Keycloak OTP confirmation styling, MFA scroll containment, and AFOR Barangay tip alignment.

---

## `scripts/` Directory — 14 Files

### Database Seeding & Migration

| Script | Type | Purpose |
|---|---|---|
| `seed-dev-users.sh` / `seed-dev-users.ps1` | Shell/PowerShell | Seeds 22 Keycloak users + wims.users sync (18 regional encoders + test users). Waits for Keycloak, creates roles/users, sets passwords, UUID resolution |
| `seed-analytics-incidents.sh` / `seed-analytics-incidents.sql` | Shell/SQL | Populates 100 random VERIFIED incidents for analyst dashboard demos. Random PH locations, alarm levels, categories, dates within 90 days |
| `seed-suricata-alerts.sh` / `seed-suricata-alerts.sql` | Shell/SQL | Seeds 5 sample Suricata security alerts (Log4j, SSH brute, DGA, Nmap, C&C) with varied severity and XAI narratives |
| `reseed-reference-cities.sh` / `reseed-reference-cities.ps1` | Shell/PowerShell | Re-applies reference city/province data from `03_seed_reference.sql` idempotently |

### PSGC/Geography Data

No committed PSGC/barangay polygon loader exists. A proposed one-shot Docker loader was rejected on 2026-05-16 because it made local stack startup network-dependent and introduced invalid reference-data SQL. Current stable geography analytics use denormalized province/municipality fields.

### City Constants Generation

| Script | Type | Purpose |
|---|---|---|
| `gen_cities.py` | Python | Reads BFP AFOR Excel workbook, extracts region/province/city data, outputs TypeScript constant definitions for 12 regions |
| `gen_cities_output.ts` | TypeScript | Generated output: 12 TypeScript constants mapping provinces to city arrays for frontend dropdowns |

### Standalone Tools

| Script | Type | Purpose |
|---|---|---|
| `afor_preview.py` (524 lines) | Python | Standalone AFOR Excel preview tool. Implements full structural parser, outputs human-readable Markdown with section-by-section extraction. Flags empty fields with ⚠️. Depends only on openpyxl. Designed as guideline deliverable |
