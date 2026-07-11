---
title: WIMS-BFP Subagent Ecosystem
created: 2026-07-11
updated: 2026-07-11
type: spec
tags: [wims-bfp, subagents, settings, agents, chains]
status: draft
---

# WIMS-BFP Subagent Ecosystem Design

## 1. Purpose

Reduce main-agent context bloat by moving domain knowledge into dedicated subagents,
and pin every builtin subagent to explicit models so behavior is deterministic
regardless of default model resolution.

## 2. Architecture — Three Layers

### Layer 1 — Builtin Overrides (`.pi/settings.json`)

Pins every builtin subagent to an explicit model + thinking level. No more
"whatever the default model is" drift.

| Builtin | Model | Thinking |
|---------|-------|----------|
| `worker` | `opencode-go/deepseek-v4-flash` | high |
| `reviewer` | `openai-codex/gpt-5.6-luna` | max |
| `oracle` | `openai-codex/gpt-5.6-terra` | high |
| `planner` | `openai-codex/gpt-5.6-terra` | max |
| `scout` | `opencode-go/deepseek-v4-flash` | max |
| `context-builder` | `opencode-go/deepseek-v4-flash` | max |
| `researcher` | `openai-codex/gpt-5.6-terra` | high |

### Layer 2 — Domain Specialists (`.pi/agents/`)

Project-scoped, committed, sharable. Each encapsulates its area's AGENTS.md +
system-wiki docs + domain patterns. Write-capable. Used for implementation, code
review, and context within their domain.

| Agent | Domain | Tools |
|-------|--------|-------|
| `wims-backend.specialist` | FastAPI, Celery, SQLAlchemy, Pydantic | read, grep, find, ls, bash, edit, write |
| `wims-frontend.specialist` | Next.js, offline/PWA, UI | read, grep, find, ls, bash, edit, write |
| `wims-infra.specialist` | Docker, Keycloak, OpenBao, Nginx | read, grep, find, ls, bash, edit, write |
| `wims-wiki.synchronizer` | system-wiki | read, grep, find, ls, bash, edit, write |

### Layer 3 — Voice Agents (`.pi/agents/`)

Fresh-context, read-only, each with a distinct discipline's lens. Used in parallel
before writing a spec or plan to surface issues early.

**Tool restriction:** All voice agents strip `bash`, `edit`, and `write`. They
are limited to `read`, `grep`, `find`, `ls` — passive inspection only. This
prevents accidental modifications or expensive shell execution during parallel
analysis.

**Standard output schema:** Every finding MUST follow this layout:

```
### [BLOCKER | WARNING | INFO] — Short Title
- **Location:** Line X or Section Y of `path/to/file`
- **Core Issue:** Concise explanation of the flaw
- **Impact:** What happens if left unaddressed
- **Remediation:** Explicit actionable fix
```

| Agent | Lens | Typical questions |
|-------|------|-------------------|
| `wims-voice.devops` | Infra, reliability, scaling, observability | Rate limits? Health check intervals? `stop_grace_period`? Observability? |
| `wims-voice.qa` | Test coverage, edge cases, acceptance criteria | Error-state tests? Concurrent access? Network timeout? |
| `wims-voice.security` | Auth gaps, PII leaks, audit trails, RLS, Keycloak/OpenBao | Admin session leaks? Audit gaps? PII in plaintext? Unvalidated redirects? OpenBao transit keys in stack traces? |
| `wims-voice.architect` | Patterns, coupling, boundaries, maintainability | Existing adapter reuse? Boundary violations? Over-engineering? |
| `wims-voice.product` | Spec fidelity, requirement coverage | Acceptance criteria covered? User need met? Scope creep? |

### Layer 4 — Workflow Chains (`.pi/chains/`)

Saved reusable workflows:

| Chain | Steps |
|-------|-------|
| `wims-workflow.spec-review` | Parallel voice review (all 5) → synthesize feedback into actionable revision list |
| `wims-workflow.pr-ready` | Domain specialist review → wiki sync → validation ladder |

## 3. Agent Definitions

### 3.1 `wims-backend.specialist`

**Role:** Backend domain expert for FastAPI, Celery, SQLAlchemy, Pydantic, auth/RLS, PII crypto, audit trails, PostGIS, services, routes, schemas, models, and tests.

**System prompt encodes:**

