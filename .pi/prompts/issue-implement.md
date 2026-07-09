---
description: Implement a GitHub issue using WIMS repo rules
argument-hint: "<issue-number> [notes]"
---
Implement GitHub issue `#$1`. Notes: `${@:2}`.

Workflow:
1. Read `AGENTS.md`, `CLAUDE.md`, `docs/agents/issue-tracker.md`, and the full issue/comments for `#$1`.
2. Read the relevant subsystem `AGENTS.md` and system-wiki context before editing.
3. Check `git status`; do not touch unrelated or conflicted files unless they are part of this issue.
4. Implement the smallest correct change that satisfies the issue and WIMS architecture constraints.
5. Run targeted tests/lint for touched areas; run broader CI gates when the change warrants it.
6. Update the relevant `system-wiki/` page and `system-wiki/log.md` if the change is non-trivial; update the gap register only if an FRS/code gap changes.
7. Summarize files changed, validation run, skipped checks, and whether wiki updates were made.
