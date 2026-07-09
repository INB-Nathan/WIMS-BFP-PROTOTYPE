# WIMS Pi Setup

This directory contains project-shared [Pi](https://pi.dev/) resources. Pi loads these only after the project is trusted.

## Tracked here

- `settings.json` — project package/resource settings. Keep team-shared settings here; keep personal model/theme/session preferences in `~/.pi/agent/settings.json`.
- `extensions/github-tools.ts` — WIMS GitHub helper tools backed by the `gh` CLI.
- `prompts/*.md` — reusable WIMS workflow prompts exposed as slash commands.

## Local-only

- `.pi/npm/` — project package install cache; ignored.
- `.pi/sessions/` — local session history; ignored.
- Production/VPS SSH tools are intentionally user-local. On this machine the VPS extension lives at `~/.pi/agent/extensions/wims-vps-ssh.ts`; do not commit host-specific SSH tools or credentials.

## Conventions

- Use `AGENTS.md` and scoped `AGENTS.md` files for always-on repo rules.
- Use `.pi/prompts/` for repeatable workflows that should be invoked explicitly.
- Use `.pi/skills/` or package-managed skills only for larger reusable procedures with reference files or helper scripts.
- Avoid `.pi/SYSTEM.md`; prefer `AGENTS.md`/`CLAUDE.md` unless the default Pi system prompt must be replaced.
- Review third-party packages and extensions before adding them. Extensions run with your user permissions.
