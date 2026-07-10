# WIMS Pi Setup

This directory contains project-shared [Pi](https://pi.dev/) resources. Pi context
files can load before trust; project settings, packages, extensions, prompts, and
skills load only after the project is trusted.

## Tracked Resources

- `AGENTS.md` — scoped authoring, security, and validation rules for `.pi/`.
- `settings.json` — team-shared package/resource settings. Personal model, theme,
  session, and machine preferences belong in `~/.pi/agent/settings.json`.
- `extensions/github-tools.ts` — GitHub helper tools backed by authenticated `gh`.
- `extensions/vps-ssh.ts` — high-trust production capability: arbitrary remote
  shell plus Compose status/log/start/stop/down tools. The host metadata is shared
  operational configuration; SSH keys/authentication stay user-local. The current
  extension can return raw remote output and does not implement an independent
  confirmation gate, so every mutating or arbitrary-command invocation requires
  explicit user approval and must never be used as a routine smoke test.
- `prompts/*.md` — explicit reusable WIMS workflow prompts.
- `skills/*/SKILL.md` and adjacent references/evals — larger reusable procedures.

## Local or Generated State

Never commit or hand-edit:

- `.pi/npm/` and `.pi/git/` — project package install caches;
- `.pi/sessions/` — local session history and subagent artifacts;
- credentials, tokens, SSH material, production `.env` files, or secret-bearing
  tool output.

## Conventions

- Read `.pi/AGENTS.md` before changing these resources.
- Use root/scoped `AGENTS.md` files for always-on repository rules.
- Use `prompts/` for repeatable workflows invoked explicitly.
- Use `skills/` when a workflow needs trigger metadata, references, scripts, or
  evals.
- Use an extension only when code must register a tool, command, event handler, or
  UI; extensions run with the local user's permissions.
- Avoid `.pi/SYSTEM.md`; prefer `AGENTS.md`/`CLAUDE.md` unless replacing Pi's
  default system prompt is explicitly approved.
- Pin and review third-party packages before updating. The Ponytail package is
  configured skills-only; its extensions are disabled in `settings.json`.
- Run `/reload` after resource edits when the current trust/cwd can load them.
