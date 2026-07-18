---
name: tdd
description: Test-driven development — red-green-refactor loop using WIMS-BFP test tooling (pytest, vitest). Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", "TDD", "test-driven", "write tests first", or wants integration tests. Do not use for writing tests after implementation or for test-coverage-only tasks.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

When exploring the codebase, read `CLAUDE.md`, the relevant scoped `AGENTS.md`, and `CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language. Respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists — and survives refactors because it doesn't care about internal structure.

See [references/tests.md](references/tests.md) for examples and [references/mocking.md](references/mocking.md) for mocking guidelines (includes WIMS-specific boundaries).

## WIMS test tooling

| Layer | Tool | Location | Run command |
|---|---|---|---|
| Backend (Python) | `pytest` + `pytest-asyncio` | `src/backend/tests/` | `cd src/backend && pytest <target>` |
| Frontend (TypeScript) | `vitest` | `src/frontend/**/__tests__/` or `*.test.ts` | `cd src/frontend && npx vitest run <target>` |
| Lint (backend) | `ruff` | — | `cd src/backend && ruff check . && ruff format --check .` |
| Lint (frontend) | `eslint` | — | `cd src/frontend && npm run lint` |
| Full smoke | `make ci-local` | Repository root | `make ci-local` |

Run the narrowest useful check after each cycle, then the broader gate before considering the loop complete.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam.

### WIMS seam conventions

| Seam | What to test | Do NOT test |
|---|---|---|
| FastAPI route | Request → response behavior, status codes, error shapes, auth/RBAC enforcement | Internal service logic, database queries directly |
| Service function | Input → output transformation, domain rules, error conditions | HTTP concerns, database connection details |
| Pydantic schema | Validation, serialization, deserialization | — |
| Celery task | Task accepts correct input, produces expected side effects | Internal orchestration (tasks must use service adapters) |
| PostGIS query | Spatial predicate correctness | SQL string matching |
| React component | Rendered output, user interactions, accessibility | Internal state, hook implementation details |

Ask: "What's the public interface, and which seams should we test?"

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does, so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Work in **vertical slices** instead — one test → one implementation → repeat.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage — use the project-level `code-review` skill to review after the loop.
- **Run narrowest checks first.** `ruff` / `eslint` on changed files, targeted `pytest` / `vitest`, then broader gates.
