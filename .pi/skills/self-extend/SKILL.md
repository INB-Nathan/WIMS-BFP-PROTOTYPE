---
name: self-extend
description: "Analyze the CURRENT pi session and propose/emit a reusable pi extension or skill that would have done the work deterministically instead of hand-driving the agent. Use ONLY when the user explicitly invokes it (/skill:self-extend). Never auto-trigger. Trigger phrases: \"turn this into a skill\", \"make an extension from this session\", \"self-evolve\", \"this should be code not me\", \"capitalize on the session\", \"extract a pi skill from this conversation\". Do NOT use for normal coding, code review, debugging, or brainstorming — those are separate skills."
disable-model-invocation: true
---

# Self-Extend

Convert a finished (or in-progress) agent session into a reusable pi capability —
an **extension** (TypeScript, deterministic, runs inside the harness) or a **skill**
(instructions the agent loads on demand). The guiding idea: manual agent loops are
brittle and cost tokens every run; once a pattern is clear, **code is free and always
accurate** — capture it once, run it forever.

This skill is **opt-in only**. It never loads automatically. The user must invoke it
via `/skill:self-extend`. That is deliberate: the harness must not rewrite itself
without explicit say-so.

## When this skill applies

- The user notices a repeated, mechanical sequence in the current session that could
  be a tool, command, or skill.
- The user says "this should be code", "make a skill out of this", "self-evolve", etc.
- The user wants to package a workflow they just hand-drove so future sessions skip
  the manual loop.

## When it does NOT apply

- General coding, debugging, reviewing, or planning — use the dedicated skills for those.
- Any change that touches auth/RBAC/RLS, PII/crypto, audit immutability, PostGIS,
  offline sync, Celery, migrations, OpenBao, Suricata, or incident-promotion logic.
  Those are out of scope and must follow the repo's normal guarded process.

---

## Process

### 0. Confirm scope and target

Ask (or read from args) exactly two things before building:

1. **What part of the session** should be captured — the whole session, a branch,
   or a specific repeated pattern the user names.
2. **What artifact** to emit: `extension` (deterministic TS, best for mechanical
   transforms / gates / repetitive tooling) or `skill` (instructions, best for
   methodology / judgment-heavy workflows). If unclear, recommend one:

   - Mechanical, repeatable, no judgment → **extension**.
   - Methodology, decision-making, context-dependent → **skill**.
   - A skill can *wrap* a deterministic script — that is the common best shape.

Never write the artifact until both are settled.

### 1. Read the session

Find the session file. The user can pass a path; otherwise:

```bash
ls -t ~/.pi/agent/sessions/--$(echo "$PWD" | sed 's#/#-#g')--/ | head -1
```

Each line is a JSON object with a `type` field. Entries form a tree via `id`/`parentId`.
Relevant message content blocks: `toolCall` (`{ type:"toolCall", id, name, arguments }`),
`text`, `thinking`, and `toolResult`. Parse the JSONL and rebuild the active branch
(`id`/`parentId` walk from the leaf) so you see the actual sequence of tool calls,
not just the file order.

To find candidates, look for:
- The **same tool call repeated with varying args** (e.g. many `bash` calls running
  the same family of commands, repeated `edit`/`write` to a known template).
- A **multi-step loop** the agent ran by hand that a single tool or command would do
  in one shot.
- **Boilerplate the agent regenerated** each time (same parsing, same scaffolding).
- High token cost in `usage` blocks concentrated in one mechanical pattern.

Count explicitly: report "N repeated `bash` calls of family X", not "some".

### 2. Propose the capability (human-reviewed)

Before writing code, present a short proposal and **wait for the user to approve**:

- The identified pattern (with the count/evidence from step 1).
- The artifact type (extension vs skill) and why.
- The proposed interface: for an extension, the tool/command name and parameters;
  for a skill, the trigger description and output shape.
- The file path it will be written to.

This is the "say-so" gate. Do not skip it. The user can reject, narrow, or redirect.

### 3. Emit the artifact

#### Extension shape

Place a single-file extension at one of:

- `~/.pi/agent/extensions/<name>.ts` — global (all projects).
- `.pi/extensions/<name>.ts` — project-local (loads only after project trust).

Minimal correct skeleton:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "<name>",
    label: "<Label>",
    description: "What it does, from the session pattern",
    parameters: Type.Object({
      // mirror the args you saw repeated in the session
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // deterministic logic that replaces the manual loop
      return { content: [{ type: "text", text: "..." }], details: {} };
    },
  });

  // OR a command:
  pi.registerCommand("<name>", {
    description: "What it does",
    handler: async (args, ctx) => { /* ... */ },
  });
}
```

Notes the agent must follow:
- Extensions run with **full system permissions** — keep them narrow and obvious.
- Use `typebox` `Type` for tool params; `StringEnum` from `@earendil-works/pi-ai`
  for enums.
- `ctx.ui.confirm/select/input/notify` for any interaction; guard with `ctx.hasUI`.
- For gate logic (block a tool call), use `pi.on("tool_call", ...)` returning
  `{ block: true, reason }`.
- After writing, the user reloads with `/reload` (project-local needs trust first).
  Do not auto-reload or edit running harness state.

#### Skill shape

Place a skill at one of:

- `~/.pi/agent/skills/<name>/SKILL.md` — global.
- `.pi/skills/<name>/SKILL.md` — project-local.

`SKILL.md` needs frontmatter:

```yaml
---
name: <name>
description: What it does and when to use it. Include concrete trigger phrases
  and a negative-trigger sentence so it does not misfire.
---
```

If the skill wraps deterministic logic, put that logic in `scripts/` next to
`SKILL.md` and call it with relative paths. Keep `SKILL.md` under ~500 lines;
push detail to `references/`.

### 4. Verify before claiming done

- For an extension: sanity-check the TypeScript by reading it back; confirm the
  `ExtensionAPI` import and `export default function (pi: ExtensionAPI)` signature.
  Do not `require`/execute it from the session.
- For a skill: confirm frontmatter parses (name lowercase/hyphen, description present),
  and that negative triggers are stated.
- Report the exact file path written and the reload/install step the user must run.
- Do **not** mark the capability "tested in production" unless the user actually
  reloaded and ran it. State clearly what is unverified.

---

## Guardrails

- **Opt-in only.** This skill loads solely via `/skill:self-extend`. It must never
  silently rewrite the harness, auto-invoke itself, or queue a reload.
- **No security-boundary changes.** Auth, RBAC, RLS, PII, crypto, audit, migrations,
  infra — out of scope. Flag those to the user; do not package them here.
- **Smallest artifact.** Capture only the identified pattern. No speculative
  generality, no extra flags "for later".
- **Determinism over prompts.** Prefer an extension (real code) over a skill that
  just tells the agent to do the same loop again. The whole point is to stop paying
  tokens for mechanical work.
- **User owns the file.** Written to the user's chosen path; they review and reload.
