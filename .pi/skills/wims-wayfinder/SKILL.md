---
name: wims-wayfinder
description: Chart or work a WIMS-BFP Wayfinder map for large, uncertain, multi-session efforts using GitHub decision tickets. Invoke manually; it plans by default, uses batch confirmation, and resolves at most one non-research ticket per session.
disable-model-invocation: true
---

# WIMS Wayfinder

Use the user-global `wayfinder` skill as the methodology and this skill as the WIMS-BFP GitHub profile.

## Preconditions

1. Read `AGENTS.md`, `.pi/AGENTS.md`, `docs/agents/issue-tracker.md`, and `system-wiki/operations/agent-routing-guide.md`.
2. Load `~/.pi/agent/skills/wayfinder/SKILL.md` and its tracker contract. If absent, stop and ask the user to install the global skill; do not improvise a partial remote workflow.
3. Read the relevant scoped `AGENTS.md` and smallest system-wiki context pack for the effort.
4. Run GitHub operations from this clone and verify `gh auth status` plus `gh repo view --json nameWithOwner`. The expected repository is `x1n4te/WIMS-BFP-PROTOTYPE`; stop on a mismatch unless the user explicitly names another target.
5. Read [GitHub operations](references/github-operations.md) and [the concurrency protocol](references/concurrency-protocol.md) before any tracker mutation.

## WIMS boundaries

- Wayfinder decides how to reach a destination; it does not implement the destination by default.
- Accepted issues, raw FRS sources, recorded decisions, architecture constraints, and security rules remain authoritative. Surface conflicts rather than deciding around them.
- Decision tickets never receive `ready-for-agent`.
- New implementation issues are separate linked follow-ups, not map children. Create them only after the map is complete, their acceptance criteria are independently actionable, and the user confirms that creation batch.
- Routine map bookkeeping does not update `system-wiki`. An approved durable architecture, behavior, security, or workflow decision follows `system-wiki/AGENTS.md`; update the gap register only when FRS/code alignment materially changes.
- Do not perform production, destructive, credential, PII, migration, deployment, or data operations merely because a `wayfinder:task` ticket exists. Existing WIMS approvals and safety boundaries still apply.

## Labels

Use exactly:

- `wayfinder:map`
- `wayfinder:research`
- `wayfinder:prototype`
- `wayfinder:grilling`
- `wayfinder:task`

Labels indicate map/type only. Claims and map-writer locks are append-only comments. If labels are missing, include their creation in the chart preview; the batch confirmation authorizes only the displayed missing labels.

## GitHub artifact conventions

Map title:

```text
Wayfinder: <destination name>
```

Decision ticket titles should be readable decisions or questions, not generic numbered tasks. Refer to them by linked title in user-facing output.

Add one machine-readable marker to each body:

```html
<!-- wims-wayfinder:v1 kind=map -->
<!-- wims-wayfinder:v1 kind=ticket map=<map-number> type=<research|prototype|grilling|task> -->
```

Native GitHub parent/sub-issue and blocked-by relationships are authoritative. Markers provide validation and recovery; never infer hierarchy from title text alone.

## Authorization: batch confirmation

Loading or invoking this skill is not blanket authorization for remote changes.

### Chart mode

Before mutation, show one preview containing:

- repository;
- map title and complete body;
- missing labels to create;
- every initial child title, type, and question;
- dependency edges;
- fog and exclusions;
- the exact categories of mutations that will occur.

One explicit approval authorizes that displayed batch: missing-label creation, map creation, child creation, and dependency wiring. Material additions or scope changes require a new preview and confirmation. Retry only verified missing steps from a partially completed approved batch.

### Work mode

An explicit request to work a named map authorizes read operations, claiming one eligible ticket, resolving that one ticket, closing it, and updating the map under the accepted writer protocol. It does not authorize bulk closure, label creation, destination changes, implementation work, or implementation-issue generation.

## Capability mapping

### Grilling

Use `/skill:grill-with-docs` as guidance for one-question-at-a-time HITL discussion. The issue resolution remains the detailed ticket record. Create an ADR only for an approved durable architecture decision; do not create ADR or glossary churn for routine choices.

### Research

Use an available `researcher` subagent only after listing configured agents and selecting the user-approved model. Give it one precise question, evidence requirements, no tracker mutation authority, and a bounded output. The controlling session verifies findings and records the resolution. Independent research tickets may run concurrently; other ticket types remain one per session.

### Prototype

Follow [the prototype companion](references/prototype-companion.md). It uses the optional user-global brainstorming server for local visual feedback, synthetic data, and disposable artifacts. Prototype work cannot merge or silently become implementation.

### Task

Perform a bounded prerequisite only when it is necessary to expose facts for a later decision. If it requires human action, provide a precise checklist and wait. Existing production and destructive-action approvals remain mandatory.

## Chart mode

1. Establish a testable destination with the user, one question at a time.
2. Survey breadth-first. Classify each area as decided, a precise ticket, fog, or out of scope.
3. If no meaningful fog or cross-session scope remains, recommend the normal WIMS issue/spec flow instead of creating a map.
4. Build and present the complete batch preview.
5. After approval, execute the recoverable create-then-wire sequence in `references/github-operations.md`.
6. Re-read the map and direct children; report the verified frontier and any partial failure.
7. Stop. Charting does not hand-resolve tickets.

## Work mode

1. Load the map at low resolution and verify its marker, destination, and direct children.
2. Use the user-named eligible ticket or the first open, unblocked, unclaimed child in GitHub sub-issue order, then issue number as tie-breaker.
3. Claim it with the protocol in `references/concurrency-protocol.md`. Assignment is optional visual metadata and never claim authority.
4. Resolve exactly one non-research ticket using its type mapping.
5. Post the structured resolution marker/comment, close the ticket as completed, and update the map through the writer-lock protocol.
6. Create newly precise tickets only after previewing and receiving confirmation for that additional batch. Remove graduated fog only after its replacement tickets exist.
7. Report the new frontier and stop.

If a ticket is beyond the destination, close it as `not planned`, add its linked gist and reason under Out of scope through the writer protocol, and do not add it to Decisions so far.

## Completion and implementation handoff

A map is complete only when the destination is still valid, no open decision blocks it, and no in-scope fog remains. Then:

1. report the completed decision map;
2. draft independently actionable implementation issues with acceptance criteria;
3. show a separate creation batch;
4. create only after confirmation;
5. apply `ready-for-agent` only to issues that are fully specified and safe for `/issue-implement`;
6. retain links back to the completed Wayfinder map as provenance.

## Final report

State:

- destination and mode;
- confirmed batch and actual tracker mutations;
- linked ticket titles and the resolved decision;
- current frontier, blocked tickets, and fog;
- concurrency conflicts or partial failures;
- documentation/ADR/wiki/gap effects;
- next handoff without beginning implementation.
