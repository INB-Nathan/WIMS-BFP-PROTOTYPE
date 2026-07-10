# Project Pi Resource Instructions

## Scope and Loading

Applies to tracked source and configuration under `.pi/`. It supplements the root
`AGENTS.md`; root security and architecture rules remain mandatory.

Pi discovers `AGENTS.md`/`CLAUDE.md` by walking from the session's startup working
directory toward its parents. A session started at the repository root does not
automatically discover this child file, so read it manually before changing
`.pi/`. After changing resources, use `/reload` when the active Pi session and
trust state can load them.

Context files load independently of project trust. Project settings, extensions,
prompts, skills, and package resources load only after the project is trusted.
Do not use this file to tell an untrusted session to execute project resources.

## Resource Ownership

| Path | Purpose |
|---|---|
| `settings.json` | Team-shared Pi package/resource configuration only |
| `extensions/` | Executable TypeScript tools; highest review and security burden |
| `prompts/` | Explicit, repeatable workflow templates |
| `skills/` | Multi-step reusable procedures, references, scripts, and evals |
| `README.md` | Human inventory, setup, trust, and local/generated boundaries |
| `npm/`, `git/`, `sessions/` | Local/generated state; never hand-edit or commit |

Use the smallest suitable mechanism:

- Always-on repository policy belongs in an `AGENTS.md`.
- A repeatable user-invoked workflow belongs in `prompts/`.
- A procedure needing trigger metadata, references, scripts, or evals belongs in
  `skills/`.
- Code that registers tools, commands, UI, or event handlers belongs in
  `extensions/`.
- Do not add `.pi/SYSTEM.md` unless the user explicitly approves replacing Pi's
  default system prompt.

## Security Rules

Pi extensions and third-party package resources run with the local user's
permissions. Project trust is an input-loading guard, not a sandbox.

- Never embed tokens, passwords, SSH keys, private key material, production
  `.env` values, or credential-bearing command output.
- Shared hostnames, service names, or non-secret operational endpoints may be
  tracked only when intentional and documented in `.pi/README.md`; authentication
  must remain user-local.
- Production tools must make their target and effect explicit. Destructive
  operations require opt-in parameters, safe defaults, bounded timeouts, and
  clear errors; never invoke them merely to validate an extension.
- The tracked `vps-ssh.ts` predates tool-level confirmation/redaction hardening:
  it exposes arbitrary remote commands and mutating Compose actions and may return
  raw output. Until separately hardened, require explicit user approval for every
  arbitrary or mutating invocation, inspect the exact target/command first, and do
  not treat the tool's presence as permission to execute it.
- Prefer argument arrays over shell interpolation. If a remote shell command is
  unavoidable, constrain/quote inputs and preserve the user's cancellation or
  timeout signal where the Pi API supports it.
- Do not log or return secrets. Redact sensitive subprocess stderr/stdout before
  exposing it in tool details.
- Review the source and pin the version of every third-party Pi package. An empty
  `extensions` filter intentionally disables package extensions while allowing
  selected package skills.

## Authoring Rules

### Extensions

- Before changing Pi APIs, locate the installed
  `@earendil-works/pi-coding-agent` package with `npm root -g`, then read its
  `README.md`, the relevant `docs/*.md`, and linked `examples/` completely.
- Keep tool names stable unless every prompt/caller is migrated.
- Use TypeBox schemas that match runtime behavior; validate bounded numeric and
  enum-like inputs rather than accepting arbitrary values.
- Handle missing CLIs, authentication failures, non-zero exits, timeouts, and
  malformed JSON without crashing Pi.
- Do not add an extension when a prompt, skill, or existing CLI is sufficient.

### Prompts

- Prompt files register as `/<filename>`; skills register separately as
  `/skill:<name>`. Do not document a skill as a bare slash command.
- State scope, prerequisites, stop conditions, validation, and expected report.
- Read the relevant scoped `AGENTS.md`; do not copy volatile inventories, line
  numbers, test counts, or CI implementation details into multiple prompts.
- Use current repository paths and the `master` base branch.
- Never claim a convenience target such as `make ci-local` is the full GitHub CI
  gate unless its implementation actually matches `.github/workflows/ci.yml`.

### Skills and Evals

- Keep frontmatter name/description and trigger behavior precise.
- Put supporting material below the skill directory and resolve relative paths
  from the skill directory.
- Update the skill and its eval cases together when routing, commands, forbidden
  scope, or expected output changes.
- Skills must not hide destructive actions or silently broaden an implementation
  request.

### Settings and Packages

- Keep team-shared settings only; model, theme, session, and personal host choices
  belong in `~/.pi/agent/settings.json`.
- Pin package versions. Review the package diff before changing a pin and keep
  package resource filters explicit.
- Keep `.pi/README.md`, `settings.json`, and the lock/install state consistent;
  never edit files inside `.pi/npm/` directly.

## Ponytail Policy

The Ponytail package is skills-only in this repository.

- Use `lite` for low-risk bounded implementation or simplification suggestions.
- `full` requires explicit user consent; `ultra` is prohibited.
- Ponytail must not determine changes involving auth/RBAC/Keycloak, RLS, PII or
  encryption, append-only audit records, PostGIS, offline/PWA sync, Celery
  orchestration, SQL/Alembic migrations, OpenBao, Suricata/XAI, Nginx, or
  incident-promotion/official-record workflows.
- WIMS architecture, security, and scoped `AGENTS.md` rules always win.

## Validation

Use checks relevant to the changed resource:

```bash
python -m json.tool .pi/settings.json >/dev/null
python -m json.tool .pi/skills/wims-route/evals/evals.json >/dev/null
git diff --check -- .pi
```

Also:

- Reload Pi and inspect resource diagnostics after settings/resource changes.
- Smoke-test only the changed command/tool with non-production inputs.
- Run or review affected skill evals when skill behavior changes.
- Confirm `git status --short` contains no `.pi/npm`, `.pi/git`, session, token,
  or credential artifact.
- Update `.pi/README.md` when the tracked inventory, prerequisites, or trust model
  changes.
