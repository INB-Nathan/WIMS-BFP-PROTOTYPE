---
name: code-review
description: Review code changes against coding standards and spec fidelity using WIMS domain-specific voice agents. Use when a user asks to review a branch, PR, work-in-progress changes, or says review since X, code review, review this diff, or review my changes. Two-axis review covering standards via architect and security voices and spec via product and qa voices with optional devops voice for infra-touching diffs.
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the originating issue / PRD / spec?

Both axes run using WIMS domain-specific voice agents in parallel, then this skill aggregates their findings.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here — not inside the voice agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`) — fetch via `gh issue view <N>` or `gh pr view <N>`.
2. A path the user passed as an argument.
3. A PRD/spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** axis skips and reports "no spec available".

### 3. Identify the standards sources

Check these repo-specific standards sources:

- `AGENTS.md`, `src/AGENTS.md`, `src/backend/AGENTS.md`, `src/frontend/AGENTS.md` — architecture and security boundaries
- `system-wiki/security/security-baseline.md` — auth, RBAC, RLS, PII, audit, IDS/XAI standards
- `system-wiki/database/schema-overview.md` — schema and migration conventions
- `system-wiki/architecture/pwa-tests-cicd.md` — offline/PWA and CI conventions
- `CLAUDE.md` — broad architecture overview

Also carry the **Fowler smell baseline** (see below) into the Standards axis.

### 4. Determine which voices to use

**Standards axis** always uses two voices:
- `wims.wims-voice.architect` — patterns, coupling, boundaries, duplication, speculative abstraction, layering violations. Covers most Fowler smells (Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest).
- `wims.wims-voice.security` — auth bypass, PII exposure, audit trail gaps, injection vectors, missing RBAC, crypto weaknesses. Covers security-specific standards from the security baseline.

**Spec axis** always uses two voices:
- `wims.wims-voice.product` — spec fidelity, requirement coverage, scope creep, UX gaps, terminology drift, FRS alignment.
- `wims.wims-voice.qa` — test coverage gaps, edge cases, acceptance criteria, concurrency/race conditions, input validation, state machine transitions.

**DevOps voice** — add `wims.wims-voice.devops` conditionally: only when the diff touches files under `docker/`, `.github/workflows/`, `nginx/`, or Compose/YAML infrastructure files. When added, include it in the Standards axis (it reviews infrastructure standards).

### 5. Spawn voice agents in parallel

Use `subagent()` with `context: "fresh"` and `async: true` for all voices. Wait on all results before aggregating.

The diff already contains the code changes; each voice inspects files directly from the repo. Include in each voice's task:

- The `git diff <fixed-point>...HEAD` command and commit list so they know the scope.
- The spec source (path or fetched content) for product and qa voices.
- The standards sources list and which voice covers which standards.

#### Standards axis task templates

**Architect voice task:**
```
Review the diff from {fixed_point}...HEAD ({N} commits: {commit_list}).
Check for:
- Duplication of existing adapters, services, or utilities in the diff
- Layering violations (route doing domain logic, service doing HTTP, Celery task doing ad hoc orchestration)
- Over-engineering: speculative abstraction, unnecessary indirection, dead flexibility
- Boundary violations (frontend coupling to DB, service doing raw DB work)
- Tech debt introduction without compensating value
- Fowler baseline smells in the changed code: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest

Use the standard [BLOCKER | WARNING | INFO] output schema.
Under 400 words.
```

**Security voice task:**
```
Review the diff from {fixed_point}...HEAD ({N} commits: {commit_list}).
Check for:
- Auth bypass: admin/superuser session used for domain queries, RLS not enforced on new tables
- PII exposure in logs, API responses, or plaintext storage in changed files
- Audit trail gaps for mutations on protected records
- Injection vectors (SQL, path, command, SSTI) in new or changed code
- Missing RBAC check on new routes
- Crypto weaknesses: plaintext fallback, weak AAD, missing key-version

Use the standard [BLOCKER | WARNING | INFO] output schema.
Under 400 words.
```

#### Spec axis task templates

**Product voice task:**
```
Review the diff from {fixed_point}...HEAD ({N} commits: {commit_list}).
Spec source: {spec_path_or_content}

Check for:
- Uncovered acceptance criteria from the spec
- Scope creep beyond approved requirements
- Missing error/loading/empty states in user-facing changes
- UX gaps: confusing flow, missing confirmation, unclear feedback
- Terminology drift from established WIMS domain language
- Gaps between FRS requirements and proposed implementation

Use the standard [BLOCKER | WARNING | INFO] output schema.
Under 400 words.
```

**QA voice task:**
```
Review the diff from {fixed_point}...HEAD ({N} commits: {commit_list}).
Spec source: {spec_path_or_content}

Check for:
- Missing test coverage for error paths, edge cases, concurrent access
- Acceptance criteria not covered by tests
- Network timeout, retry, failure recovery behavior
- Input validation gaps (SQL injection, XSS, boundary values, unvalidated sort/filter fields)
- State machine transitions and invalid state guards
- Race conditions, idempotency gaps, ordering assumptions

Use the standard [BLOCKER | WARNING | INFO] output schema.
Under 400 words.
```

#### DevOps voice task (conditional)

Only spawn when the diff touches infra files.

**DevOps voice task:**
```
Review the diff from {fixed_point}...HEAD ({N} commits: {commit_list}).
Check for:
- Rate limits, upload limits, timeouts, SSE buffering
- Healthcheck intervals, timeouts, stop_grace_period
- restart policies, resource limits, depends_on conditions
- Observability: logging, metrics, alerting gaps
- CI/CD pipeline gate correctness
- Environment variable contracts, secrets hygiene

Use the standard [BLOCKER | WARNING | INFO] output schema.
Under 400 words.
```

### 6. Aggregate

Launch all voices with `async: true`, then `wait({ all: true })` for completion.

Present the two reports under `## Standards` and `## Spec` headings:

- `## Standards` — architect findings + security findings + devops findings (if applicable). Group by severity (BLOCKER, WARNING, INFO) across all Standards voices, deduplicate.
- `## Spec` — product findings + qa findings. Group by severity, deduplicate.

Do **not** merge or rerank across the two axes — they are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any).

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.

## Why WIMS voices instead of generic subagents

The WIMS-BFP repo has 5 domain-specific voice agents that are each an expert in one facet of review. They already use a standardized [BLOCKER | WARNING | INFO] output schema and understand WIMS-specific architecture boundaries, security rules, and domain language. Using them gives higher-quality, domain-aware findings than a generic reviewer would produce.

This project-level version of the code-review skill wraps those voices into the two-axis framework. When reviewing non-WIMS repos, use the global version at `~/.pi/agent/skills/code-review/SKILL.md`.
