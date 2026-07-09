---
description: Review current WIMS changes for correctness, architecture, and risk
argument-hint: "[focus]"
---
Review the current WIMS changes. Focus: `$ARGUMENTS`.

Do not edit files.

Review process:
1. Read `AGENTS.md`, `CLAUDE.md`, and relevant scoped `AGENTS.md` files.
2. Inspect `git status`, `git diff --stat`, and the relevant diffs.
3. Check three axes:
   - spec/issue fidelity: does the change satisfy the stated request without extra scope?
   - WIMS architecture: routes thin, services own business logic, schemas as contracts, RBAC/RLS/PII/audit/PostGIS constraints preserved.
   - risk/quality: bugs, security issues, test gaps, deploy/CI hazards, docs/wiki drift.
4. Cite file paths and line numbers for findings you have read.
5. Return findings ordered by severity; include “No findings” only if no actionable issues remain.
