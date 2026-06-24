# docs Agent Instructions

## Domain Documentation

This is a single-repo WIMS-BFP prototype. Domain and architecture context lives in:

- `AGENTS.md` — root agent rules, repo map, architecture constraints
- `CLAUDE.md` — architecture overview, key patterns, env vars
- `system-wiki/` — authoritative implementation knowledgebase
- `system-wiki/decisions/` — recorded architecture decisions

### Before exploring, read

1. `AGENTS.md`
2. `CLAUDE.md`
3. The relevant subsystem page from `system-wiki/operations/agent-routing-guide.md`

### Vocabulary

Use WIMS-BFP domain terms from `system-wiki/concepts/frs-module-map.md`, `system-wiki/mocs/system-map.md`, and the relevant subsystem page when naming issues, writing hypotheses, or proposing changes.

### Decision Conflicts

If proposed work contradicts an existing decision in `system-wiki/decisions/`, surface the conflict explicitly before implementing.

## Issue Tracker

Issues and PRDs are tracked in GitHub Issues for `x1n4te/WIMS-BFP-PROTOTYPE`.

```bash
gh issue view <number> --comments      # Read issue + comments
gh issue list --state open              # List open issues
gh issue create --title "..." --body "..."  # Create
gh issue comment <number> --body "..."  # Comment
gh issue edit <number> --add-label "..."     # Add label
gh issue close <number> --comment "..."     # Close
```

Run `gh` from inside the repo clone so it infers the repository from `git remote -v`.

## Triage Labels

| Label | Meaning |
|-------|---------|
| `needs-triage` | Maintainer needs to evaluate |
| `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | Requires human implementation |
| `wontfix` | Will not be actioned |
