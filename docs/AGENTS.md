# Documentation Instructions

## Scope

Applies to `docs/` and descendants. It supplements the root `AGENTS.md`.
Documentation can change product, operational, and security decisions; treat it as
reviewable source, not harmless prose.

## Authority and Placement

- Raw product requirements live in `system-wiki/raw/frs/`. Read the exact raw FRS
  file before attributing a requirement to a module; the module map is only a
  routing index.
- Current implementation facts come from live code/config/tests. `system-wiki/`
  synthesizes those facts for agents and must cite its sources.
- Durable architecture decisions live in `system-wiki/decisions/`. Surface a
  conflict before proposing or documenting a different architecture.
- Put user/operations/security runbooks and durable project documentation in the
  appropriate `docs/` subtree.
- Specs and plans describe intended work; reviews, handoffs, PR notes, audits, and
  dated reports are historical evidence. Do not present them as current behavior
  without re-verifying the implementation.

Before creating a new document, search for an existing owner page. Update that page
instead of creating a second source of truth unless the new artifact has a distinct
lifecycle or audience.

## Writing and Evidence Rules

- Read the referenced source before writing. Cite repository paths and, when useful,
  symbols or verified line ranges.
- Distinguish requirement, current implementation, decision, proposal, test result,
  and unresolved gap.
- Avoid volatile hard-coded counts, versions, ports, image tags, route inventories,
  or test totals. Derive them from configuration and include an as-of date/command
  when the number is itself important.
- Use WIMS terminology from `CONTEXT.md` and the relevant system-wiki subsystem
  page. Do not normalize distinct concepts into a convenient synonym.
- Record deviations from an issue/spec explicitly; do not rewrite acceptance
  criteria after implementation to make a mismatch disappear.
- Never include secrets, real credentials, private keys, access tokens, PII, raw
  production payloads, or unredacted sensitive logs/screenshots.
- Keep commands copy-pasteable, state their working directory and prerequisites,
  label destructive/production commands, and provide a safe verification step.
- Preserve the purpose and date of historical artifacts; correct current routing
  docs rather than silently modernizing an old review or handoff.

## Reviews, Issues, and PRDs

Read `docs/agents/gotchas.md` before writing or updating a review.

GitHub Issues is the tracker for `x1n4te/WIMS-BFP-PROTOTYPE`:

- command conventions: `docs/agents/issue-tracker.md`
- canonical triage labels: `docs/agents/triage-labels.md`
- full issue/spec context: `gh issue view <N> --comments`

Run `gh` inside this clone so repository inference is explicit, and verify PRs target
`master`, not stale `main`. Do not create/comment/close an issue or post a PR review
unless the user asked for that remote side effect.

## Documentation Validation

For documentation-only changes, at minimum:

```bash
git diff --check
rg -n 'path/or/symbol/being-cited' <relevant-source>
git status --short
```

Additionally verify:

- every referenced repository path exists or is clearly marked proposed;
- relative links resolve from the document's directory;
- commands match current scripts, package metadata, Compose, or CI;
- quoted requirements match the raw source;
- dates/status labels and affected issue/PR numbers are accurate;
- the diff does not rewrite unrelated historical material.

If a durable documentation source changes implementation knowledge, update the
relevant system-wiki synthesis/index/log under `system-wiki/AGENTS.md`. In the final
response, state which docs were validated and whether wiki synchronization was
needed.
