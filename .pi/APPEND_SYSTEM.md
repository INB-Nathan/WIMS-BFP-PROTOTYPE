# APPEND_SYSTEM.md — WIMS-BFP-PROTOTYPE Project Context

This file is appended to the system prompt when working in the WIMS-BFP-PROTOTYPE project.
It supplements the global APPEND_SYSTEM.md with project-specific tool usage and context rules.

## Project Environment

- **Project root:** `/home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE`
- **Agent instructions:** `.pi/AGENTS.md` (copied from project `AGENTS.md` — the canonical source)
- **Project wiki:** `system-wiki/` — authoritative implementation documentation
- **CI pre-flight:** `docs/agents/ci-preflight.md`

## Tool Usage in This Project

| Operation | Preferred tool |
|-----------|---------------|
| Inspect backend code (Python) | `hypa_grep` (via `rg`) or `read` |
| Inspect frontend code (TS/React) | `hypa_grep` or `read` |
| Inspect SQL bootstrap files | `read` by name; 74 files in `src/postgres-init/` |
| Inspect Docker configs | `read` on `src/docker-compose.yml` or `src/*/Dockerfile` |
| Run backend tests | `cd src/backend && pytest -v --tb=short` |
| Run frontend tests | `cd src/frontend && npx vitest run` |
| Run lint | `cd src/backend && ruff check .` or `cd src/frontend && npm run lint` |
| Check git status | `bash git status` |
| Search codebase | `hypa_grep` with glob filters |

## Context Loading Sequence

When starting work on this project, always read:

1. `.pi/AGENTS.md` — project agent instructions (this file maps to the root AGENTS.md)
2. `CLAUDE.md` — architecture overview, key patterns, env vars
3. Subsystem-specific AGENTS.md (e.g., `src/backend/AGENTS.md`, `src/frontend/AGENTS.md`) as needed per the Context Loading table in AGENTS.md
4. `system-wiki/` pages for in-depth implementation details

## Project-Specific Guidelines

- **Never access PostgreSQL from the frontend.** All data flows through the FastAPI backend.
- **Business logic goes in `backend/services/`**, not in routes.
- **Row-Level Security** is enforced on all `wims.*` tables. Use `_AdminSessionLocal` for test data seeding.
- **Audit logs are append-only** (`wims.audit_log`, `wims.security_threat_logs`).
- **PII must be encrypted** via `backend/utils/crypto.py` (AES-256-GCM). Plaintext PII columns must stay NULL.
- **Spatial data** uses PostGIS exclusively.
- **Offline/PWA** uses IndexedDB stores with dual-path sync engine.

## Project Pi Resources (`.pi/`)

Pi discovers these automatically after the project is trusted.

| Resource | Path | Description |
|----------|------|-------------|
| Settings | `.pi/settings.json` | sessionDir, compaction tokens, project trust |
| Skill | `.pi/skills/ci-preflight/` | Run 5-gate CI pre-flight before pushing |
| Skill | `.pi/skills/review-gotchas/` | Read gotchas before every code review |
| Skill | `.pi/skills/frs-alignment/` | FRS module verification and gap register updates |
| Skill | `.pi/skills/schema-migration/` | SQL bootstrap file conventions and verification |
| Prompt | `.pi/prompts/test-backend.md` | `/test-backend` — run backend pytest |
| Prompt | `.pi/prompts/test-frontend.md` | `/test-frontend` — run frontend vitest |
| Prompt | `.pi/prompts/lint-all.md` | `/lint-all` — run all linters |
| Prompt | `.pi/prompts/ci-local.md` | `/ci-local` — run make ci-local |
| Prompt | `.pi/prompts/db-up.md` | `/db-up` — Docker compose up |

### How to use skills

Skills auto-load when the task matches the skill description. Invoke explicitly with `/skill:ci-preflight`, `/skill:review-gotchas`, `/skill:frs-alignment`, `/skill:schema-migration`.

### How to use prompts

Type `/test-backend`, `/test-frontend`, `/lint-all`, `/ci-local`, or `/db-up` in the editor to expand the template.
