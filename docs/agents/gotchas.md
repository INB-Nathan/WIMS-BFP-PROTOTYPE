# Gotchas — Read Before Every Review

Each is a real mistake a sub-agent made.

## Priority 1 — Evidence & Integrity (Never Violate)

1. **Don't cite a line you didn't read.** If you say file.ts:42, read line 42 first.
2. **Verify security claims.** Zero evidence in the file means don't claim it.
3. **Never cite an FRS module without reading the source file.** The module map (`system-wiki/concepts/frs-module-map.md`) is a routing index with abbreviated names — not a requirements summary. Module names are misleading (e.g., Module 15 is "Reference Data Service", not "Offline-First"). Before stating "FRS Module N requires X," always `read system-wiki/raw/frs/frs-*.md` for that module and quote the exact line. If the FRS doesn't say it, don't claim it does.
4. **Don't bypass the spec unless you can justify it.** If an implementation deviates from an issue, PRD, acceptance criterion, file name, API contract, migration number, or explicit user instruction, the agent must state the deviation, explain why it is necessary, and show how it materially improves correctness, safety, maintainability, or user value. Otherwise, follow the spec exactly or ask first.
5. **Don't switch implementation approach without asking.** If the user's request implies a fundamentally different architecture than what you were planning (e.g., Pi-driven vs CI-driven, local vs remote), and changing approaches would conflict with existing files, agents, chains, or workflows, ask the user first. Don't silently build the wrong thing.

## Priority 2 — Methodology (Always Follow)

6. **Count explicitly.** Say "X of Y", not "all" or "most".
7. **Read the actual config.** Don't assume .env secrets; check for hardcoded values.
8. **Search before claiming.** `rg` for the function/symbol first.
9. **Check every service.** One 0.0.0.0 binding means not all are localhost-only.
10. **Check every image tag.** Two `:latest` means not all are pinned.
11. **Re-read after edits.** Line numbers shift. Verify before citing.
12. **No exceptions mean no rule.** If one service lacks health conditions, the pattern isn't universal.
13. **Prove it with a specific line and file.** "Clean code" needs receipts.
14. **Don't assume a commit's parent branch without verifying.** Seeing a commit in `git log --oneline` for the whole repo doesn't mean it's on master. Always run `git branch --contains <commit>` before claiming a branch is behind.
15. **Validate CI before merging.** Running local lint/tests isn't enough — GitHub CI runs `npm run lint`, `ruff check`, `ruff format --check`, `pytest`, and `vitest` in a fresh environment. Run the exact CI commands locally first, or you'll get red merge gates.

16. **Run ruff before every commit.** E402: don't place code between import blocks. `ruff check .` and `ruff format --check .` are cheap; skipping them pushes red.

17. **Target `master`, not `main`.** This repo has a stale orphan branch named `main` that is far behind `master`. Opening a PR against `main` shows 100+ unrelated commits and cannot be merged. If a PR shows far more commits than the branch has, check the base branch — it was probably opened against `main` by mistake. Always verify `gh pr view <N> --json baseRefName` before reviewing or merging. If found, close the duplicate and use the correct PR targeting `master`.
