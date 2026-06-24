# System Wiki Maintenance

## Update Rule

For any non-trivial change to code, workflow, schema, infrastructure, test behavior, or documentation sources, agents MUST update the project-local system wiki before finishing:

1. **Update** the relevant `system-wiki/` synthesis page.
2. **Append** an entry to `system-wiki/log.md`.
3. **Update** `system-wiki/gaps/frs-codebase-gap-register.md` only when the change creates, closes, or modifies an FRS/codebase gap.
4. **Do not edit** `system-wiki/raw/` unless replacing it with a newer authoritative source batch.

## When to Update — Defined Thresholds

**Wiki update required when:**
- New feature or endpoint
- New API route
- Database migration
- New Docker service
- Auth/RBAC/RLS change
- Workflow or behavioral change
- Configuration or environment variable change
- Documentation source change (e.g., updating a synthesis page)

**Wiki update not required when:**
- Bugfix under 20 LOC
- Typo fixes (code comments, docs)
- Refactoring without behavior change (rename, extract, inline)
- Test-only maintenance (new tests for existing behavior, fixture updates)
- Dependency version bumps (no API change)

If unsure, default to updating — a brief `log.md` entry is cheap and prevents drift.

## After Every Change

Before the final response, explicitly confirm whether the wiki was updated, or briefly state why no wiki update was needed.
