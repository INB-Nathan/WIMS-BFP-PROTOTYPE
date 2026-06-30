---
description: Review code, plans, diffs, or PRs using the 16-item gotcha checklist to prevent known failure modes.
---

# Review Gotchas

Use this skill when reviewing code, plans, diffs, PRs, or proposed solutions for this repo. Loads the 16-item gotcha list before every review to prevent known failure modes.

## Background

The full gotcha list lives in `docs/agents/gotchas.md`. These are real mistakes that sub-agents made on this repo. Every review must guard against them.

## Priority 1 — Evidence & Integrity (Never Violate)

1. **Don't cite a line you didn't read.** If you say file.ts:42, read line 42 first.
2. **Verify security claims.** Zero evidence in the file means don't claim it.
3. **Never cite an FRS module without reading the source file.** The module map (`system-wiki/concepts/frs-module-map.md`) is a routing index with abbreviated names — not a requirements summary. Module names are misleading (e.g., Module 15 is "Reference Data Service", not "Offline-First"). Before stating "FRS Module N requires X," always `read system-wiki/raw/frs/frs-*.md` for that module and quote the exact line. If the FRS doesn't say it, don't claim it does.
4. **Don't bypass the spec unless you can justify it.** If an implementation deviates from an issue, PRD, acceptance criterion, file name, API contract, migration number, or explicit user instruction, the agent must state the deviation, explain why it is necessary, and show how it materially improves correctness, safety, maintainability, or user value.
5. **Don't switch implementation approach without asking.** If the user's request implies a fundamentally different architecture than what you were planning, ask first.

## Priority 2 — Methodology (Always Follow)

6. Count explicitly ("X of Y", not "all" or "most").
7. Read the actual config — don't assume .env secrets.
8. Search before claiming — `rg` for the function/symbol first.
9. Check every service — one 0.0.0.0 binding means not all are localhost-only.
10. Check every image tag — two `:latest` means not all are pinned.
11. Re-read after edits — line numbers shift.
12. No exceptions mean no rule — if one service lacks health conditions, the pattern isn't universal.
13. Prove it with a specific line and file — "clean code" needs receipts.
14. Don't assume a commit's parent branch without verifying (`git branch --contains <commit>`).
15. Validate CI before merging — local lint/tests aren't enough, run the exact CI commands.
16. Run ruff before every commit — E402: don't place code between import blocks.

## Steps

1. Read `docs/agents/gotchas.md` to confirm the full current list (this skill is a reference copy — always verify against the canonical file).
2. Conduct the review with all 16 items as standing checks.
3. In the review output, note which gotchas were specifically checked and any violations found.
