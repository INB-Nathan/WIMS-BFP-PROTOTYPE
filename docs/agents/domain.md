# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-repo WIMS-BFP prototype. The repo does not currently use root `CONTEXT.md`, `CONTEXT-MAP.md`, or `docs/adr/` files. Domain and architecture context live in:

- `AGENTS.md` for repository-wide agent rules, priority hierarchy, and context routing.
- `docs/agents/*.md` for operational detail (gotchas, wiki maintenance, coding standards, CI pre-flight).
- `CLAUDE.md` for architecture, commands, and implementation patterns.
- `system-wiki/` for the authoritative implementation knowledgebase.
- `system-wiki/decisions/` for recorded architecture decisions.

## Before exploring, read these

- `AGENTS.md`
- `CLAUDE.md`
- `system-wiki/SCHEMA.md`
- `system-wiki/index.md`
- `system-wiki/mocs/system-map.md`
- `system-wiki/operations/agent-routing-guide.md`
- The subsystem page named by `system-wiki/operations/agent-routing-guide.md` for the task.

If a future `CONTEXT.md`, `CONTEXT-MAP.md`, or `docs/adr/` is added, skills may read it as additional context, but `system-wiki/` remains the project-local source of truth unless that policy changes.

## Use project vocabulary

When issue titles, hypotheses, tests, or refactor proposals name domain concepts, use the WIMS-BFP terms in `system-wiki/concepts/frs-module-map.md`, `system-wiki/mocs/system-map.md`, and the relevant subsystem page.

## Flag decision conflicts

If proposed work contradicts an existing decision in `system-wiki/decisions/`, surface the conflict explicitly before implementing.
