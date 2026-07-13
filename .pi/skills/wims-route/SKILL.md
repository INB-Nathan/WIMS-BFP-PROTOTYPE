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

### Step 1 — `/skill:grill-with-docs`

Sharpen the idea through structured interview that writes vocabulary and decisions down as they go. This is the **project-level `grill-with-docs` skill** — invoke it explicitly as `/skill:grill-with-docs`. It walks the design tree one question at a time with recommended answers, captures resolved terms into `CONTEXT.md` inline, records hard-to-reverse decisions as ADRs in `system-wiki/decisions/`, proposes 2–3 approaches, and gates on user approval before any implementation.

**When to start here:** Any time the requirement is fuzzy, multi-part, or needs design discussion. If the request is already a well-formed GH issue with clear acceptance criteria, you can skip to Step 3.

### Step 2 — Branch: can it stay in one session?

Two paths after grilling (or directly, if the request is well-formed):

- **Single session** → distill into a GitHub issue with concrete acceptance criteria, add the `ready-for-agent` label, then `/issue-implement` right here.
- **Multi-session but already specified** → decompose into independently-grabbable implementation issues with acceptance criteria, confirm the issue-creation batch, then start a **fresh session per issue** and run `/issue-implement` against each.
- **Multi-session and still uncertain** → invoke `/skill:wims-wayfinder`. It charts a GitHub map of decision tickets, resolves at most one non-research decision per session, and creates separate `ready-for-agent` implementation issues only after the route is clear and a distinct creation batch is approved.

The **[smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)** limits how much you can do in one window before reasoning degrades on most models. If a session nears that threshold before you've split into issues, don't push degraded — `/handoff` and continue in a fresh thread.

### Step 3 — `/issue-implement`

Invoke the `issue-implement` prompt with a GitHub issue number:

> Run `.pi/prompts/issue-implement.md` against issue #NN.

This prompt:
1. Reads `AGENTS.md`, `CLAUDE.md`, `docs/agents/issue-tracker.md`, and the full issue with comments.
2. Reads the relevant subsystem `AGENTS.md` and `system-wiki/` context.
3. Implements the smallest correct change that satisfies the issue **and** the WIMS architecture constraints (thin routes, services own logic, schemas as contracts, RBAC/RLS/PII/audit/PostGIS/offline-sync preserved).
4. Runs targeted tests/lint for touched areas.
5. Follows `system-wiki/AGENTS.md` for synthesis/index/log synchronization when the change is semantic.
6. Summarizes files changed, validation, and skipped checks.

### Step 4 — `/review-wims`

Before committing, run the `review-wims` prompt:

> Run `.pi/prompts/review-wims.md` on the current diff.

This **does not edit files**. It checks three axes:
1. **Spec/issue fidelity** — does the change match the stated request without extra scope?
2. **WIMS architecture** — routes thin, services own logic, schemas as contracts, security constraints preserved.
3. **Risk/quality** — bugs, security issues, test gaps, deploy/CI hazards, docs/wiki drift.

It cites file paths and line numbers for every finding and orders by severity.

### Step 5 — `/skill:looping`

Before presenting the summary, loop back and re-verify everything. The `looping` skill is model-invoked automatically when its trigger matches; its explicit command is `/skill:looping`. It re-reads the original request, re-examines every changed file, and catches blind spots before presenting.

### Step 6 — `/ci-preflight`

Before pushing, run the `ci-preflight` prompt:

> Run `.pi/prompts/ci-preflight.md`.

Start with task-scoped checks, then follow `docs/agents/ci-preflight.md` and the
canonical `.github/workflows/ci.yml`. The merge gate currently depends on five
blocking jobs: migrations (Alembic), frontend lint/test/build, backend
lint/format/test, Docker config/build, and the security scan. Dependency audits and
coverage are advisory. `make ci-local` is a fast root-level smoke target, not the
full merge gate.

If any applicable gate fails, fix it, re-run it, and report any gate that cannot be
run rather than describing it as passing.

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

Implementation issues created by Step 2's single-session or already-specified branches are already agent-ready — **don't triage them**. Wayfinder decision tickets are planning artifacts and must never receive `ready-for-agent`.

### Something's broken → `/skill:diagnose-bug`

Run `/skill:diagnose-bug`. This starts a structured 6-phase investigation:
1. **Build a feedback loop** — one command that goes red on this bug (aggressive, creative, refuse to give up)
2. **Reproduce + minimise** — shrink the repro to the smallest load-bearing scenario
3. **Hypothesise** — 3–5 ranked falsifiable hypotheses (shown to you before testing)
4. **Instrument** — probe one variable at a time, tagged debug logs
5. **Fix + regression test** — at the correct seam, or flag if no seam exists
6. **Cleanup + post-mortem** — remove instrumentation, document the root cause

