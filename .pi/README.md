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
- `extensions/wims-browser/` — project-local loopback-only headless Chromium QA
  extension (Apache-2.0, adapted from
  `github.com/SamuelLHuber/pi-playwright-extension`; see `NOTICE`). Loaded
  child-only by the `browser-qa` agent via `subagentOnlyExtensions`; never
  auto-discovered, so its tools are not exposed to the main session.
- `agents/browser-qa.md` — read-only QA agent (`read`/`grep`/`find`/`ls` plus the
  `browser_*` tools above; no bash/edit/write) that drives the local stack and
  returns console/network/screenshot/trace evidence.
- `prompts/*.md` — explicit reusable WIMS workflow prompts.
- `skills/*/SKILL.md` and adjacent references/evals — larger reusable procedures.
  `wims-wayfinder` is the manual-only WIMS/GitHub profile for large, uncertain,
  multi-session planning. It requires the user-global `wayfinder` skill; its
  optional visual prototype flow reuses the user-global `brainstorming` server.

## Local or Generated State

Never commit or hand-edit:

- `.pi/npm/` and `.pi/git/` — project package install caches;
- `.pi/sessions/` — local session history and subagent artifacts;
- `.pi/extensions/wims-browser/node_modules/` — extension dependencies
  (install with `cd .pi/extensions/wims-browser && npm install`);
- `.pi/browser/` — browser QA artifacts (screenshots, traces, logs) written by
  the `wims-browser` extension; retention-pruned automatically (defaults:
  50 artifacts / 512 MB / 7 days), or delete the directory manually;
- `~/.cache/ms-playwright/` — Playwright browser binaries (install once with
  `npx playwright install chromium` from `.pi/extensions/wims-browser`);
- `.superpowers/brainstorm/` — ignored user-local Wayfinder prototype screens,
  interaction events, server metadata, and keyed session state;
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

## Browser QA (wims-browser)

Purpose: drive the local WIMS stack in a fresh headless Chromium and collect
QA evidence (ARIA snapshots with stable refs, console errors, network
HTTP/failure/blocked evidence, screenshots, Playwright traces).

Trust/security boundary: the extension enforces loopback-only access in code
(`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`; credentials rejected; no
arbitrary JS evaluation, external browsing, storage-state import, CDP
attachment, video, downloads, uploads, or route mocking). It is loaded only
in the `browser-qa` child agent; the main session never sees its tools.

Install (first time, per machine):

```bash
cd .pi/extensions/wims-browser && npm install
npx playwright install chromium   # user-level browser binary, not tracked
```

Prerequisite: the local stack must be running (`http://localhost:<port>`);
`browser-qa` cannot start it (no bash). Invoke browser QA with the
`browser-qa` agent via pi-subagents, e.g. a workflow with
`runs.run("main", { agent: "browser-qa", task: "<scenario>" })` or by
selecting the agent in the subagent launcher. Artifacts land in
`.pi/browser/` (git-ignored, auto-pruned; delete manually for full cleanup).
See `.pi/extensions/wims-browser/README.md` for the tool surface.
