---
description: Run WIMS validation for the current changes
argument-hint: "[focus]"
---
Run WIMS validation for this work. Focus: `$ARGUMENTS`.

1. Read `AGENTS.md`, `docs/agents/ci-preflight.md`, `.github/workflows/ci.yml`,
   and every scoped `AGENTS.md` for the touched paths.
2. Inspect `git status` and the diff. Preserve unrelated/pre-existing changes.
3. Run the smallest relevant checks first:
   - backend: `cd src/backend && ruff check . && ruff format --check .` plus
     targeted `pytest`;
   - frontend: `cd src/frontend && npm run lint` plus targeted `npx vitest run`;
   - docs/instructions: `git diff --check` plus cited path/link verification;
   - migrations/infrastructure: the disposable-database and Compose checks required
     by `src/AGENTS.md`.
4. If this is a push/PR preflight, run the broader applicable backend, frontend
   build/test, migration, Docker, and security gates from the canonical workflow.
   `make ci-local` runs from the repository root and is only a fast smoke target,
   not proof that GitHub CI will pass.
5. Report every exact command and result. List skipped or unavailable gates with
   their prerequisites/failure evidence; never mark an unrun check as passing.

Do not fix unrelated failures or run destructive/production operations unless the
user explicitly asks.
