/**
 * WIMS Browser QA extension (project-local).
 *
 * Loopback-only headless Chromium tools for QA of the local WIMS stack.
 * Derived from `pi-playwright-extension` (Apache-2.0, Samuel L. Huber,
 * upstream commit fef949f810b25bd69d23a910ba30a8364c08e532); see NOTICE in
 * this package for the modification list and attribution.
 *
 * Security invariants (enforced in code, see src/loopback.ts):
 * - The browser may only reach loopback hosts (localhost, *.localhost,
 *   127.0.0.0/8, ::1) over http(s)/ws(s) plus narrowly necessary
 *   about:/blob:/data: schemes. External navigation, redirects, subresources,
 *   fetch/XHR, and WebSockets are aborted and reported as evidence.
 * - URLs with embedded credentials are rejected.
 * - No arbitrary page JavaScript evaluation, storage-state import, CDP
 *   attachment, video, downloads, uploads, or route mocking.
 *
 * The extension is loaded child-only through the `browser-qa` agent's
 * `subagentOnlyExtensions`; it is intentionally NOT auto-discovered (no
 * `pi.extensions` manifest entry and no root `index.ts`), so its tools never
 * appear in the main session.
 */
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BrowserSession } from "./browser-session.js";
import type { BrowserLaunchConfig, BrowserStatus } from "./types.js";
import { parsePositiveBytes, parsePositiveInt, parseViewport, resolveOutputDir } from "./utils.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const DEFAULT_ACTION_TIMEOUT_MS = 5_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_RETENTION_MAX_ARTIFACTS = 50;
const DEFAULT_RETENTION_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_RETENTION_MAX_DAYS = 7;

function formatBrowserStatus(status: BrowserStatus): string {
  if (!status.started) {
    return "Browser: idle";
  }
  const bits = [
    `chromium headless`,
    `${Math.max(status.tabCount, 0)} tab${status.tabCount === 1 ? "" : "s"}`,
  ];
  if (status.tracingActive) bits.push("tracing");
  if (status.currentUrl) bits.push(status.currentUrl);
  return `Browser: ${bits.join(" | ")}`;
}