The skill has a WIMS bug-pattern reference (RLS transaction context, wrong session factory, UUID/string mismatch, PII key mismatch, and related patterns) — verify each pattern against current code before building custom hypotheses.

---

## Codebase health

Not feature work — upkeep.

### `/ci-preflight`

Run before every push or PR. Select checks by changed scope, then complete the
applicable canonical merge gates; Docker/security/integration checks may require a
full stack and do not necessarily finish in seconds.

### `/wiki-update`

Run `.pi/prompts/wiki-update.md` after a semantic change. It:
1. Updates the relevant `system-wiki/` synthesis page.
2. Updates `system-wiki/index.md` and adds an entry to `system-wiki/log.md`.
3. Updates `system-wiki/gaps/frs-codebase-gap-register.md` only when an FRS/codebase gap is created, closed, or changed.

**When is synchronization needed?** Use semantic impact: features, routes/contracts,
schema, security, workflow, infrastructure, environment/configuration, decisions,
and durable documentation sources require it. Behavior-neutral refactors,
test-only preservation, and typo/format fixes do not unless an existing wiki claim
would become false. Follow `system-wiki/AGENTS.md`; do not use a line-count cutoff.

### Architecture improvement

Run `/skill:grill-with-docs` on the pain point → create a GitHub issue with acceptance criteria → `/issue-implement` — the same pipeline as feature work. It's the survey that finds the candidates.

---

## Vocabulary underneath

These references run *beneath* the flows above. Reach for them when the **words or structure**, not the process, are the problem.

- **Agent routing guide** — `system-wiki/operations/agent-routing-guide.md`. Read this before any subsystem change to learn exactly which pages and source files are needed (minimum-context principle: don't load the full repo when a subsystem pack is enough).
- **Architecture constraints** — the root `AGENTS.md` non-negotiable-boundaries section and `CLAUDE.md` overview. Preserve explicit RLS decisions/policies, encrypted PII, the required append-only audit/verification invariants (verifying final-schema enforcement), PostGIS spatial truth, and offline/PWA compatibility paths; verify documented exceptions and open gaps rather than asserting a universal rule.
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

- **Optional user-local workflows** — commands such as `/teacher` or `/review-pipeline` are not project resources; mention them only after confirming they are installed in the active Pi session.
- **`/skill:ponytail-review`** — code review focused exclusively on over-engineering. Use after low-risk implementation to catch bloat before it compounds.
- **`/skill:ponytail`** — minimal implementation guidance for low-risk, bounded tasks (presentational UI, pure functions, helpers). Never use it to decide auth/RBAC/RLS, PII, audit, PostGIS, offline sync, Celery orchestration, SQL/Alembic, OpenBao, Suricata, or Nginx changes. WIMS allows `lite`; `full` requires consent and `ultra` is prohibited.

---

## Standalone — skill index

| Skill/Prompt | What it does | How to invoke |
|---|---|---|
| `/skill:wims-route` | This router (model invocation disabled) | Type `/skill:wims-route` |
| `/skill:wims-wayfinder` | Manual tracker-backed decision mapping for uncertain multi-session work | Type `/skill:wims-wayfinder` |
| `/skill:grill-with-docs` | Design interview with CONTEXT.md + ADR capture | Type `/skill:grill-with-docs` |
| `/skill:diagnose-bug` | 6-phase structured bug investigation | Type `/skill:diagnose-bug` |
| `/issue-implement` | Implement a GitHub issue using WIMS rules | Prompt template command |
| `/review-wims` | 3-axis review (spec, architecture, risk) | Prompt template command |
| `/skill:looping` | Self-verify before presenting | Usually model-invoked; explicit command available |
| `/ci-preflight` | Task-scoped checks plus canonical push/PR preflight | Prompt template command |
| `/wiki-update` | Update system-wiki after a change | Prompt template command |
| `/handoff` | Compact session for a fresh thread | Prompt template command |
| `/skill:ponytail-review` | Over-engineering audit | Type `/skill:ponytail-review` |
| `/skill:ponytail` | Minimal guidance under WIMS mode limits | Type `/skill:ponytail` |

---

## Precondition

The normal WIMS routes need no additional setup. `/skill:wims-wayfinder` also
requires the user-global `wayfinder` skill; its optional visual prototype path
uses the user-global `brainstorming` server and falls back to text when that
server is unavailable. The WIMS-BFP repo already has:
- GitHub issue tracker configured
- Five canonical triage labels created; Wayfinder labels are created only in an approved first-map batch
- System-wiki established with synthesis pages and log
- CI pipeline with five blocking merge jobs plus advisory checks
- Architecture constraints documented

You are ready to route. Start by answering: **what are you trying to do?**
