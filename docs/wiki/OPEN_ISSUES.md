# WIMS-BFP Open Issues

Last updated: 2026-05-04

## Recently Fixed (do not reopen)

| # | Title | Fixed by |
|---|---|---|
| #42 | [M3-A] User Deactivation and Role Assignment | Earl (Antigravity) |
| #43 | [M3-B] Active Session Viewer | Earl (Antigravity) |
| #44 | [M3-C] Health Dashboard | Earl (Antigravity) |
| #45 | [M3-D] Audit Log Viewer | Earl (Antigravity) |
| #57 | [M4-H] Bulk Approve | Earl (Antigravity) |
| #58 | [M5-A] Public Report Submission Form | Earl (Antigravity) |
| #59 | [M5-B] Report Status Tracker | Earl (Antigravity) |
| #84 | P0 Bug: verify_incident() missing analytics sync | Earl (VSCode + OpenCode) |
| #66 | [M6-D] Immutable Audit Log & Status Transitions | Earl (VSCode + OpenCode) |
| #85 | Export Infrastructure: PDF/Excel | Nathan (merged in master) |
| #89 | National Analyst Dashboard tracking | Nathan (merged in master) |
| #46 | [M6-F] Backup Trigger | Earl + master (encrypted backup merged) |
| #95 | [M6-D] Correction Workflow | Earl — PR #98 pending merge |
| #47 | [M6-F] Dynamic Rate Limits | Earl — PR #97 merged |
| #95 | [M6-D] Immutable Records & Incident Correction Workflow | Earl (VSCode + OpenCode) |

## Known Regressions (reverted for stability)

- Concurrent Session Block (#90 related) — one-session-per-user enforcement reverted, needs robust reimplementation
- On-Going Fires Dashboard — VERIFIED incidents hidden on Home panel, frontend filter/timestamp bug

## P0 — Critical Bugs (block everything)

| # | Title | Assignee |
|---|---|---|
| #90 | JWT Refresh Token Race Condition — cross-window session | ? |
| #80 | CD: Configure production OIDC env vars before cloud deployment | ? |

## Earl's Open Issues

| # | Title | Priority | FRS |
|---|---|---|---|
| #46 | [M3-E] Backup Trigger | High | M12 |
| #47 | [M3-F] Dynamic Rate Limit Configuration | Medium | M12 |
| #71 | [M6-J] Penetration Testing in CI | High | M11 — post-deploy |

## ShibaTheDOGE Issues

| # | Title | Priority |
|---|---|---|
| #48 | [M4-A] Incident Creation with PostGIS Location | High |
| #49 | [M4-B] Incident Edit (Own, Non-Verified Only) | High |
| #50 | [M4-C] AFOR Spreadsheet Import | High |
| #51 | [M4-D] Duplicate Detection on Import | High |
| #52 | [M4-E] Draft Save | Medium |
| #63 | [M6-A] Session Management (FRS M1) | High |

## Nathan Issues

| # | Title | Priority |
|---|---|
| #89 | [TRACKING] National Analyst Dashboard | High |
| #85 | [P1] Export Infrastructure: PDF/Excel | High |
| #87 | [P2] Chart Rendering upgrade | Medium |
| #86 | [P2] Analyst Sidebar + Profile Polish | Medium |
| #88 | [P3] Scheduled Reports | Medium |
| #53 | [M4-F] National Validator Verification Queue | High |
| #54 | [M4-G] Side-by-Side Diff View | Medium |
| #55 | [M4-I] Validator Audit Trail Viewer | Medium |
| #67 | [M6-E] PII Encryption AES-256-GCM | High |
| #68 | [M6-F] Suricata IDS Integration | High |
| #69 | [M6-G] XAI Threat Narratives | Medium |
| #70 | [M6-H] System Monitoring & Prometheus | Medium |
| #29 | Analytics Export Infrastructure — 6 Defects | Medium |
| #31 | Wire Celery beat for MV refresh schedule | Medium |

## Gwen + ShibaTheDOGE Issues

| # | Title | Priority |
|---|---|---|
| #64 | [M6-B] Offline-First Sync Strategy (FRS M2) | Medium |
| #65 | [M6-C] Conflict Detection & Manual Merge (FRS M3) | Medium |
| #72 | [M6-K] Notification System (FRS M13) | Medium |
| #73 | [M6-I] RA 10173 Data Privacy Compliance | High |
| #60 | [M5-C] Nearby Fire Station Map | Medium |
| #61 | [M5-D] Push Notification Opt-In | Medium |
| #62 | [M5-E] Follow-Up Submission | Medium |
| #74 | [M5-F] Emergency Contacts Display | Low |

## Uncategorized

| # | Title |
|---|---|
| #28 | ANALYST Profile Self-Management |

## Known Code Gaps (no open issue)

- Admin create_user: record_id=None in audit log (F-01 in system-wiki) — cosmetic bug
- No backup restore endpoint (POST /admin/restore) — natural companion to #46
- No pagination on GET /admin/users and GET /admin/security-logs
- Session termination (DELETE /sessions/{user_id}/{session_id}) terminates ALL sessions, not just the specified one — behavioral bug
