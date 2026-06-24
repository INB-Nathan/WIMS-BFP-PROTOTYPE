# Agent Instructions

## Priority & Decision Hierarchy

When rules conflict, use this order of precedence:

1. **User instructions** — direct requests, AGENTS.md (this file), CLAUDE.md
2. **System instructions** — this file and `docs/agents/*.md`
3. **System wiki** — `system-wiki/` (implementation knowledgebase)
4. **Coding conventions** — style guides, naming, patterns

## Priority Rules

### Priority 1 — Never Violate
- **Verify claims from source.** Don't cite a line you didn't read. Before stating anything about a file, check it.
- **Follow the spec.** Don't bypass issue/PRD/acceptance-criterion/API-contract/migration-number instructions unless you can justify the deviation and show it improves correctness, safety, or maintainability.
- **Read before citing.** If you say file.ts:42, read line 42 first.

### Priority 2 — Always Follow
- **Gotchas** — Read `docs/agents/gotchas.md` before every review. 15 real mistakes sub-agents made.
- **Wiki maintenance** — Follow `docs/agents/wiki-maintenance.md` for system-wiki updates.
- **CI verification** — Run the full CI pre-flight in `docs/agents/ci-preflight.md` before pushing or opening a PR.

### Priority 3 — Development Conventions
- **Coding standards** — See `docs/agents/coding-standards.md` for style, testing, commits, commands.
- **Platform notes** — See `docs/agents/platform-notes.md` for environment-specific gotchas.

## Gotchas — Read Before Every Review

Full 15-item list with explanations: `docs/agents/gotchas.md`

**Most-critical (Priority 1):**

1. **Don't cite a line you didn't read.** If you say file.ts:42, read line 42 first.
2. **Verify security claims.** Zero evidence in the file means don't claim it.
3. **Never cite an FRS module without reading the source.** The module map is a routing index — not a requirements summary.
4. **Don't bypass the spec unless you can justify it.** State the deviation, explain why, and show how it improves correctness, safety, maintainability, or user value.
5. **Don't switch implementation approach without asking.** If your plan conflicts with existing architecture, ask first.

> Read all 15 in `docs/agents/gotchas.md` before every review.

## System Wiki Update Rule

For any non-trivial change to code, workflow, schema, infrastructure, test behavior, or documentation:

1. Update the relevant `system-wiki/` synthesis page.
2. Append an entry to `system-wiki/log.md`.
3. Update `system-wiki/gaps/frs-codebase-gap-register.md` when FRS alignment changes.
4. Do not edit `system-wiki/raw/` unless replacing it with a newer authoritative source batch.

**Update required when:** new feature, new API route, DB migration, new service, auth change, workflow change.
**Not required when:** bugfix under 20 LOC, typo fixes, refactoring w/o behavior change, test-only maintenance.

Before the final response, explicitly confirm whether the wiki was updated, or briefly state why no wiki update was needed.

> Thresholds and details: `docs/agents/wiki-maintenance.md`

## Context Loading

Before non-trivial changes, read in order:

1. This file (`AGENTS.md`)
2. `system-wiki/SCHEMA.md`
3. `system-wiki/index.md`
4. `system-wiki/mocs/system-map.md`
5. The relevant subsystem page from `system-wiki/operations/agent-routing-guide.md`

Key pages:

- `system-wiki/operations/agent-routing-guide.md` — subsystem-specific context packs (auth, incidents, validation, immutable records, analytics, DMZ, reference data)
- `system-wiki/concepts/frs-module-map.md` — 15-module FRS-to-code routing map
- `system-wiki/backend/api-route-map.md` — FastAPI route ownership snapshot
- `system-wiki/frontend/route-map.md` — Next.js route surface map
- `system-wiki/database/schema-overview.md` — PostgreSQL/PostGIS table and migration map
- `system-wiki/security/security-baseline.md` — auth/RBAC/RLS/audit/IDS/XAI baseline
- `system-wiki/gaps/frs-codebase-gap-register.md` — known gaps and verification targets

Raw FRS files: `system-wiki/raw/frs/`. Treat as source material — do not edit unless replacing with a newer authoritative batch.

## Agent Skills

- **Issue tracker** — GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels** — Five canonical labels. See `docs/agents/triage-labels.md`.
- **Domain docs** — Use AGENTS.md + system-wiki/ for context. See `docs/agents/domain.md`.

## Build & Test Quick Reference

| Action | Command |
|--------|---------|
| Full stack up | `cd src && docker compose up --build` |
| Full stack down | `cd src && docker compose down` |
| Backend tests | `cd src/backend && pytest -v` |
| Frontend dev | `cd src/frontend && npm run dev` |
| Frontend build | `cd src/frontend && npm run build` |
| Frontend lint | `cd src/frontend && npm run lint` |
| Frontend tests | `cd src/frontend && npx vitest run` |

> Full CI pre-flight (gates 1-5): `docs/agents/ci-preflight.md`
> All commands + infra: `docs/agents/coding-standards.md`

## Before Final Response Checklist

- [ ] Relevant tests/checks were run, or skipped with a clear reason.
- [ ] `git status` was reviewed when files were edited.
- [ ] If non-trivial behavior changed: system-wiki synthesis page, `log.md` updated.
- [ ] If FRS alignment changed: `system-wiki/gaps/frs-codebase-gap-register.md` updated.
- [ ] Final response states whether wiki updates were made or were not needed.
