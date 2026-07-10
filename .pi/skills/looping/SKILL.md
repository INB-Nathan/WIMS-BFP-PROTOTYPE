---
name: looping
description: "After completing any non-trivial work — code, design, fix, review — loop back to the original request and re-verify everything before presenting to the user. Catches blind spots, missed requirements, and edge cases. Trigger automatically when work is done and a summary is about to be given."
---

# Looping

When you have finished your work and are about to present the summary to the user, pause. Loop back to the start and re-examine everything with fresh eyes — as if you are a reviewer who has never seen this task before.

The loop is one pass that verifies correctness, completeness, and fidelity to the original request. If it finds issues, fix them silently before presenting. Only present when the loop passes.

<HARD-GATE>
Do NOT present final results — summaries, file lists, test output, next steps, or any "done" signal — until the loop has completed and passed. If the loop finds issues, fix them and loop again. Only break the loop when it passes clean or the user explicitly interrupts.
</HARD-GATE>

---

## When to loop

Loop **automatically** after every non-trivial completion:

- Feature implementation finished
- Bug fix with regression test written
- Design doc / spec written
- Code review completed
- CI pre-flight run and results ready
- Multiple files changed and you're about to summarise
- The last action in a skill pipeline (after `/issue-implement`, `/review-wims`, `/ci-preflight`, etc.)

**Do not loop** when:
- The task was a simple read, search, or question-answer
- A one-line typo fix
- The user explicitly said "don't loop, just do it" or "go ahead"
- The change is a config value or env var — deterministic, no hidden state

When unsure, loop. A 30-second loop costs less than a follow-up fix.

---

## The loop

Read everything as if for the first time. Do not rely on what you remember from building it.

### 1. Re-read the original request

Go back to the **first user message that started this task**. Read the exact wording:

- What problem did they ask you to solve?
- What acceptance criteria were stated (or implied)?
- What constraints were mentioned?

If the task came from a GitHub issue, re-read the issue body and comments. If from a prompt file, re-read the prompt.

Do not paraphrase from memory. Read the actual text.

### 2. Re-examine what you produced

For each file you changed or created:

- **Re-read each file** — not just the diff, but the full file state. Does it make sense as a complete unit?
- **Check for half-baked code** — `TODO`, `FIXME`, `pass`, `# placeholder`, commented-out blocks, unused imports, hardcoded test data that leaked into production code, `print()` debug statements.
- **Check for duplicate definitions** — did you add a function that already existed? A utility that's already in the codebase? `rg` for the symbol name.

For tests:

- **Re-read the test cases** — do they actually test what you think they test? Are there edge cases missing?
- **Re-run the tests if the loop finds issues that might break them** — don't re-run blindly; only re-run targeted tests when you made a change during the loop.

For architecture-constrained repos (like WIMS):

- **Verify constraints are met** — RLS context set after commit? PII columns NULL for plaintext? Audit trigger not bypassed? Routes thin, services own logic?
- Check against the project's `AGENTS.md` architecture constraints section.

### 3. Re-read your own summary draft

Before typing the summary, ask:

- Does this answer the **original question**?
- Are there any claims you cannot support with a file path and line number?
- Is the scope exactly what was asked for — nothing more, nothing less?
- Is there any unfinished work you're about to gloss over?

### 4. Compare against the checklist

| Check | Ask |
|---|---|
| Scope | Does the output match the original request without extra scope? |
| Correctness | Are there any logical errors, off-by-ones, wrong assumptions? |
| Completeness | Are all acceptance criteria met? Any test gaps? No half-baked code? |
| Consistency | No contradictions between files, no duplicate definitions, no orphaned references? |
| Constraints | Architecture rules preserved (RLS, PII, audit, PostGIS, thin routes)? |
| Evidence | Can you cite a file + line for every claim in your summary? |

---

## If the loop finds issues

**Fix silently.** Do not announce each finding to the user. The user doesn't need to know you had a bug — they need the bug gone.

1. Fix the issue inline.
2. Re-run any affected tests or lint commands.
3. Update the summary draft to reflect the fix.
4. **Loop again** — run the full loop on the fixed version.

Only announce an issue if it changes the scope or direction of the work (e.g., "I found the approach doesn't work for X case — let me check with you before proceeding"). Otherwise, fix and continue.

---

## If the loop passes

Present the summary. The summary should:

1. State what was done (files changed, commands run)
2. Cite evidence (file paths, test output, lint results)
3. Note any skipped steps with clear reasons
4. Flag any wiki updates made or not needed

---

## Relationship to other skills

| Skill | How looping differs |
|---|---|
| `/review-wims` | Reviews the **diff** against spec, architecture, risk. Looping re-reads the **original request** and the **full file state**, not just the diff. |
| `/skill:ponytail-review` | Looks for over-engineering — bloat, speculative abstractions. Looping looks for **correctness and completeness**: missed requirements, half-baked code, wrong assumptions. |
| Spec self-review (in grill-with-docs) | Checks a design doc for placeholders and ambiguity. Looping checks **implementation** against the **original request**. |
| `/ci-preflight` | Runs lint, tests, build — automated gates. Looping is a **cognitive re-read**: the agent reads its own work as a human reviewer would. |

Looping complements all of these. Run it after they've passed, as the final gate before presenting.
