# WIMS-BFP Module Status
Last audited: 2026-05-16 (code audit + Nathan system-wiki cross-reference)

## Summary

| Module | FRS | Assignee | Priority | Actual Status |
|---|---|---|---|---|
| M1: Auth & Access Control | FRS M1 | ShibaTheDOGE | High | Partial — session revocation exists, one-session enforcement reverted (#90 open) |
| M2: Offline-First | FRS M2 | Gwen | Critical | Partial — frontend sync engine exists (offlineStore.ts, syncEngine.ts), backend sync endpoint missing |
| M3: Conflict Detection | FRS M3 | ShibaTheDOGE + Nathan | Critical | Partial frontend only — syncEngine.ts may handle conflicts, no backend conflict/merge route |
| M4: Data Commit & Immutable Storage | FRS M4 | Earl | High | Done — data_hash, immutability rules, correction workflow (/correct endpoint), IVH hash chain all implemented. PRs #94 and #95 merged. |
| M5: Analytics & Reporting | FRS M5 | Nathan | Medium | Mostly Done — all analytics endpoints implemented, Phase 2 analyst export merged. Gaps: scheduled report email delivery unconfirmed |
| M6: Cryptographic Security | FRS M6 | Nathan | High | Partial — AES-256-GCM for PII + backup encryption confirmed. No OpenBao, no HSTS, no key rotation |
| M7: Intrusion Detection | FRS M7 | Nathan | Medium | Partial — Suricata EVE JSON pipeline + ingestion service fully implemented. Beat schedule wired (every 10s). No custom BFP rules yet |
| M8: XAI Threat Detection | FRS M8 | Nathan | Critical | Partial — analyze_threat_log() + Ollama (qwen2.5:3b) working end-to-end. No HITL, no structured output, no risk assessment field |
| M9: System Monitoring | FRS M9 | Nathan | Critical | Partial — GET /admin/health (DB/Redis/Keycloak ping) exists. No psutil, no Prometheus, no container metrics, no AI latency tracking |
| M10: Compliance & Data Privacy | FRS M10 | ShibaTheDOGE + Gwen | Low | Partial — PII encrypted, user deactivation/session revocation exists. No data-deletion endpoint, no compliance reporting |
| M11: Penetration Testing | FRS M11 | Earl + Gwen | Low | Post-deployment — skip |
| M12: User Management | FRS M12 | Earl | High | Mostly Done — deactivation, sessions, force-logout, audit logs, backup trigger all implemented. Gaps: backup restore endpoint missing, no pagination on user/security log lists |
| M13: Notification System | FRS M13 | ShibaTheDOGE + Gwen | Critical | Missing — no SSE, no push, no email sending anywhere in codebase |

## Notable Implementation Details (from system-wiki cross-reference)

- SessionManager Redis revocation: tokens revoked via iat < revocation_time (not token blacklist)
- Backup encryption: AES-256-GCM via utils/backup_crypto.py — encrypted as .sql.enc
- Duplicate detection: spatial (ST_DWithin 1km) + text fuzzy (≥3 fields matched)
- AFOR import: multi-phase commit (DUPLICATE_CHECK_REQUIRED → commit with resolutions)
- IVH helper: _insert_incident_verification_history() handles schema migration compatibility
- Admin create_user bug: F-01 — record_id=None in audit log (not blocking, cosmetic)
- Backup trigger timeout: 120s hard limit on pg_dump subprocess

## GitHub Milestone → FRS Module Key

- GitHub M3-A to M3-F = FRS Module 12 (User Management / Admin)
- GitHub M4-A to M4-I = FRS Module 4 (Incident Workflow)
- GitHub M5-A to M5-F = FRS Module 5-D (Citizen Portal)
- GitHub M6-A = FRS Module 1 (Session Management)
- GitHub M6-B = FRS Module 2 (Offline-First)
- GitHub M6-C = FRS Module 3 (Conflict Detection)
- GitHub M6-D = FRS Module 4 (Immutable Storage) — Earl ✅ Done
- GitHub M6-E = FRS Module 6 (PII Encryption)
- GitHub M6-F = FRS Module 7 (Suricata IDS)
- GitHub M6-G = FRS Module 8 (XAI)
- GitHub M6-H = FRS Module 9 (System Monitoring)
- GitHub M6-I = FRS Module 10 (Compliance)
- GitHub M6-J = FRS Module 11 (Pen Testing)
- GitHub M6-K = FRS Module 13 (Notifications)