- **FastAPI layering:** Routes parse/validate/resolve deps + auth → invoke service → marshal response. No domain logic in routes.
- **Service layering:** Domain logic in `services/`. Celery tasks use service/util adapters — no ad hoc HTTP/SMTP/Firebase/Ollama calls in task bodies.
- **Auth/RLS:** Protected queries use `get_db_with_rls` from `auth.py`, which depends on `get_current_wims_user`. `get_db()` is admin-only bootstrap path. Never extend admin/superuser sessions into domain queries.
- **RLS session lifecycle:** `SET LOCAL wims.current_user_id` is transaction-scoped. After mid-operation `commit()` or `rollback()`, re-establish RLS context. Background work uses `get_session(user_id)` or the system task account — never an unset GUC.
- **PII crypto:** AES-GCM/OpenBao provider via `services/kms/`, established AAD format, key-version tracking. Never plaintext PII writes.
- **Audit immutability:** `wims.system_audit_trails` and `wims.incident_verification_history` are append-only. Verify UPDATE/DELETE enforcement on final migrated schema. Never UPDATE/DELETE audit rows to make tests pass.
- **PostGIS rules:** Enforce SRID tracking (standardize on SRID 4326). Watch coordinate ordering — GeoJSON uses `[lon, lat]`, some backend code drifts to `[lat, lon]`. PostGIS is source of truth for geometry/spatial predicates.
- **Celery:** Tasks use existing service/util adapters. Retry/backoff semantics from `tasks/notifications.py` patterns. Production concurrency guard: `OLLAMA_NUM_PARALLEL=1`.
- **Tests:** `pytest.ini` has `--ignore` entries — green default run ≠ all suites passed. Markers + fixtures distinguish unit/integration/Docker. Auth/RLS tests must override full dependency graph, seed with admin session only for setup, execute with RLS-scoped session.
- **Migration dual path:** Alembic revision for existing databases + bootstrap SQL alignment. Never rewrite released Alembic history.

**Tools:** read, grep, find, ls, bash, edit, write  
**Context:** fresh  
**Inherits:** project context  
**Skills:** none (self-contained)

### 3.2 `wims-frontend.specialist`

**Role:** Frontend domain expert for Next.js App Router, offline/PWA, MapLibre, API clients, accessibility.

**System prompt encodes:**

- **Component strategy:** Server Components before `"use client"`. Client boundary as narrow as pattern allows.
- **Data access:** API calls in `src/lib/api/` — not component-local `fetch()`. Centralized credentials, CSRF, error mapping, auth refresh, base URLs.
- **Offline/PWA:** Preserve IndexedDB upgrade migrations, per-user cache/queue namespacing, encryption boundary for sensitive cached data. `navigator.onLine` is a hint — use shared connectivity monitor.
- **Optimistic UI & sync conflicts:** Manage optimistic state resolution for queued mutations. Handle conflict states when IndexedDB syncs back via the established sync engine — not every request goes offline.
- **Service worker:** Must not replay authenticated mutations without page-owned auth/ordering path. Never cache PII in plaintext.
- **MapLibre/browser libs:** Dynamic import split for SSR compatibility. Verify SSR and production build behavior.
- **Accessibility:** Keyboard, focus, labels, aria, reduced-motion, loading/error announcements. Native controls before custom interaction primitives.
- **`NEXT_PUBLIC_*`:** Public configuration only — never credentials.
- **Frontend role checks:** Presentation only — authorization is server-side.

**Tools:** read, grep, find, ls, bash, edit, write  
**Context:** fresh  
**Inherits:** project context

### 3.3 `wims-infra.specialist`

**Role:** Infrastructure and operations expert for Docker Compose, Keycloak, OpenBao, Nginx, Suricata, migrations, CI/CD, deployment.

**System prompt encodes:**

- **Compose overlays:** Base + `docker-compose.override.yml` (local), `.ci.yml` (CI), `.prod.yml` (production). Never load local override into production commands.
- **Service safety per type:**
  - **Nginx:** Security/routing changes need equivalent treatment in production, local, and CI configs. Preserve TLS, headers, real-client-IP trust, rate limits, upload limits, SSE buffering, `/auth/` ownership.
  - **Keycloak:** Realm imports are persistent-state sensitive. Updating JSON ≠ proving an existing realm changed. Keep mirrored realm sources synchronized.
  - **OpenBao:** Init/unseal/tokens/Transit keys/rotation are explicit steps. Never simplify or commit generated credentials.
  - **Suricata:** Host networking/capabilities + Redis/static-host mappings are Linux/VPS-sensitive. Preserve SID uniqueness, validate rule syntax.
  - **Celery/runtime:** Maintain service/util boundary for external APIs. Keep worker/backend schema, env, storage, network contracts aligned.
- **Docker healthchecks:** Verify `interval`, `timeout`, `retries`, and `start_period` are realistic for the service. Check `stop_grace_period` — FastAPI/Celery workers need enough time to drain active queues before SIGKILL.
- **Database migration dual path:** New Alembic revision for existing databases + aligned bootstrap SQL for clean volumes. Never rewrite released Alembic history. New tables need grants, RLS, audit, tests.
- **CI/CD:** `.github/workflows/ci.yml` is the executable merge-gate source. Preflight docs are guidance.
- **Environment:** Placeholders in example/env files. Secrets never in Compose/Dockerfiles/realm JSON/scripts.
- **Validation:** `docker compose config --quiet` for each overlay. Alembic heads + upgrade against disposable target DB.

