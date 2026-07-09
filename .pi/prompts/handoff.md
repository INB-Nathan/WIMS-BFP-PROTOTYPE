---
description: Write a handoff that puts the next agent in state to take the next action immediately — zero hunting, zero re-reading.
argument-hint: "[topic]"
---
Create a handoff for the current WIMS task. Topic: `$ARGUMENTS`.

Save to `/tmp/handoff-${1:-wims-task}.md`.

The handoff is read by another agent. Optimize for **zero-hunt continuation** — the next agent must be able to take the next action without re-reading the session or hunting for context.

---

## Format

### 1. Entry Point — First Action

The single most important line. Tell the next agent exactly where to start:

```markdown
## Entry Point
1. Read `path/to/file.ts` — this is the file being changed
2. Run: `pytest path/to/test.py -x` — should pass (confirms environment is ready)
3. The next change is in `path/to/file.ts:42`
```

### 2. Objective — What We're Building

The original user request, as-is. If it came from a GitHub issue, include the issue number.

```markdown
## Objective
Implement issue #42: Add witness contact fields to civilian report endpoint.
```

### 3. Current State — What Exists Right Now

A one-paragraph snapshot of what the system looks like at handoff. The next agent should be able to picture the code without re-reading every file.

```markdown
## Current State
`civilian.py` now has a `POST /civilian/reports` endpoint that accepts `category`,
`location`, and `safety_status`. It inserts into `citizen_reports` and returns
a `report_id`. Tests in `test_civilian.py::test_submit_basic` pass. The triage
queue UI has NOT been updated yet.
```

### 4. Files — What Changed and Why

| Path | Action | LOC | Purpose |
|------|--------|-----|---------|
| `src/backend/api/routes/civilian.py` | modified | +35/-2 | Added POST endpoint |
| `src/backend/tests/test_civilian.py` | modified | +48/+0 | Integration tests for new endpoint |
| `src/backend/schemas/civilian.py` | created | +22 | Pydantic request/response models |

### 5. Dependencies & Assumptions

What the previous agent assumed that might not hold. What hasn't been verified yet.

```markdown
## Dependencies & Assumptions
- Assumes `REDIS_URL` is set for rate limiting — not tested without it
- `get_current_wims_user` must be listed before `get_db_with_rls` in route deps
- `ruff format .` was NOT run yet — run it before committing
```

### 6. Key Decisions with Rationale

Only decisions that would be **surprising or expensive to undo**. Skip obvious choices.

```markdown
## Key Decisions
- **POST instead of PATCH** for new reports because citizen reports are immutable
  append-only. Alternatives considered: PATCH with upsert (rejected — violates
  audit requirement).
```

### 7. Verification State — Exact Commands and Results

Every verification command that has been run, with its exact output state. The next agent should know what's clean and what's not without re-running everything.

```markdown
## Verification
| Check | Last Run | Result |
|-------|----------|--------|
| `ruff check .` | session | 0 errors |
| `pytest tests/test_civilian.py -x` | session | 4 passed |
| `ruff format --check .` | NOT run | — |

### Next verification needed
- Run `make ci-local` after completing the remaining implementation
```

### 8. Open Items — Ordered by Priority

```markdown
## Next Steps (priority order)
1. **Implement witness contact fields** in `civilian.py:78` — optional `witness_name`
   and `witness_phone` props
2. Add Pydantic schema for witness fields in `schemas/civilian.py`
3. Add migration: `ALTER TABLE citizen_reports ADD COLUMN witness_name TEXT`
4. Update triage queue UI to show witness badge
5. Run `pytest` and `ruff check .`
```

### 9. Repo Position

```markdown
## Repo Position
- Branch: `feature/civilian-eyewitness`
- Latest: `abc1234 — Add POST /civilian/reports endpoint`
- `git status`: 3 modified, 1 untracked
- Divergence from `main`: 2 ahead, 0 behind
- Unresolved conflicts: none
```

### 10. Suggested Skills

Only if the next step maps to a specific skill. Don't pad.

```markdown
## Suggested Skills
- `/review-wims` — before committing the final changes
```

---

## Rules

1. **The Entry Point is the most important section.** If the next agent only reads one thing, it should be able to start working. If you're not sure what the next action is, say so explicitly: "Next step is uncertain — read the Objective and Current State, then ask the user."

2. **Every file path must be absolute from repo root.** Agents need to `read path/to/file.ts` without guessing.

3. **Every claim must be verifiable.** Don't say "tests pass" — say "`pytest tests/test_civilian.py -x`: 4 passed". Include the exact command.

4. **Redact sensitive data.** API keys, passwords, tokens, secrets, PII → `[REDACTED]`.

5. **Don't duplicate what's in git.** If the diff is the best documentation of what changed, just say "see `git diff [file]`". Use the files table to explain *why*, not *what*.

6. **Flag unknowns.** If you don't know whether something works or not, say "NOT VERIFIED" rather than omitting it. The next agent should trust what's written.

7. **Keep the Entry Point at the top of the file.** Don't bury it under summaries. The first thing the agent reads should be actionable.
