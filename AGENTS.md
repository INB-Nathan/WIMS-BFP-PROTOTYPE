# WIMS Agent Instructions

## Core Principles — How to Think

Agent behavior rules that apply everywhere, regardless of subsystem.

- **Search before claiming.** `rg` for the function or symbol before asserting anything about it.
- **Read before editing.** Read related files, tests, interfaces, configs, and call sites before modifying.
- **Verify before citing.** If you say file.ts:42, read line 42 first. Don't cite what you haven't read.
- **Count explicitly.** Say "X of Y", not "all" or "most".
- **Prefer minimal diffs.** Smallest correct change. Avoid unrelated refactors.
- **Claims require evidence.** For bugs, security findings, or architectural conclusions, cite the file, command output, or test result that supports the claim.
- **Don't bypass the spec.** If you deviate from an issue, PRD, acceptance criterion, API contract, migration number, or explicit user instruction, state the deviation and justify why it improves correctness, safety, or maintainability.
- **Don't switch approach without asking.** If your plan conflicts with existing architecture, ask first.
- **Validate CI before pushing.** Local lint/tests aren't enough. Run the full CI pre-flight (`docs/agents/ci-preflight.md`) before opening a PR.

> Full 15-item gotcha list: `docs/agents/gotchas.md`. Read before every review.

## Repository Map

| Path | Purpose |
|------|---------|
| `src/backend/` | FastAPI API, Celery tasks, models, schemas, pytest tests |
| `src/frontend/` | Next.js App Router, React components, client libs, public assets, Vitest tests |
| `src/postgres-init/` | 74 SQL bootstrap files (lexical order, `ON_ERROR_STOP=1`) |
| `src/keycloak/` | Realm imports and custom providers |
| `src/nginx/` | Nginx edge gateway config |
| `src/suricata/` | Suricata IDS rules/log mounts |
| `src/openbao/` | OpenBao KMS init/bootstrap |
| `docs/` | User, architecture, and operational documentation |
| `docs/agents/` | Agent reference docs (gotchas, CI pre-flight, issue tracker) |
| `scripts/` | Seed and utility scripts |
| `system-wiki/` | Project-local agent knowledgebase (authoritative implementation docs) |
| `CLAUDE.md` | Architecture overview, key patterns, env vars (Claude Code integration) |

## Architecture Constraints

Never violate these boundaries:

- **Frontend never accesses PostgreSQL directly.** All data goes through the FastAPI backend.
- **All business logic lives in `backend/services/`.** Routes stay thin — parse request, call service, marshal response.
- **Celery workers never call external APIs directly.** Route through a service or util.
- **Pydantic schemas define API contracts.** `backend/schemas/` is the contract layer; routes and services consume these types.
- **RBAC is enforced server-side.** JWT roles extracted in `auth.py`. Frontend role checks are UI-only, never a security boundary.
- **Row-Level Security is mandatory.** Every `wims.*` table has RLS policies bound to `wims.current_user_id` GUC. Test data must be seeded through admin session (`_AdminSessionLocal`) to bypass RLS.
- **Audit records are append-only.** `wims.audit_log` and `wims.security_threat_logs` are insert-only via triggers. No updates or deletes.
- **PII is encrypted at rest.** AES-256-GCM via `backend/utils/crypto.py`. Plaintext PII columns must be NULL for new writes.
- **PostGIS is the source of truth for spatial data.** All geometry operations go through PostGIS functions.
- **Offline/PWA:** Frontend has offline-first IndexedDB stores with dual-path sync engine. See `system-wiki/architecture/pwa-tests-cicd.md`.

## Context Loading — What to Read When

Start here, then navigate to the subsystem that owns your work.

| Working on... | Read first |
|---|---|
| Any change | This file (`AGENTS.md`), `CLAUDE.md` |
| Backend API, services, tests | `backend/AGENTS.md`, then `system-wiki/backend/api-route-map.md` |
| Frontend, UI, PWA | `frontend/AGENTS.md`, then `system-wiki/frontend/route-map.md` |
| Docker, CI/CD, nginx, Suricata | `infra/AGENTS.md` |
| system-wiki, FRS alignment | `system-wiki/AGENTS.md` |
| GitHub issues, triage | `docs/AGENTS.md` (issue tracker, triage labels sections) |

For cross-cutting changes (auth, schema, security), also read:
- `system-wiki/security/security-baseline.md`
- `system-wiki/database/schema-overview.md`
- `system-wiki/operations/agent-routing-guide.md`

## Build & Test Quick Reference

| Action | Command |
|--------|---------|
| Full stack up (fresh) | `cd src && docker compose down -v && docker compose up --build -d` |
| Full stack up (restart) | `cd src && docker compose down && docker compose up --build -d` |
| Backend lint | `cd src/backend && ruff check .` |
| Backend format | `cd src/backend && ruff format --check .` (auto-fix: `ruff format .`) |
| Backend tests | `cd src/backend && pytest -v --tb=short` |
| Frontend dev | `cd src/frontend && npm run dev` |
| Frontend build | `cd src/frontend && npm run build` |
| Frontend lint | `cd src/frontend && npm run lint` |
| Frontend tests | `cd src/frontend && npx vitest run` |
| Local CI simulation | `cd src && make ci-local` |
| Full CI pre-flight | `docs/agents/ci-preflight.md` (gates 1-5) |

## Before Final Response Checklist

- [ ] Relevant tests/checks were run, or skipped with a clear reason.
- [ ] `git status` was reviewed when files were edited.
- [ ] If non-trivial behavior changed: system-wiki synthesis page, `log.md` updated.
- [ ] If FRS alignment changed: `system-wiki/gaps/frs-codebase-gap-register.md` updated.
- [ ] Final response states whether wiki updates were made or were not needed.