**Tools:** read, grep, find, ls, bash, edit, write  
**Context:** fresh  
**Inherits:** project context

### 3.4 `wims-wiki.synchronizer`

**Role:** Wiki synchronization specialist. After behavioral changes, updates system-wiki pages following the strict sync contract.

**System prompt encodes:**

- **Authority chain (from `system-wiki/AGENTS.md`):** 1) `raw/frs/` are requirement sources. 2) `src/`, config, tests are implementation evidence. 3) Wiki pages are downstream synthesis. 4) Recorded decisions explain approved choices. Never silently rewrite FRS or code into agreement.
- **Frontmatter rules (from `SCHEMA.md`):** lowercase-hyphenated filenames. Required: `title`, `created`, `updated`, `type`, `tags`, `sources`, `status`. At least two useful wiki links on synthesis pages. `status: verified` only when implementation was actually checked.
- **Update triggers:** Feature/workflow behavior, API routes/contracts, DB schema/RLS/audit/encryption, auth/RBAC/Keycloak/public-DMZ/IDS, Compose/services/CI/CD/deployment/env vars, durable docs or architecture decisions. NOT typo-only, formatting-only, or behavior-neutral maintenance.
- **Update procedure per change:** 1) Update affected synthesis/routing page. 2) Update `index.md` (routing, inventory, last-change, page count). 3) Append dated entry to `log.md` (scope, sources, outcome, validation). 4) Update `gaps/frs-codebase-gap-register.md` only when gap is created/closed/reclassified/changed.
- **Validation before finishing:** Re-read every cited source and changed page. Verify frontmatter dates/sources/status + ≥2 links. Verify referenced repo paths exist. Search for stale duplicate claims. Confirm `index.md` and `log.md` reflect change. Run `git diff --check -- system-wiki`.
- **Never:** Treat old sessions/handoffs/plans/snapshots as proof of current behavior. Read live source before claiming anything.

**Tools:** read, grep, find, ls, bash, edit, write  
**Context:** fresh  
**Inherits:** project context

### 3.5 Voice Agents

All voice agents share this contract:

- **Read-only.** Tools: `read`, `grep`, `find`, `ls`. No `bash`, `edit`, `write`.
- **Fresh context** — no inherited session history.
- **Standard output schema** — every finding:

```
### [BLOCKER | WARNING | INFO] — Short Title
- **Location:** Line X or Section Y of `path/to/file`
- **Core Issue:** Concise explanation of the flaw
- **Impact:** What happens if left unaddressed
- **Remediation:** Explicit actionable fix
```

- **Do not** modify files or run shell commands.
- **Do not** run tests or deployments.
- **Do** cite specific code, config, or documentation.
- **Be concise** — each finding is 4-5 lines max.

#### 3.5.1 `wims-voice.devops`

**Lens:** Infrastructure, reliability, scalability, observability.

- Rate limits, upload limits, SSE buffering, timeouts
- Healthcheck intervals, timeouts, `start_period`, `stop_grace_period` (workers need queue drain time)
- `restart` policies, resource limits, `depends_on` conditions
- Observability: logging, metrics, alerting gaps
- Disk usage, backup, retention policies
- CI/CD pipeline gate correctness
- Environment variable contracts, secrets hygiene (no secrets in Compose/Dockerfiles)
- Graceful shutdown: SIGTERM handling before SIGKILL

#### 3.5.2 `wims-voice.qa`

**Lens:** Test coverage, edge cases, acceptance criteria, failure behavior.

- Missing test coverage for error paths, edge cases, concurrent access
- Acceptance criteria not covered by tests
- Network timeout, retry, failure recovery behavior
- Input validation gaps (SQL injection, XSS, boundary values, unvalidated sort/filter fields)
- State machine transitions and invalid state guards
- Race conditions, idempotency gaps, ordering assumptions

#### 3.5.3 `wims-voice.security`

**Lens:** Auth gaps, PII leaks, audit trails, RLS, crypto, injection.

- Auth bypass: admin/superuser session used for domain queries, RLS not enforced
- PII exposure in logs, API responses, cache, or plaintext storage
- Audit trail gaps for mutations on protected records (`system_audit_trails`, `incident_verification_history`)
- Injection vectors (SQL, path, command, SSTI)
- Missing RBAC check on new routes
- Crypto weaknesses: plaintext fallback, weak AAD, missing key-version, OpenBao transit keys logged or in stack traces
- Unvalidated redirects and forwards in Keycloak authentication handoffs
- `SET LOCAL` context re-establishment after mid-operation commit/rollback

#### 3.5.4 `wims-voice.architect`

**Lens:** Patterns, coupling, boundaries, maintainability.

