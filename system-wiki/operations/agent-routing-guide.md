---
title: Agent Routing Guide
created: 2026-05-14
updated: 2026-07-13
type: operations
tags: [wims-bfp, agent-routing, implementation-map]
sources: [SCHEMA.md, index.md, .pi/skills/wims-wayfinder/SKILL.md, docs/agents/issue-tracker.md]
status: draft
---

# Agent Routing Guide

## Default Context Pack
Every WIMS-BFP agent touching this repo should read:
1. `AGENTS.md`
2. `system-wiki/SCHEMA.md`
3. `system-wiki/index.md`
4. [[mocs/system-map]]

## Route by Task
- Large, uncertain, multi-session planning: manually invoke `/skill:wims-wayfinder` to chart GitHub decision tickets before implementation decomposition. It requires batch confirmation for chart creation, uses append-only claim/map-writer comments, and promotes only separate fully specified implementation issues to `ready-for-agent`; read `.pi/skills/wims-wayfinder/SKILL.md` and `docs/agents/issue-tracker.md`.
- Auth/session/user admin: read [[security/security-baseline]], [[backend/api-route-map]], [[backend/services]] (keycloak_admin service), [[backend/utilities-and-tasks]] (audit, session), [[subsystems/admin-hub]], then `src/backend/api/routes/admin.py`, `sessions.py`, `user.py`, and frontend auth routes.
- Incident CRUD/offline/import: read [[concepts/frs-module-map]], [[backend/api-route-map]], [[frontend/route-map]], [[frontend/frontend-infrastructure]] (api.ts + components), [[database/sql-init-files]], [[subsystems/regional-dashboard]], then `regional.py`, `incidents.py`, offline/sync frontend libs.
- Validation/triage/duplicates: read [[backend/api-route-map]], [[backend/services]] (duplicate_detection), [[database/sql-init-files]] (RLS + IVH schemas), [[subsystems/validator-hub]], then `triage.py`, `regional.py`, duplicate detection service, and validator UI pages.
- Immutable records/audit/corrections: read [[security/security-baseline]], [[backend/utilities-and-tasks]] (audit), [[database/sql-init-files]] (17_immutable_records), [[gaps/frs-codebase-gap-register]], then immutable SQL/tests and verification endpoints.
|- Analytics/reporting: read [[frontend/route-map]], [[frontend/frontend-infrastructure]] (analytics components), [[backend/api-route-map]], [[backend/services]] (analytics_read_model), [[database/sql-init-files]] (analytics MVs + facts), then `analytics.py`, analytics SQL, analyst dashboard, report pages.
|- Public anonymous submission: read [[security/security-baseline]], [[architecture/infrastructure-config]] (rate limiting), [[gaps/frs-codebase-gap-register]], then `public_dmz.py`, `triage.py`, and public report UI pages.
|- Civilian reporting (Phase 2 tracking/append flow): read [[subsystems/civilian-reporting-phase2]], [[backend/api-route-map]], then `civilian.py`, capability-token tracking routes, tracking page compatibility flow, and the submitted-screen append path in the report page.
|- Reference data: read [[database/schema-overview]], [[database/sql-init-files]] (geography seeds), then `ref.py` and geography seed files.
- PR review (three-axis): run `/run-chain three-axis-review <PR_NUMBER>` to fetch the PR branch, run Standards/Spec/Quality reviewers, and post the report as a PR comment. Chain lives in `~/.pi/agent/chains/three-axis-review.chain.json` (user scope).
- Infrastructure/Docker/CI: read [[architecture/infrastructure-config]], [[architecture/pwa-tests-cicd]].
- Manual smoke testing and issue intake: read [[operations/manual-smoke-testing]] and `docs/operations/manual-smoke-tests.md`; convert independent failures into GitHub issues with evidence fields preserved.

## Delegation Rules
- Security-sensitive work gets explicit security review before merge.
- Do not mix opportunistic refactors with bug fixes.
- Do not route an agent the full repo if a subsystem context pack is enough.
- Do not treat this wiki as more authoritative than raw FRS or live code.
- Do not bypass an issue/PRD/spec/acceptance contract unless the agent states the deviation, gives a concrete reason, and the change materially improves correctness, safety, maintainability, or user value; otherwise follow the spec exactly or ask first.
