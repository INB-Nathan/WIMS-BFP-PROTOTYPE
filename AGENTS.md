# Repository Guidelines

## Project Structure & Module Organization

This repository is a Dockerized WIMS-BFP full-stack prototype. Primary implementation lives in `src/`: `src/backend/` contains the FastAPI API, Celery tasks, models, schemas, and pytest tests; `src/frontend/` contains the Next.js App Router application, React components, client libraries, public assets, and Vitest tests. Database bootstrap SQL is in `src/postgres-init/`. Keycloak files are in `src/keycloak/`, Nginx config is in `src/nginx/`, and Suricata rules/log mounts are in `src/suricata/`. Project notes live in `docs/`; seed and utility scripts live in `scripts/`.

## Mandatory System Wiki Update Rule

For any non-trivial code, workflow, schema, infrastructure, test behavior, or documentation-source change, agents MUST update the project-local system wiki before finishing:

1. Update the relevant `system-wiki/` synthesis page.
2. Append an entry to `system-wiki/log.md`.
3. Update `system-wiki/gaps/frs-codebase-gap-register.md` only when the change creates, closes, or modifies an FRS/codebase gap.
4. Do not edit `system-wiki/raw/` unless replacing it with a newer authoritative source batch.

Before the final response, explicitly confirm whether the wiki was updated, or briefly state why no wiki update was needed.

## System Wiki & Agent Context Routing

A project-local system knowledgebase lives in `system-wiki/`. This is the authoritative agent-routing wiki for the current implementation state of this repository, separate from any thesis-level wiki or external research vault.

Before making non-trivial changes, agents should read:

1. `AGENTS.md`
2. `system-wiki/SCHEMA.md`
3. `system-wiki/index.md`
4. `system-wiki/mocs/system-map.md`
5. The relevant subsystem page listed in `system-wiki/operations/agent-routing-guide.md`

Key system-wiki pages:

- `system-wiki/mocs/system-map.md`: high-level entry point and source-of-truth flow.
- `system-wiki/operations/agent-routing-guide.md`: subsystem-specific context packs for auth, incident workflow, validation, immutable records, analytics, public DMZ, and reference data work.
- `system-wiki/concepts/frs-module-map.md`: 15-module FRS-to-code routing map.
- `system-wiki/backend/api-route-map.md`: FastAPI route ownership snapshot.
- `system-wiki/frontend/route-map.md`: Next.js route surface map.
- `system-wiki/database/schema-overview.md`: PostgreSQL/PostGIS table and migration map.
- `system-wiki/security/security-baseline.md`: auth/RBAC/RLS/audit/IDS/XAI security baseline.
- `system-wiki/gaps/frs-codebase-gap-register.md`: known FRS/codebase gaps and verification targets.

Raw FRS files are copied under `system-wiki/raw/frs/` and must be treated as source material. Do not edit raw wiki sources directly unless replacing them with a newer authoritative FRS batch. When desk checks reveal the current true system state, update the relevant synthesis page plus `system-wiki/gaps/frs-codebase-gap-register.md` and append the change to `system-wiki/log.md`.

## Agent Skills

### Issue Tracker

Issues and PRDs are tracked in GitHub Issues for `x1n4te/WIMS-BFP-PROTOTYPE` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage Labels

The canonical triage labels are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain Docs

Single-repo context: use `AGENTS.md`, `CLAUDE.md`, and `system-wiki/` for domain and architecture context. See `docs/agents/domain.md`.

## Build, Test, and Development Commands

- `cd src && docker compose up --build`: build and run the local stack.
- `cd src && docker compose down`: stop the local stack without deleting volumes.
- `cd src/backend && pytest -v`: run backend unit and integration tests from `src/backend/tests`.
- `cd src/frontend && npm run dev`: start the Next.js dev server.
- `cd src/frontend && npm run build`: create a production frontend build.
- `cd src/frontend && npm run lint`: run ESLint.
- `cd src/frontend && npx vitest run`: run frontend tests.

Install frontend dependencies with `npm install` in `src/frontend/`. For non-Docker backend work, install `src/backend/requirements.txt` in a Python 3.10+ virtual environment.

## Coding Style & Naming Conventions

Use Python 3.10+ style in the backend: 4-space indentation, typed FastAPI route signatures where practical, `snake_case` for functions/modules, and explicit Pydantic schemas in `schemas/`. Keep routes grouped by domain under `src/backend/api/routes/`.

Frontend code is TypeScript/React. Use `PascalCase` for components, `camelCase` for functions and variables, and colocate tests beside code. Follow existing ESLint and Next.js conventions; avoid broad formatting churn.

## Testing Guidelines

Backend pytest discovery is configured in `src/backend/pytest.ini` with `testpaths = tests`. Name tests `test_*.py`; place integration-heavy cases under `src/backend/tests/integration/`. Frontend tests use Vitest, React Testing Library, and jsdom; name files `*.test.ts` or `*.test.tsx`. Run relevant tests before opening a PR.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects, often with issue references, such as `feat(#46): ...`, `fix(auth): ...`, and `style: ...`. Keep subjects imperative and scoped when useful.

Pull requests should include a short problem/solution summary, linked issues, test results, and screenshots for visible UI changes. Call out schema, auth, environment, or data-volume impacts explicitly. Never commit real secrets; Docker Compose values are development defaults only.

## CI Pre-flight

Before pushing or opening a PR, run the full CI pre-flight routine defined in
`docs/agents/ci-preflight.md`. The four blocking gates are: backend ruff lint,
backend ruff format, backend pytest, and frontend lint/test/build.
The single most common blocker is `ruff format` — always run `ruff format .`
(auto-fix) before committing Python changes.

## Before Final Response Checklist

- Relevant tests/checks were run, or skipped with a clear reason.
- `git status` was reviewed when files were edited.
- If non-trivial behavior changed, the relevant `system-wiki/` synthesis page was updated.
- If non-trivial behavior changed, `system-wiki/log.md` was updated.
- If FRS alignment changed, `system-wiki/gaps/frs-codebase-gap-register.md` was updated.
- The final response states whether wiki updates were made or were not needed.
