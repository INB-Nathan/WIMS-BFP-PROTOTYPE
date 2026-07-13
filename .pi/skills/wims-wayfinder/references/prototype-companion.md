# Wayfinder Prototype Companion

Use this only for a `wayfinder:prototype` decision ticket when a visual or interactive artifact will help the human decide. It raises discussion fidelity; it is not production implementation.

## Optional dependency

The companion reuses the user-local brainstorming server:

```text
~/.pi/agent/skills/brainstorming/scripts/start-server.sh
```

If unavailable, continue with text, Mermaid, or static local HTML and state that browser interaction was unavailable. Do not copy the server into the WIMS repository.

## Safety defaults

- Use synthetic WIMS data only. Never display PII, credentials, access tokens, production payloads, network captures, or sensitive logs.
- Bind to loopback. Do not use `--host 0.0.0.0` without explicit user approval and a stated network exposure reason.
- Disable optional telemetry/remote branding traffic with `SUPERPOWERS_DISABLE_TELEMETRY=1`.
- Store sessions under ignored `.superpowers/brainstorm/`; never commit session keys, events, server metadata, or generated prototypes.
- Treat the complete keyed URL as sensitive session material. Share it only with the user in the active session and never put it in GitHub comments or logs.
- Prototype source cannot be merged, copied into production, or treated as an accepted contract without a separate implementation issue and review.

## Start

An explicit request to work a prototype ticket authorizes opening the approved local companion. Start from the repository root:

```bash
SUPERPOWERS_DISABLE_TELEMETRY=1 \
  ~/.pi/agent/skills/brainstorming/scripts/start-server.sh \
  --project-dir "$PWD" \
  --open
```

Capture the returned `url`, `screen_dir`, and `state_dir`. Confirm `state/server-info` exists and `state/server-stopped` does not before each screen push.

## Prototype loop

1. State the one decision the prototype must resolve.
2. Create the cheapest artifact that exposes that decision: usually 2–4 mockups, behavior examples, diagrams, or side-by-side options.
3. Write a fresh semantic `.html` filename into `screen_dir`; never overwrite an earlier screen.
4. Tell the user what is visible and provide the complete keyed URL as a fallback.
5. Wait for terminal feedback. On the next turn, read `state_dir/events` if present and combine it with the user's message; terminal feedback is authoritative.
6. Iterate only on the current decision. Push a waiting screen when returning to a text-only question.
7. Stop when the human can answer the ticket's question; do not polish beyond that point.

Use the existing brainstorming visual-companion reference for fragment classes and event format. Do not invoke the brainstorming skill's broader design-doc, commit, or writing-plans workflow.

## Resolve and clean up

The ticket resolution records:

- what the prototype showed;
- the user's selected direction and rejected alternatives;
- constraints revealed by feedback;
- whether any uncertainty remains;
- that the local artifact is disposable.

Do not link the local keyed URL from GitHub. If a durable asset is needed, preview a separate persistence/commit action and obtain confirmation.

Stop the server with the matching session directory:

```bash
~/.pi/agent/skills/brainstorming/scripts/stop-server.sh <session-dir>
```

Persistent ignored files may remain for the user's local review; remove them only when explicitly requested.