export default function wimsBrowserExtension(pi: ExtensionAPI): void {
  let browserSession: BrowserSession | undefined;
  let lastCwd = process.cwd();

  function getConfig(ctx: ExtensionContext): BrowserLaunchConfig {
    lastCwd = ctx.cwd;
    return {
      cwd: ctx.cwd,
      outputDir: resolveOutputDir(ctx.cwd, pi.getFlag("browser-output-dir") as string | undefined),
      viewport: parseViewport(pi.getFlag("browser-viewport") as string | undefined, DEFAULT_VIEWPORT),
      retention: {
        maxArtifacts: parsePositiveInt(
          pi.getFlag("browser-retention-max-artifacts") as string | undefined,
          DEFAULT_RETENTION_MAX_ARTIFACTS,
        ),
        maxBytes: parsePositiveBytes(
          pi.getFlag("browser-retention-max-bytes") as string | undefined,
          DEFAULT_RETENTION_MAX_BYTES,
        ),
        maxAgeDays: parsePositiveInt(
          pi.getFlag("browser-retention-max-days") as string | undefined,
          DEFAULT_RETENTION_MAX_DAYS,
        ),
      },
      actionTimeoutMs: parsePositiveInt(
        pi.getFlag("browser-timeout-action") as string | undefined,
        DEFAULT_ACTION_TIMEOUT_MS,
      ),
      navigationTimeoutMs: parsePositiveInt(
        pi.getFlag("browser-timeout-navigation") as string | undefined,
        DEFAULT_NAVIGATION_TIMEOUT_MS,
      ),
    };
  }

  async function getSession(ctx: ExtensionContext): Promise<BrowserSession> {
    if (!browserSession) {
      browserSession = new BrowserSession(getConfig(ctx));
      await browserSession.start();
      updateUi(ctx);
    }
    return browserSession;
  }

  /** Start a guaranteed-fresh run: close any prior run, then start a new one. */
  async function getFreshSession(ctx: ExtensionContext): Promise<BrowserSession> {
    if (browserSession) {
      await browserSession.stop();
      browserSession = undefined;
    }
    browserSession = new BrowserSession(getConfig(ctx));
    await browserSession.start();
    updateUi(ctx);
    return browserSession;
  }

  function updateUi(ctx: ExtensionContext): void {
    const status = browserSession?.getStatus() ?? {
      started: false,
      tabCount: 0,
      currentTabIndex: -1,
      outputDir: resolveOutputDir(lastCwd, pi.getFlag("browser-output-dir") as string | undefined),
      tracingActive: false,
    };
    ctx.ui.setStatus("browser", formatBrowserStatus(status));
  }

  async function closeSession(ctx: ExtensionContext, reason?: string): Promise<void> {
    if (!browserSession) {
      updateUi(ctx);
      return;
    }
    await browserSession.stop();
    browserSession = undefined;
    updateUi(ctx);
    if (reason) ctx.ui.notify(reason, "info");
  }

  pi.registerFlag("browser-output-dir", {
    description: "Directory for screenshots, traces, and other browser artifacts",
    type: "string",
    default: ".pi/browser",
  });
  pi.registerFlag("browser-viewport", {
    description: "Viewport size, e.g. 1440x960",
    type: "string",
    default: "1440x960",
  });
  pi.registerFlag("browser-retention-max-artifacts", {
    description: "Maximum number of browser artifacts to keep in the output directory",
    type: "string",
    default: String(DEFAULT_RETENTION_MAX_ARTIFACTS),
  });
  pi.registerFlag("browser-retention-max-bytes", {
    description: "Maximum total browser artifact size, e.g. 512MB",
    type: "string",
    default: String(DEFAULT_RETENTION_MAX_BYTES),
  });
  pi.registerFlag("browser-retention-max-days", {
    description: "Maximum artifact age in days before cleanup removes them",
    type: "string",
    default: String(DEFAULT_RETENTION_MAX_DAYS),
  });
  pi.registerFlag("browser-timeout-action", {
    description: "Action timeout in milliseconds",
    type: "string",
    default: String(DEFAULT_ACTION_TIMEOUT_MS),
  });
  pi.registerFlag("browser-timeout-navigation", {
    description: "Navigation timeout in milliseconds",
    type: "string",
    default: String(DEFAULT_NAVIGATION_TIMEOUT_MS),
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await closeSession(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await closeSession(ctx, "Browser closed after tree navigation.");
  });

  pi.registerTool({
    name: "browser_start",
    label: "Browser Start",
    description:
      "Start a fresh headless Chromium run for QA against the local WIMS stack. Any prior browser run is closed first. Loopback-only access is enforced in code.",
    promptSnippet: "Start a fresh headless browser run before navigating to the local app.",
    promptGuidelines: [
      "Call browser_start before the first navigation of a QA scenario.",
      "Each browser_start discards the previous run (tabs, console, network, refs, trace).",
      "Only localhost URLs are reachable; external URLs are blocked and reported by browser_network.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getFreshSession(ctx);
      const status = session.getStatus();
      return {
        content: [
          {
            type: "text",
            text: `Browser started (headless chromium). Artifacts go to ${status.outputDir}. Navigate with browser_navigate.`,
          },
        ],
        details: { started: true, outputDir: status.outputDir },
      };
    },
  });

  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description: "Open a loopback (localhost) URL in the headless browser and wait for the page to settle. External URLs are rejected.",
    promptSnippet: "Open a localhost page in the headless browser.",
    promptGuidelines: [
      "Only http(s) loopback URLs are accepted: localhost, *.localhost, 127.0.0.0/8, [::1].",
      "After browser_navigate, usually call browser_snapshot before clicking or typing.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The loopback URL to open." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.navigate(params.url);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_reload",
    label: "Browser Reload",
    description:
      "Reload the current page in the headless browser. Optionally bypass the HTTP cache (hard reload). The reload request goes through the same loopback-only request guard as any navigation.",
    promptSnippet: "Reload the current page, optionally bypassing the HTTP cache.",
    promptGuidelines: [
      "The reload goes through the loopback-only request guard; external URLs are still blocked and recorded as evidence.",
      "Use bypassCache=true for a hard reload when a stale cached resource may be masking a fix.",
    ],
    parameters: Type.Object({
      bypassCache: Type.Optional(Type.Boolean({ description: "Bypass the HTTP cache (hard reload)." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.reload(params.bypassCache ?? false);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_go_back",
    label: "Browser Go Back",
    description: "Navigate back one entry in the current page's browser history.",
    promptSnippet: "Go back in the browser history of the current tab.",
    promptGuidelines: ["History navigation goes through the same loopback-only request guard as direct navigation."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.goBack();
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_go_forward",
    label: "Browser Go Forward",
    description: "Navigate forward one entry in the current page's browser history.",
    promptSnippet: "Go forward in the browser history of the current tab.",
    promptGuidelines: ["History navigation goes through the same loopback-only request guard as direct navigation."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.goForward();
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_viewport",
    label: "Browser Viewport",
    description: "Resize the current page's viewport (width x height), e.g. for responsive or mobile QA.",
    promptSnippet: "Resize the viewport to test responsive/mobile layouts.",
    parameters: Type.Object({
      width: Type.Integer({ description: "Viewport width in CSS pixels.", minimum: 1 }),
      height: Type.Integer({ description: "Viewport height in CSS pixels.", minimum: 1 }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.setViewport(params.width, params.height);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_tab_select",
    label: "Browser Tab Select",
    description: "Switch focus to an open tab by index (0-based). Tabs opened by browser_click are tracked; use this to follow up on them.",
    promptSnippet: "Switch to another open browser tab.",
    promptGuidelines: [
      "Tab indices are 0-based; browser_click reports the index of any new tab it opens.",
      "Subsequent browser_* tools act on the selected tab.",
    ],
    parameters: Type.Object({
      index: Type.Integer({ description: "Tab index to select (0-based).", minimum: 0 }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.selectTab(params.index);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_tab_close",
    label: "Browser Tab Close",
    description:
      "Close a tab (the current tab by default, or a specific index) and switch to another open tab. The last remaining tab cannot be closed; use browser_close to end the run.",
    promptSnippet: "Close a browser tab and switch focus to another.",
    promptGuidelines: ["Closing the last tab is refused; end the run with browser_close instead."],
    parameters: Type.Object({
      index: Type.Optional(Type.Integer({ description: "Tab index to close (0-based); defaults to the current tab.", minimum: 0 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.closeTab(params.index);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_offline",
    label: "Browser Offline",
    description:
      "Simulate a network outage for the whole browser context (offline mode) to test offline/PWA behavior. The loopback-only request guard still applies: offline blocks the network, it does not disable the guard.",
    promptSnippet: "Switch the browser to offline mode for PWA/offline behavior QA.",
    promptGuidelines: [
      "Offline disables network requests (loopback included); navigations and reloads will fail until browser_online restores connectivity.",
      "External (non-loopback) requests remain blocked by the loopback guard regardless of online/offline state.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.setOffline(true);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_online",
    label: "Browser Online",
    description: "Restore network connectivity after browser_offline.",
    promptSnippet: "Restore the browser to online mode.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.setOffline(false);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_set_geolocation",
    label: "Browser Set Geolocation",
    description:
      "Set a deterministic geolocation for the browser context and grant the geolocation permission. Used for report-submission QA (coordinates are supplied by the task, not hard-coded).",
    promptSnippet: "Set a deterministic geolocation for geolocation-dependent QA scenarios.",
    promptGuidelines: [
      "Latitude must be in [-90, 90] and longitude in [-180, 180].",
      "The geolocation permission is granted automatically; use browser_set_permissions to test the permission-denied fallback.",
    ],
    parameters: Type.Object({
      latitude: Type.Number({ description: "Latitude in degrees (-90 to 90).", minimum: -90, maximum: 90 }),
      longitude: Type.Number({ description: "Longitude in degrees (-180 to 180).", minimum: -180, maximum: 180 }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.setGeolocation(params.latitude, params.longitude);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_clear_geolocation",
    label: "Browser Clear Geolocation",
    description: "Reset the browser context geolocation to the browser default (no emulated coordinates).",
    promptSnippet: "Reset the emulated geolocation.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.clearGeolocation();
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_set_permissions",
    label: "Browser Set Permissions",
    description:
      "Grant or deny a browser permission (geolocation, notifications) for the context. Deny clears all permission overrides so the browser returns to its default (denial) behavior; used for permission-denial fallback QA.",
    promptSnippet: "Grant or deny browser permissions for permission-fallback QA.",
    promptGuidelines: [
      "grant=true uses context.grantPermissions; grant=false clears overrides (Playwright has no per-permission revoke).",
      "Headless Chromium cannot show permission prompts, so a cleared override behaves as a denial.",
    ],
    parameters: Type.Object({
      permission: Type.Union([Type.Literal("geolocation"), Type.Literal("notifications")], {
        description: "Permission to configure.",
      }),
      grant: Type.Boolean({ description: "true to grant the permission, false to deny it." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.setPermission(params.permission, params.grant);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_snapshot",
    label: "Browser Snapshot",
    description:
      "Capture an ARIA-oriented snapshot of the current page plus stable refs for visible interactive elements.",
    promptSnippet: "Inspect the current page before interacting with it.",
    promptGuidelines: [
      "Prefer browser_snapshot over screenshots when deciding what to click or type.",
      "Use refs returned by browser_snapshot with browser_click, browser_type, and browser_select.",
    ],
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "Optional CSS selector to scope the snapshot." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.snapshot(params.selector);
      updateUi(ctx);
      return {
        content: [{ type: "text", text: result.text }],
        details: { refs: result.refs, aria: result.aria, fullPath: result.fullPath },
      };
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description:
      "Click an element on the current page. Prefer an exact ref from the latest browser_snapshot. Use selector only as a fallback.",
    promptSnippet: "Click buttons, links, and other interactive page elements using exact refs from browser_snapshot.",
    parameters: Type.Object({
      ref: Type.Optional(Type.String({ description: "Stable element ref from the latest browser_snapshot. Prefer this." })),
      selector: Type.Optional(Type.String({ description: "CSS selector only when no usable ref is available." })),
      doubleClick: Type.Optional(Type.Boolean({ description: "Double click instead of single click." })),
      button: Type.Optional(Type.String({ description: "Mouse button: left, right, or middle." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const button = params.button === "right" || params.button === "middle" ? params.button : "left";
      const clickParams: { ref?: string; selector?: string; doubleClick?: boolean; button?: "left" | "right" | "middle" } = {
        button,
      };
      if (params.ref) clickParams.ref = params.ref;
      if (params.selector) clickParams.selector = params.selector;
      if (params.doubleClick !== undefined) clickParams.doubleClick = params.doubleClick;
      const result = await session.click(clickParams);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description:
      "Type text into an element on the current page. Prefer an exact ref from the latest browser_snapshot. Use selector only as a fallback.",
    promptSnippet: "Type into inputs and editable controls using exact refs from browser_snapshot.",
    parameters: Type.Object({
      ref: Type.Optional(Type.String({ description: "Stable element ref from the latest browser_snapshot. Prefer this." })),
      selector: Type.Optional(Type.String({ description: "CSS selector only when no usable ref is available." })),
      text: Type.String({ description: "The text to enter." }),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
      slowly: Type.Optional(Type.Boolean({ description: "Type with a small delay between characters." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.type(params);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: {} };
    },
  });

  pi.registerTool({
    name: "browser_select",
    label: "Browser Select",
    description:
      "Select an option in a <select> element on the current page by option value or label. Prefer an exact ref from the latest browser_snapshot.",
    promptSnippet: "Choose options in dropdown/select elements using exact refs from browser_snapshot.",
    parameters: Type.Object({
      ref: Type.Optional(Type.String({ description: "Stable element ref from the latest browser_snapshot. Prefer this." })),
      selector: Type.Optional(Type.String({ description: "CSS selector only when no usable ref is available." })),
      value: Type.Optional(Type.String({ description: "The option value to select." })),
      label: Type.Optional(Type.String({ description: "The option label to select." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.select(params);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: {} };
    },
  });

  pi.registerTool({
    name: "browser_press_key",
    label: "Browser Press Key",
    description: "Press a keyboard key in the current page.",
    parameters: Type.Object({
      key: Type.String({ description: "The key to press, e.g. Enter or ArrowDown." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.pressKey(params.key);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: {} };
    },
  });

  pi.registerTool({
    name: "browser_wait_for",
    label: "Browser Wait For",
    description: "Wait for time, selector visibility, text appearance, or text disappearance.",
    parameters: Type.Object({
      timeMs: Type.Optional(
        Type.Number({ description: "Milliseconds to wait (max 60000).", minimum: 0, maximum: 60000 }),
      ),
      selector: Type.Optional(Type.String({ description: "CSS selector to wait to become visible." })),
      text: Type.Optional(Type.String({ description: "Visible text to wait for." })),
      textGone: Type.Optional(Type.String({ description: "Visible text to wait to disappear." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.waitFor(params, signal);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: {} };
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: "Save a screenshot of the current page or a specific element to the browser output directory.",
    parameters: Type.Object({
      filename: Type.Optional(Type.String({ description: "Optional filename within the browser output directory." })),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture the full scrollable page." })),
      selector: Type.Optional(Type.String({ description: "Optional CSS selector for an element screenshot." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.screenshot(params);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_console",
    label: "Browser Console",
    description: "Read console messages (including errors and page errors) captured for the current page.",
    parameters: Type.Object({
      level: Type.Optional(Type.String({ description: "Minimum level: debug, info, warning, or error." })),
      all: Type.Optional(Type.Boolean({ description: "Include messages from previous navigations in the current tab." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const level = params.level === "debug" || params.level === "warning" || params.level === "error" ? params.level : "info";
      const result = await session.consoleMessages(level, params.all ?? false);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? { fullPath: result.fullPath } };
    },
  });

  pi.registerTool({
    name: "browser_network",
    label: "Browser Network",
    description:
      "Read network evidence for the current page: status codes, HTTP errors (ERROR(4xx/5xx)), request failures (FAILED), and requests blocked by the loopback guard (BLOCKED).",
    promptSnippet: "Inspect network requests, HTTP errors, and blocked external requests.",
    parameters: Type.Object({
      includeStatic: Type.Optional(Type.Boolean({ description: "Include images, stylesheets, and fonts." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.networkRequests(params.includeStatic ?? false);
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? { fullPath: result.fullPath } };
    },
  });

  pi.registerTool({
    name: "browser_trace_start",
    label: "Browser Trace Start",
    description: "Start Playwright tracing (screenshots + snapshots) for the current browser run.",
    promptSnippet: "Start recording a Playwright trace before reproducing a bug.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.startTracing();
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_trace_stop",
    label: "Browser Trace Stop",
    description: "Stop Playwright tracing and save the trace archive into the browser output directory.",
    promptSnippet: "Save the recorded trace archive.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = await getSession(ctx);
      const result = await session.stopTracing();
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });

  pi.registerTool({
    name: "browser_close",
    label: "Browser Close",
    description:
      "Deterministically close the browser run: finalize any active trace, close the context and Chromium, and clear captured state. The next browser tool call starts a fresh run.",
    promptSnippet: "Close the headless browser deterministically.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!browserSession) {
        updateUi(ctx);
        return {
          content: [{ type: "text", text: "Browser is already closed." }],
          details: { started: false },
        };
      }
      const session = browserSession;
      const result = await session.closeRun();
      browserSession = undefined;
      updateUi(ctx);
      return { content: [{ type: "text", text: result.text }], details: result.details ?? {} };
    },
  });
}