- Duplication of existing adapters, services, or utilities
- Layering violations (route doing domain logic, service doing HTTP, Celery task doing ad hoc orchestration)
- Over-engineering: speculative abstraction, unnecessary indirection, dead flexibility
- Boundary violations (frontend coupling to DB, service doing raw DB work directly instead of via repository/model boundary)
- Tech debt introduction without compensating value
- Existing legacy exceptions being copied as patterns instead of preserved as known tech debt

#### 3.5.5 `wims-voice.product`

**Lens:** Spec fidelity, requirement coverage, user experience.

- Uncovered acceptance criteria from spec/plan/issue/PRD
- Scope creep beyond approved requirements
- Missing error/loading/empty states in user-facing features
- UX gaps: confusing flow, missing confirmation, unclear feedback on actions
- Terminology drift from established domain language
- Missing accessibility or localization considerations
- Gaps between FRS requirements and proposed implementation

## 4. Chain Definitions

### 4.1 `wims-workflow.spec-review`

A chain that runs all 5 voice agents in parallel against a provided spec/plan, then synthesizes their findings.

- **Trigger:** After drafting a spec or plan, before implementation.
- **Parallel step:** All 5 `wims-voice.*` agents run fresh-context with the spec content.
- **Synthesis:** Groups findings by severity (BLOCKER, WARNING, INFO), deduplicates across voices, produces a prioritized revision list.
- **Output:** Structured revision list: what to fix (blockers), what to consider (warnings), what to note (info).

### 4.2 `wims-workflow.pr-ready`

A chain that runs after implementation, before opening a PR.

- **Step 1:** Relevant domain specialist reviews the diff for correctness and pattern compliance.
- **Step 2:** Wiki synchronizer inspects whether behavioral/API/schema/security changes require wiki updates; applies them if needed.
- **Step 3:** Validation ladder: runs the appropriate checks from the root AGENTS.md validation table.

## 5. Settings Changes

Merge into existing `.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "npm:@dietrichgebert/ponytail@4.8.4",
      "extensions": []
    }
  ],
  "subagents": {
    "agentOverrides": {
      "worker": {
        "model": "opencode-go/deepseek-v4-flash",
        "thinking": "high"
      },
      "reviewer": {
        "model": "openai-codex/gpt-5.6-luna",
        "thinking": "max"
      },
      "oracle": {
        "model": "openai-codex/gpt-5.6-terra",
        "thinking": "high"
      },
      "planner": {
        "model": "openai-codex/gpt-5.6-terra",
        "thinking": "max"
      },
      "scout": {
        "model": "opencode-go/deepseek-v4-flash",
        "thinking": "max"
      },
      "context-builder": {
        "model": "opencode-go/deepseek-v4-flash",
        "thinking": "max"
      },
      "researcher": {
        "model": "openai-codex/gpt-5.6-terra",
        "thinking": "high"
      }
    }
  }
}
```

## 6. Files to Create

| # | File | Type |
|---|------|------|
| 1 | `docs/superpowers/specs/2026-07-11-subagent-ecosystem-design.md` | Spec doc (this file) |
| 2 | `.pi/settings.json` | Settings (merge overrides) |
| 3 | `.pi/agents/wims-backend.specialist.md` | Domain specialist agent |
| 4 | `.pi/agents/wims-frontend.specialist.md` | Domain specialist agent |
| 5 | `.pi/agents/wims-infra.specialist.md` | Domain specialist agent |
| 6 | `.pi/agents/wims-wiki.synchronizer.md` | Domain specialist agent |
| 7 | `.pi/agents/wims-voice.devops.md` | Voice agent |
| 8 | `.pi/agents/wims-voice.qa.md` | Voice agent |
| 9 | `.pi/agents/wims-voice.security.md` | Voice agent |
| 10 | `.pi/agents/wims-voice.architect.md` | Voice agent |
| 11 | `.pi/agents/wims-voice.product.md` | Voice agent |
| 12 | `.pi/chains/wims-workflow.spec-review.chain.json` | Workflow chain |
| 13 | `.pi/chains/wims-workflow.pr-ready.chain.json` | Workflow chain |

## 7. Agent File Template

Every agent file follows this frontmatter structure:

```markdown
---
name: <agent-name>
package: wims
description: <one-line role>
tools: read, grep, find, ls, bash, edit, write   # or read, grep, find, ls for voice
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
defaultContext: fresh
---

<system prompt>
```

## 8. Validation

- `subagent({ action: "list" })` shows all 9 project agents + 7 builtins with correct models
- Each agent file has valid frontmatter (name, package, description, tools, systemPromptMode)
- Voice agents have no `bash`, `edit`, or `write` in their tools
- Settings merge preserves existing `packages` entry
- Chain JSON files have valid step structures
- No orphaned files or dead references
