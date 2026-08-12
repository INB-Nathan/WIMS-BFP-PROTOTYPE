# QA Scenarios

Versioned, reproducible browser-QA scenarios for the local WIMS stack. Each
scenario is a contract: the `browser-qa` subagent follows the steps and reports
observed behavior, evidence (console/network/screenshot/trace), and any
reproducible defects.

## Prerequisites (all scenarios)

1. **Local stack running.** Start with `scripts/wims-local.sh start` from the
   repo root. The gateway is reachable at `http://localhost` (HTTP-only via
   `nginx.local-demo.conf`). The script already defaults to the k3d-safe subnet
   `172.28.0.0/24`; set `WIMS_LOCAL_SUBNET` only when you need a different
   range (see `scripts/wims-local.sh` usage).
2. **Synthetic identities seeded** (authenticated scenarios only). See
   [synthetic-identities.md](./synthetic-identities.md). The `keycloak`
   Compose service imports `src/keycloak/import/bfp-realm.json` on first
   start (`start-dev --import-realm`); the one-shot `keycloak-bootstrap`
   service only patches the master-realm admin console and does not import
   the `bfp` realm.
3. **Playwright Chromium installed** once system-wide:
   `cd .pi/extensions/wims-browser && npx playwright install chromium`.
4. **Invoke** `browser-qa` via pi-subagents:
   `runs.run("main", { agent: "browser-qa", task: "<scenario file path + body>" })`.

## Scenario files

| File | Scope | Auth | Capabilities exercised |
|---|---|---|---|
| [smoke-public.md](./smoke-public.md) | Public-facing pages render and navigate | none | navigate, snapshot, click, network, console, screenshot |
| [civilian-report.md](./civilian-report.md) | Guest report-wizard flow + coordinate validation | none | navigate, snapshot, type, geolocation, permissions, click |
| [dispatcher-triage.md](./dispatcher-triage.md) | Authenticated encoder triage workflow | `encoder_ncr` or `encoder_car` | navigate, type, login, offline/online, network |
| [offline-recovery.md](./offline-recovery.md) | PWA offline-store recovery after tab close/reopen | `encoder_ncr` | offline, online, tabs, reload, network |
| [accessibility-structure.md](./accessibility-structure.md) | Page structure, landmarks, focus, no console errors | none | snapshot, console, network |

## Rules for the `browser-qa` agent

- **Never invent credentials.** Use only identities from
  `synthetic-identities.md`, and only if the operator confirms they are seeded.
- **Never perform destructive actions** (delete, bulk edit, force-cascade) even
  if the UI allows it. If a destructive control is visible, screenshot it and
  report; do not click.
- **Start every scenario with `browser_start`** (fresh context) and end with
  `browser_close` (deterministic cleanup).
- **Collect evidence**: `browser_console` (warning+), `browser_network`
  (HTTP errors + `BLOCKED`), `browser_screenshot` at key steps, `browser_trace`
  around any reproduction.
- **Distinguish** app defects from expected auth responses (`401` when
  unauthenticated) and from environmental blocks (`BLOCKED(loopback-guard)`
  for external map tiles/fonts by the loopback-only invariant).
- **Report** exact steps, observed behavior, final URLs, evidence paths, and
  reproducible defects vs. expected/environmental findings.

## Operating loop (parent orchestrates)

```
1. Operator starts + health-checks the local stack
2. Fresh browser-qa runs a versioned scenario
3. Parent triages findings (accept/reject)
4. Worker fixes only accepted defects
5. Fresh browser-qa reruns affected scenarios
6. Stop after green or 3 iterations
7. Close Chromium and stop the stack when done
```

Keep `browser-qa` read-only and independent. Do not let the implementation
worker be its own sole reviewer.