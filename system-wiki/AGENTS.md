# System-Wiki Instructions

## Scope

Applies to `system-wiki/` and descendants. It supplements the root `AGENTS.md`.
The wiki is an agent-routing and implementation-synthesis knowledgebase, not the
raw requirements archive, user manual, or a substitute for reading source.

## Required Context

Before editing, read:

1. `system-wiki/SCHEMA.md`
2. `system-wiki/index.md`
3. `system-wiki/mocs/system-map.md`
4. the task pack in `system-wiki/operations/agent-routing-guide.md`
5. the live implementation/config/tests and raw requirement sources cited by the
   page being changed

Useful maps include `backend/api-route-map.md`, `frontend/route-map.md`,
`database/schema-overview.md`, `security/security-baseline.md`, and
gaps under `gaps/`.

## Authority and Provenance

1. User-supplied files under `raw/frs/` are requirement sources.
2. Live repository files under `src/`, executable config, and tests are current
   implementation evidence.
3. Wiki pages are downstream synthesis and routing.
4. Recorded decisions explain approved choices but do not make a stale
   implementation claim true.

If sources disagree, state the discrepancy and update the relevant gap; never
silently rewrite the FRS or code claim into agreement.

- Read the exact raw FRS file before saying “Module N requires X.” The module map
  is not requirement evidence.
- Treat `raw/` as immutable. Change it only when replacing a source with a newer
  authoritative batch, preserving provenance.
- Do not use old sessions, handoffs, plans, reviews, or snapshots as proof of
  current behavior without live-source verification.

## Page Contract

Follow `SCHEMA.md`:

- lowercase hyphenated filenames;
- required YAML frontmatter with `title`, `created`, `updated`, `type`, `tags`,
  `sources`, and `status`;
- repository paths in backticks for implementation evidence;
- at least two useful wiki links on synthesis pages;
- split pages that have become unwieldy rather than creating an unrelated dump;
- use `status: verified` only when the cited implementation was actually checked.

Keep statements scoped and dated where behavior is environment- or release-specific.
Avoid duplicating full route, table, service, or test inventories across pages;
link to the owner map.

## When to Synchronize the Wiki

Update the relevant synthesis page when a change semantically alters any of:

- feature/workflow behavior or terminology;
- API routes/contracts or frontend routes;
- database schema, RLS, audit/immutability, encryption, or PostGIS behavior;
- auth/RBAC/Keycloak, public-DMZ, IDS/XAI, or other security posture;
- Compose/services, CI/CD, deployment, environment variables, or operations;
- durable documentation sources or architecture decisions used by the wiki.

Behavior-neutral refactors, tests that only preserve current behavior, dependency
bumps with no documented impact, typo/format fixes, and transient investigation
artifacts do not require synthesis churn unless an existing wiki statement becomes
false.

For every actual wiki content change:

1. Update the affected synthesis/routing page(s).
2. Update `system-wiki/index.md` so its routing, inventory, last-change summary,
   and page count remain accurate.
3. Prepend or append a concise, dated entry to `system-wiki/log.md` describing
   scope, sources/files, outcome, and validation.
4. Update `gaps/frs-codebase-gap-register.md` only when a gap is created, closed,
   reclassified, or materially changed.

Use semantic impact rather than a line-count threshold. Do not create empty log or
gap churn simply to satisfy a checklist.

## Validation

Before finishing:

- re-read every cited source and changed wiki page;
- verify frontmatter dates/sources/status and at least two relevant links;
- verify referenced repository paths exist;
- search for stale duplicate claims in owner pages;
- confirm `index.md` and `log.md` reflect the change;
- run `git diff --check -- system-wiki` and inspect the final diff/status.

When FRS alignment changed, quote or point to the exact raw source evidence and
state the gap-register result. The final response must say which wiki files changed
or why no wiki update was necessary.
