---
title: Manual Smoke Testing Runbook
created: 2026-06-15
updated: 2026-06-15
type: operations
tags: [wims-bfp, operations, ui-ux, hci, testing, frontend, admin, validation, analytics]
sources: [docs/operations/manual-smoke-tests.md, src/frontend/src/app/admin, src/frontend/src/app/dashboard/validator, src/frontend/src/app/dashboard/analyst]
status: draft
---

# Manual Smoke Testing Runbook

`docs/operations/manual-smoke-tests.md` is the team-facing runbook for role-based manual smoke testing before filing GitHub issues.

## Role Coverage

The runbook covers three authenticated roles:

1. **System Admin** — `/admin/system`, `/admin/monitoring`, `/admin/anomalies`, `/admin/breach`, `/admin/system/config`, audit, telemetry, identity governance, sessions, scheduled reports, and admin navigation.
2. **National Validator** — `/dashboard/validator`, `/dashboard/validator/audit`, `/dashboard/validator/map`, incident approve/reject/resubmission, offline queue/sync, conflict UI, widgets, and role access-control checks.
3. **National Analyst** — `/dashboard/analyst`, analyst workflow routes (`comparative`, `heatmap`, `trends`, `response-time`, `top-n`, `incident-explorer`), export preview/download, read-only incident detail, wildland detail, integrity display, offline read cache, widgets, and role access-control checks.

## Evidence Contract

Every failed step should capture:

- screenshot
- full URL/route
- role/account type
- timestamp/timezone
- browser/device
- console error
- failed network request/status/response
- backend/nginx logs if available

The runbook explicitly requires redaction of passwords, tokens, cookies, Authorization headers, names, phone numbers, exact coordinates, and unnecessary PII.

## Issue Conversion

The runbook includes a reusable GitHub issue template with:

- role/environment/URL/time/browser/account fields
- reproduction steps
- expected vs actual result
- evidence fields
- initial triage notes
- acceptance criteria

This supports the current operating workflow: teammates run smoke tests, report failures in a consistent format, then agents convert independent failures into GitHub issues.

## Related

- [[operations/agent-routing-guide]]
- [[frontend/route-map]]
- [[subsystems/admin-hub]]
- [[subsystems/validator-hub]]
