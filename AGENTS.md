# Repository Guidelines

## Project Structure & Module Organization

This repository is a Dockerized WIMS-BFP full-stack prototype. Primary implementation lives in `src/`: `src/backend/` contains the FastAPI API, Celery tasks, models, schemas, and pytest tests; `src/frontend/` contains the Next.js App Router application, React components, client libraries, public assets, and Vitest tests. Database bootstrap SQL is in `src/postgres-init/`. Keycloak files are in `src/keycloak/`, Nginx config is in `src/nginx/`, and Suricata rules/log mounts are in `src/suricata/`. Project notes live in `docs/`; seed and utility scripts live in `scripts/`.

## Gotchas — Read These Before Every Review

Each is a real mistake a sub-agent made.

1. **Don't cite a line you didn't read.** If you say file.ts:42, read line 42 first.
2. **Count explicitly.** Say "X of Y", not "all" or "most".
3. **Read the actual config.** Don't assume .env secrets; check for hardcoded values.
4. **Search before claiming.** `rg` for the function/symbol first.
5. **Check every service.** One 0.0.0.0 binding means not all are localhost-only.
6. **Check every image tag.** Two `:latest` means not all are pinned.
7. **Verify security claims.** Zero evidence in the file means don't claim it.
8. **Re-read after edits.** Line numbers shift. Verify before citing.
9. **No exceptions mean no rule.** If one service lacks health conditions, the pattern isn't universal.
10. **Prove it with a specific line and file.** "Clean code" needs receipts.
11. **Don't assume a commit's parent branch without verifying.** Seeing a commit in `git log --oneline` for the whole repo doesn't mean it's on master. Always run `git branch --contains <commit>` before claiming a branch is behind.
12. **Validate CI before merging.** Running local lint/tests isn't enough — GitHub CI runs `npm run lint`, `ruff check`, `ruff format --check`, `pytest`, and `vitest` in a fresh environment. Run the exact CI commands locally first, or you'll get red merge gates.
13. **Don't switch implementation approach without asking.** If the user's request implies a fundamentally different architecture than what you were planning (e.g., Pi-driven vs CI-driven, local vs remote), and changing approaches would conflict with existing files, agents, chains, or workflows, ask the user first. Don't silently build the wrong thing.
14. **Arch Linux requires a venv for pytest.** On Arch, `pip install` fails with `--break-system-packages` by default. Always create and activate a venv before running pytest locally: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && pytest`.
15. **Never cite an FRS module without reading the source file.** The module map (`system-wiki/concepts/frs-module-map.md`) is a routing index with abbreviated names — not a requirements summary. Module names are misleading (e.g., Module 15 is "Reference Data Service", not "Offline-First"). Before stating "FRS Module N requires X," always `read system-wiki/raw/frs/frs-*.md` for that module and quote the exact line. If the FRS doesn't say it, don't claim it does.

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
