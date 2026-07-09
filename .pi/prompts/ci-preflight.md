---
description: Run WIMS CI pre-flight checks for the current changes
argument-hint: "[focus]"
---
Run the WIMS CI pre-flight for this work. Focus: `$ARGUMENTS`.

Steps:
1. Read `AGENTS.md` and `docs/agents/ci-preflight.md`; also read the relevant scoped `AGENTS.md` for touched areas.
2. Check `git status` and identify pre-existing conflicts or unrelated changes before editing or testing.
3. Run the smallest relevant checks first, then broader gates when appropriate:
   - backend: `cd src/backend && ruff check . && ruff format --check . && pytest -v --tb=short`
   - frontend: `cd src/frontend && npm run lint && npx vitest run`
   - full local CI: `cd src && make ci-local`
4. Report each command, result, and any skipped gate with the reason.

Do not resolve unrelated merge conflicts unless explicitly asked.
