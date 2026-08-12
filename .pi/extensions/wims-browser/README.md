# wims-browser — WIMS Browser QA extension (project-local)

Loopback-only headless Chromium tools for QA of the local WIMS stack inside
Pi. Loaded **only** in the `browser-qa` subagent (child-only via
`subagentOnlyExtensions`); it is intentionally not auto-discovered, so its
tools never appear in the main session.

## Attribution and license

Apache-2.0. Derived from
[`pi-playwright-extension`](https://github.com/SamuelLHuber/pi-playwright-extension)
by Samuel L. Huber (upstream commit
`fef949f810b25bd69d23a910ba30a8364c08e532`). See [`LICENSE`](./LICENSE) and
[`NOTICE`](./NOTICE) in this directory. The `NOTICE` file lists the
modifications made for WIMS-BFP (loopback-only enforcement, removed surfaces,
added trace/select/start tools).

## Security boundary

Enforced in code (`src/loopback.ts`), not by prompt rules:

- Direct navigation (`browser_navigate`) accepts **only** http(s) loopback
  URLs: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`. Credentials in URLs
  are rejected.
- Every request in the context (navigations, popups, redirect targets,
  subresources, fetch/XHR) and every WebSocket is checked by a request guard;
  non-loopback traffic is aborted/closed and recorded as `BLOCKED(...)`
  evidence visible in `browser_network`. Redirect targets are validated via a
  network passthrough before the browser follows them. The guard fails
  **closed**: if the passthrough fetch itself fails (timeout, TLS, protocol,
  or network error), the request is aborted and recorded as
  `BLOCKED(loopback-guard-fetch-failed)` evidence — an unguarded
  `route.continue()` is never used, so no redirect chain can escape the
  loopback invariant. No error details are surfaced (they may contain
  sensitive data); the recorded reason is a fixed string.
- Only narrowly necessary non-network schemes are allowed as requests:
  `about:blank`, `about:srcdoc`, `blob:`, `data:`.
- Service Workers are blocked at the context level
  (`serviceWorkers: "block"` on the fresh `BrowserContext`). Requests that a
  service worker handles — or answers from its own fetch handler — never
  pass through `context.route`, so a registered worker could fetch
  non-loopback URLs without guard evidence. Registration is denied before
  any worker script is fetched or executed.
- Omitted surfaces: arbitrary page JavaScript evaluation, arbitrary external
  browsing, storage-state import, live-browser CDP attachment, video,
  downloads, uploads, route mocking, and tab-management tools.

## Tool surface

`browser_start`, `browser_navigate`, `browser_snapshot`, `browser_click`,
`browser_type`, `browser_select`, `browser_press_key`, `browser_wait_for`,
`browser_screenshot`, `browser_console`, `browser_network`,
`browser_trace_start`, `browser_trace_stop`, `browser_close`.

- `browser_start` always closes any prior run and creates a fresh headless
  Chromium `BrowserContext`.
- `browser_close`, `session_shutdown`, and tree navigation deterministically
  close the browser/context and finalize any active trace.
- Screenshots and trace archives go to `.pi/browser/` (configurable via the
  `browser-output-dir` flag) with bounded retention
  (`browser-retention-*` flags; defaults: 50 artifacts / 512 MB / 7 days).

## Install

From this directory:

```bash
npm install
```

The runtime dependency is `playwright` (exact-pinned, see `package.json`);
install the browser binary for your user once (system-wide, outside the repo):

```bash
npx playwright install chromium
```

`node_modules/` and the Playwright browser cache (`~/.cache/ms-playwright`)
are never committed. Browser binaries are not tracked by this repository.

## Usage

The `browser-qa` agent (`.pi/agents/browser-qa.md`) loads this extension
child-only and exposes the tools above alongside read-only builtins
(`read`, `grep`, `find`, `ls`). It runs against the local stack
(`http://localhost:3000` or `http://127.0.0.1:<port>`); start the local
stack first (see repository root docs). Example flow:

1. `browser_start`
2. `browser_navigate` → `http://localhost:3000`
3. `browser_snapshot` → note the `[ref=e1]`-style refs
4. `browser_type` / `browser_select` / `browser_click` using refs
5. `browser_console` / `browser_network` for errors and blocked requests
6. `browser_trace_start` / `browser_trace_stop` around a bug reproduction
7. `browser_close`

Artifacts (screenshots, traces, overflow logs) land in `.pi/browser/`
(ignored by git). Cleanup is automatic (retention pruning) or manual:
delete the directory.

## Development

```bash
npm run check   # tsc --noEmit
npm test        # tsx --test (unit + real headless Chromium integration)
```

The integration tests spin up a local HTTP server on `127.0.0.1` and a
headless Chromium, and assert that external URL/subrequest/popup/redirect/
WebSocket attempts are blocked while loopback flows work. Requires
`npx playwright install chromium` once.
