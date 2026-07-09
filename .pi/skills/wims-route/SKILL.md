---
name: wims-route
description: "Ask which WIMS skill or flow fits your situation. Routes feature work, bugs, review, CI, handoff, and codebase learning to the right WIMS workflow. Use when you're unsure what to do next."
disable-model-invocation: true
---

# WIMS-Route

You don't remember every flow, so ask.

A **flow** is a path through the skills and prompts in this repo. Most work follows one **main flow** (idea → deployed code). Two **on-ramps** feed into it. Everything else is codebase health, cross-session work, or standalone.

---

## The main flow: idea → deployed

The route most work travels. You have an idea or requirement and want it built, tested, reviewed, and pushed.

### Step 1 — `/grill-with-docs`

Sharpen the idea through structured interview that writes vocabulary and decisions down as they go. This is the **project-level `grill-with-docs` skill** — it walks the design tree one question at a time with recommended answers, captures resolved terms into `CONTEXT.md` inline, records hard-to-reverse decisions as ADRs in `system-wiki/decisions/`, proposes 2–3 approaches, and gates on user approval before any implementation.

**When to start here:** Any time the requirement is fuzzy, multi-part, or needs design discussion. If the request is already a well-formed GH issue with clear acceptance criteria, you can skip to Step 3.

### Step 2 — Branch: can it stay in one session?

Two paths after grilling (or directly, if the request is well-formed):

- **Single session** → distill into a GitHub issue with concrete acceptance criteria, add the `ready-for-agent` label, then `/issue-implement` right here.
- **Multi-session / big project** → decompose into independently-grabbable issues (each with its own acceptance criteria and label), then start a **fresh session per issue** and run `/issue-implement` against each.

The **[smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)** limits how much you can do in one window before reasoning degrades on most models. If a session nears that threshold before you've split into issues, don't push degraded — `/handoff` and continue in a fresh thread.

### Step 3 — `/issue-implement`

Invoke the `issue-implement` prompt with a GitHub issue number:

> Run `.pi/prompts/issue-implement.md` against issue #NN.

This prompt:
1. Reads `AGENTS.md`, `CLAUDE.md`, `docs/agents/issue-tracker.md`, and the full issue with comments.
2. Reads the relevant subsystem `AGENTS.md` and `system-wiki/` context.
3. Implements the smallest correct change that satisfies the issue **and** the WIMS architecture constraints (thin routes, services own logic, schemas as contracts, RBAC/RLS/PII/audit/PostGIS/offline-sync preserved).
4. Runs targeted tests/lint for touched areas.
5. Updates `system-wiki/` and `system-wiki/log.md` if the change is non-trivial.
6. Summarizes files changed, validation, and skipped checks.

### Step 4 — `/review-wims`

Before committing, run the `review-wims` prompt:

> Run `.pi/prompts/review-wims.md` on the current diff.

This **does not edit files**. It checks three axes:
1. **Spec/issue fidelity** — does the change match the stated request without extra scope?
2. **WIMS architecture** — routes thin, services own logic, schemas as contracts, security constraints preserved.
3. **Risk/quality** — bugs, security issues, test gaps, deploy/CI hazards, docs/wiki drift.

It cites file paths and line numbers for every finding and orders by severity.

### Step 5 — `/looping`

Before presenting the summary, loop back and re-verify everything. The `/looping` skill fires automatically — it re-reads the original request, re-examines every changed file, and catches blind spots. Fixes silently, then re-loops. Only presents when clean.

### Step 6 — `/ci-preflight`

Before pushing, run the `ci-preflight` prompt:

> Run `.pi/prompts/ci-preflight.md`.

This executes the five CI gates:
1. `ruff check .` — backend lint
2. `ruff format --check .` — backend format
3. `pytest -v --tb=short` — backend tests (skipping integration-heavy files)
4. `npm run lint` + `npx vitest run` — frontend
5. SQL migration replay (when migrations changed)

If any gate fails, fix it, re-run, then push.

---

## On-ramps

A starting situation that generates work, then merges onto the main flow at Step 3 (`/issue-implement`).

### Bugs and requests piling up → Triage

Incoming issues that **you didn't create** — bug reports, feature requests — arrive raw and need triage. Use the five canonical triage labels:

| Label | Meaning |
|-------|---------|
| `needs-triage` | Needs evaluation |
| `needs-info` | Waiting on reporter |
| `ready-for-agent` | Fully specified, ready for `/issue-implement` |
| `ready-for-human` | Requires human implementation |
| `wontfix` | Will not be actioned |

**Process:**
1. Read the issue.
2. If unclear → add `needs-info`, request details.
3. If clear and agent-suitable → add `ready-for-agent`, verify acceptance criteria are concrete.
4. If agent can implement → `/issue-implement`.
5. If it needs a human or is rejected → `ready-for-human` or `wontfix`.

Issues created as part of Step 2 are already agent-ready — **don't triage them**.

### Something's broken → `/diagnose-bug`

Run the `diagnose-bug` skill. This runs a structured 6-phase investigation:
1. **Build a feedback loop** — one command that goes red on this bug (aggressive, creative, refuse to give up)
2. **Reproduce + minimise** — shrink the repro to the smallest load-bearing scenario
3. **Hypothesise** — 3–5 ranked falsifiable hypotheses (shown to you before testing)
4. **Instrument** — probe one variable at a time, tagged debug logs
5. **Fix + regression test** — at the correct seam, or flag if no seam exists
6. **Cleanup + post-mortem** — remove instrumentation, document the root cause

