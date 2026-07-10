---
title: Agent Instruction Hierarchy
created: 2026-07-10
updated: 2026-07-10
type: architecture
tags: [wims-bfp, agent-routing, system-wiki, codebase]
sources: [AGENTS.md, .pi/AGENTS.md, docs/AGENTS.md, infra/AGENTS.md, src/AGENTS.md, src/backend/AGENTS.md, src/frontend/AGENTS.md, system-wiki/AGENTS.md, .github/workflows/ci.yml]
status: verified
---

# Agent Instruction Hierarchy

WIMS-BFP uses a short global-to-local instruction hierarchy so repository-wide
security rules remain visible while subsystem commands and exceptions stay near
the files they govern.

## Scope Map

The repository has eight first-party `AGENTS.md` files:

| File | Effective responsibility |
|---|---|
| `AGENTS.md` | Global evidence method, source authority, cross-cutting architecture/security boundaries, validation ladder, and final report contract |
| `.pi/AGENTS.md` | Pi settings, executable extensions, prompts, skills, package trust, evals, and generated-state boundaries |
| `docs/AGENTS.md` | Documentation placement, provenance, historical-artifact handling, reviews, and issue/PRD routing |
| `infra/AGENTS.md` | Compatibility routing index for infrastructure; implementation is under `src/` |
| `src/AGENTS.md` | Compose overlays, environment contracts, Alembic/bootstrap migration split, Keycloak, Nginx, OpenBao, and Suricata safety |
| `src/backend/AGENTS.md` | FastAPI/service/schema boundaries, auth/RLS sessions, PII/audit/PostGIS rules, and Python checks |
| `src/frontend/AGENTS.md` | App Router/client boundaries, API transport, offline/PWA invariants, UI rules, and frontend checks |
| `system-wiki/AGENTS.md` | Wiki authority, provenance, page format, synchronization triggers, index/log/gap workflow, and validation |

A nested file supplements the root and cannot weaken root security or integrity
rules. Agents must read the scoped file before editing its subtree because tool
implementations differ in nested-file discovery.

## Pi Discovery Note

Pi discovers `AGENTS.md` or `CLAUDE.md` by walking from the session startup working
directory toward its ancestors. A root-started session therefore receives the root
file but not child files automatically. The root routing table tells agents to read
the relevant child file manually. A Pi session started inside `src/backend/`, for
example, can discover root, `src/AGENTS.md`, and `src/backend/AGENTS.md` through its
ancestor walk.

Project trust and context loading are separate. Context files can load before a
project is trusted, while `.pi/settings.json`, packages, extensions, prompts, and
skills require project trust. Executable `.pi` resources therefore have stronger
review and secret-handling requirements.

## Authority and Maintenance

- User-approved requirements and decisions define intended change scope.
- Raw FRS files define supplied product requirements.
- Live source/config/tests define current implementation behavior.
- The system wiki synthesizes and routes; it does not override raw or live evidence.
- `.github/workflows/ci.yml` defines the merge gate. `make ci-local` is only a fast
  smoke target unless its implementation is expanded to match CI.

Review the instruction hierarchy when directory layout, commands, CI jobs,
migration flow, security boundaries, tracked Pi resources, or source-of-truth
ownership changes. Avoid volatile service, SQL, test, and route counts in always-on
instructions unless the count is derived and intentionally maintained.

## Maintained vs Generated Trees

Tracked `.pi` sources are maintained project resources. `.pi/npm/`, `.pi/git/`,
`.pi/sessions/`, dependencies, build output, caches, virtual environments, and
inactive `.worktrees/` are not project source and must not contribute copied
instructions. `system-wiki/raw/` remains immutable source capture except for an
authoritative replacement batch.

## Validation

Instruction-only changes require at least path/source verification,
`git diff --check`, re-reading each changed file, and final `git status`. Changes
that alter executable prompts, skills, settings, or extensions also require the
resource-specific checks in `.pi/AGENTS.md`. Full implementation delivery follows
[[architecture/pwa-tests-cicd]] and the executable CI workflow.

## Related

- [[operations/agent-routing-guide]]
- [[architecture/docs-and-scripts]]
- [[mocs/system-map]]