The skill has a built-in reference table of 10 common WIMS bug patterns (RLS context loss, wrong session factory, UUID/string mismatch, PII key mismatch, route dependency order, etc.) — check those before building custom hypotheses.

---

## Codebase health

Not feature work — upkeep.

### `/ci-preflight`

Run **before every push or PR**. Even one-line changes. The five gates cost seconds and prevent red merge gates.

### `/wiki-update`

Run `.pi/prompts/wiki-update.md` after any non-trivial change. It:
1. Updates the relevant `system-wiki/` synthesis page.
2. Appends an entry to `system-wiki/log.md`.
3. Updates `system-wiki/gaps/frs-codebase-gap-register.md` only when an FRS/codebase gap is created, closed, or changed.

**When is a change "non-trivial"?** New feature, new API route, DB migration, new Docker service, auth/RBAC/RLS change, behavioral change, config/env var change, docs source change. Bugfixes under 20 LOC, typos, refactors without behavior change, and test-only maintenance do **not** require wiki updates.

### Architecture improvement

Run `/grill-with-docs` on the pain point → create a GitHub issue with acceptance criteria → `/issue-implement` — the same pipeline as feature work. It's the survey that finds the candidates.

---

## Vocabulary underneath

These references run *beneath* the flows above. Reach for them when the **words or structure**, not the process, are the problem.

- **Agent routing guide** — `system-wiki/operations/agent-routing-guide.md`. Read this before any subsystem change to learn exactly which pages and source files are needed (minimum-context principle: don't load the full repo when a subsystem pack is enough).
- **Architecture constraints** — `AGENTS.md` lines 40–49 and `CLAUDE.md`. Never violate: RLS on every `wims.*` table, PII encrypted at rest, audit append-only, PostGIS is source of truth for geometry, offline/PWA dual-path sync engine.
- **Triage labels** — `docs/agents/triage-labels.md`. Maps the five canonical roles to actual GitHub label strings.
- **Gotchas** — `docs/agents/gotchas.md`. Read before every review. Real mistakes made by agents on this repo.
- **FRS module map** — `system-wiki/concepts/frs-module-map.md`. 15-module FRS-to-code routing. Read before claiming what the FRS requires — never cite an FRS module without reading the raw source file first.

---

## Crossing sessions

- **`/handoff`** — compact the conversation to `/tmp/handoff-<topic>.md`. Use when a session is full, you need to branch off, or context is too large. Open a **fresh session** against that file. It's the bridge between context windows, in either direction.
- **`/compact`** (built-in) — summarize earlier turns, stay in the **same conversation**. Use at intentional breaks between phases. Don't compact mid-phase — the agent can lose its way.

---

## Standalone

Off the main flow entirely.

- **`/teacher`** — learn WIMS concepts (architecture, RLS, PII encryption, incident pipeline) across multiple sessions, with a stateful workspace.
- **`/review-pipeline`** — three-axis subagent review (standards, spec, risk). Use for thorough PR reviews where independent reviewers should each check a different axis.
- **`/ponytail-review`** — code review focused exclusively on over-engineering. Finds what to delete: reinvented stdlib, unneeded dependencies, speculative abstractions. Use after implementation to catch bloat before it compounds.
- **`/ponytail`** — minimal implementation mode for low-risk, bounded tasks (presentational UI, pure functions, helpers). **Never** use on auth/RBAC/RLS, PII, audit, PostGIS, offline-sync, Celery orchestration, SQL bootstrap, OpenBao, Suricata, or Nginx paths. Always use `lite` mode on WIMS; `ultra` is prohibited.

---

## Standalone — skill index

| Skill/Prompt | What it does | How to invoke |
|---|---|---|
| `/grill-with-docs` | Design interview with CONTEXT.md + ADR capture | Type `/grill-with-docs` |
| `/diagnose-bug` | 6-phase structured bug investigation | Type `/diagnose-bug` |
| `/issue-implement` | Implement a GitHub issue using WIMS rules | Run `.pi/prompts/issue-implement.md` against issue #N |
| `/review-wims` | 3-axis review (spec, architecture, risk) | Run `.pi/prompts/review-wims.md` |
| `/looping` | Self-verify before presenting | Automatic (model-invoked) |
| `/ci-preflight` | 5-gate CI check | Run `.pi/prompts/ci-preflight.md` |
| `/wiki-update` | Update system-wiki after a change | Run `.pi/prompts/wiki-update.md` |
| `/handoff` | Compact session for fresh thread | Run `.pi/prompts/handoff.md` |
| `/teacher` | Learn WIMS across sessions | Type `/teacher` |
| `/review-pipeline` | Three-axis subagent review | Type `/review-pipeline` |
| `/ponytail-review` | Over-engineering audit | Type `/ponytail-review` |
| `/ponytail` | Minimal implementation (lite only, ultra prohibited) | Type `/ponytail` |

---

## Precondition

No setup needed. The WIMS-BFP repo already has:
- GitHub issue tracker configured
- Five canonical triage labels created
- System-wiki established with synthesis pages and log
- CI pipeline with five gates
- Architecture constraints documented

You are ready to route. Start by answering: **what are you trying to do?**
