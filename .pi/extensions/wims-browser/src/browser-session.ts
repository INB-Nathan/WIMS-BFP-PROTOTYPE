import { basename, extname, resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Response,
  type Route,
  type WebSocketRoute,
} from "playwright";
import { assertLoopbackUrl, isAllowedRequestUrl } from "./loopback.js";
import type {
  BrowserArtifactInfo,
  BrowserLaunchConfig,
  BrowserStatus,
  ConsoleEntry,
  InteractiveElementRef,
  NetworkEntry,
  SnapshotResult,
  TextResult,
} from "./types.js";
import {
  ensureDir,
  formatBytes,
  listArtifacts,
  pruneArtifacts,
  resolveArtifactPath,
  truncateText,
  writeOutputFile,
} from "./utils.js";

interface CollectRefsResult {
  refs: InteractiveElementRef[];
  pageText: string[];
}

const BLOCKED_BY_GUARD_PREFIX = "net::ERR_BLOCKED_BY_CLIENT";

function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1);
    return (last || parsed.hostname || "page").replace(/[^a-z0-9_-]+/gi, "-");
  } catch {
    return "page";
  }
}

function consoleLevel(type: string): ConsoleEntry["level"] {
  if (type === "error" || type === "warning") return type;
  if (type === "debug") return "debug";
  return "info";
}

function buildInteractiveSummary(refs: InteractiveElementRef[]): string[] {
  if (refs.length === 0) return ["Interactive elements:", "(none visible)"];
  return [
    "Interactive elements:",
    ...refs.map((ref) => `- [ref=${ref.ref}] ${ref.description}${ref.disabled ? " (disabled)" : ""}`),
  ];
}

export class BrowserSession {
  private readonly config: BrowserLaunchConfig;
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private currentPageId: string | undefined;
  private pageIds = new WeakMap<Page, string>();
  private attachedPages = new WeakSet<Page>();
  private pageIdCounter = 0;
  private navigationIds = new Map<string, number>();
  private consoleEntries: ConsoleEntry[] = [];
  private networkEntries: NetworkEntry[] = [];
  private blockedEntries: NetworkEntry[] = [];
  private currentRefs = new Map<string, { pageId: string; selector: string; description: string }>();
  private tracingActive = false;
  private lastTracePath: string | undefined;
  private offline = false;

  constructor(config: BrowserLaunchConfig) {
    this.config = config;
  }

  isStarted(): boolean {
    return this.context !== undefined;
  }

  getStatus(): BrowserStatus {
    const pages = this.context?.pages() ?? [];
    const currentPage = this.getCurrentPageOrUndefined();
    const status: BrowserStatus = {
      started: this.context !== undefined,
      tabCount: pages.length,
      currentTabIndex: currentPage ? pages.indexOf(currentPage) : -1,
      outputDir: this.config.outputDir,
      tracingActive: this.tracingActive,
    };
    const currentUrl = currentPage?.url();
    if (currentUrl) {
      status.currentUrl = currentUrl;
    }
    return status;
  }

  async start(): Promise<void> {
    if (this.context) return;
    await ensureDir(this.config.outputDir);
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
      // Security invariant: block Service Worker registration. context.route
      // does not intercept requests that a service worker handles (or answers
      // from its own fetch handler), so an allowed worker could fetch
      // non-loopback URLs without any guard evidence. "block" denies
      // registration before any worker script is fetched or executed.
      serviceWorkers: "block",
    });
    this.context.setDefaultTimeout(this.config.actionTimeoutMs);
    this.context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    this.installLoopbackGuard();
    const page = await this.context.newPage();
    this.attachPage(page);
    this.currentPageId = this.getPageId(page);
  }

  async stop(): Promise<void> {
    await this.closeRuntime();
  }

  /** Deterministically close the whole run (trace, context, browser). */
  async closeRun(): Promise<TextResult> {
    await this.closeRuntime();
    return {
      text: "Browser closed. The next browser tool call starts a fresh run.",
      details: { started: false },
    };
  }

  async startTracing(): Promise<TextResult> {
    const context = await this.getContext();
    if (this.tracingActive) {
      return { text: "Tracing is already active. Call browser_trace_stop before starting a new trace.", details: { tracingActive: true } };
    }
    await context.tracing.start({ screenshots: true, snapshots: true });
    this.tracingActive = true;
    return {
      text: `Tracing started. Call browser_trace_stop to save the trace into ${this.config.outputDir}`,
      details: { tracingActive: true, outputDir: this.config.outputDir },
    };
  }

  async stopTracing(): Promise<TextResult> {
    const context = await this.getContext();
    if (!this.tracingActive) {
      return {
        text: this.lastTracePath ? `Tracing is not active. Last trace: ${this.lastTracePath}` : "Tracing is not active.",
        details: { tracingActive: false, lastTracePath: this.lastTracePath },
      };
    }
    const path = await resolveArtifactPath(this.config.outputDir, "trace", "zip");
    await context.tracing.stop({ path });
    this.tracingActive = false;
    this.lastTracePath = path;
    const cleanup = await this.pruneArtifacts();
    const text =
      cleanup.removed.length > 0
        ? `Trace saved to ${path}\n\nArtifact cleanup removed ${cleanup.removed.length} file(s), freeing ${formatBytes(cleanup.bytesFreed)}.`
        : `Trace saved to ${path}`;
    return { text, fullPath: path, details: { tracingActive: false, path, cleanup } };
  }

  async navigate(rawUrl: string): Promise<TextResult> {
    const url = assertLoopbackUrl(rawUrl);
    const page = await this.getCurrentPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: this.config.navigationTimeoutMs }).catch(() => undefined);
    return {
      text: `Navigated to ${page.url()}`,
      details: { url: page.url() },
    };
  }

  async reload(bypassCache = false): Promise<TextResult> {
    const page = await this.getCurrentPage();
    if (bypassCache) {
      // Mimic a hard reload: browsers send Cache-Control: no-cache plus
      // Pragma: no-cache for the whole document request. The reload goes
      // through the same loopback request guard as every other navigation.
      const context = await this.getContext();
      await context.setExtraHTTPHeaders({ "Cache-Control": "no-cache", Pragma: "no-cache" });
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
      } finally {
        await context.setExtraHTTPHeaders({}).catch(() => undefined);
      }
    } else {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page.waitForLoadState("networkidle", { timeout: this.config.navigationTimeoutMs }).catch(() => undefined);
    return {
      text: `Reloaded ${page.url()}${bypassCache ? " (bypassing cache)" : ""}`,
      details: { url: page.url(), bypassCache },
    };
  }

  async goBack(): Promise<TextResult> {
    const page = await this.getCurrentPage();
    const response = await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: this.config.navigationTimeoutMs }).catch(() => undefined);
    if (!response) {
      return { text: `No history entry to go back to; stayed on ${page.url()}`, details: { url: page.url(), moved: false } };
    }
    return { text: `Went back to ${page.url()}`, details: { url: page.url(), moved: true } };
  }

  async goForward(): Promise<TextResult> {
    const page = await this.getCurrentPage();
    const response = await page.goForward({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: this.config.navigationTimeoutMs }).catch(() => undefined);
    if (!response) {
      return { text: `No forward history entry; stayed on ${page.url()}`, details: { url: page.url(), moved: false } };
    }
    return { text: `Went forward to ${page.url()}`, details: { url: page.url(), moved: true } };
  }

  async setViewport(width: number, height: number): Promise<TextResult> {
    const page = await this.getCurrentPage();
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error("browser_viewport: width and height must be positive integers");
    }
    await page.setViewportSize({ width, height });
    const viewport = page.viewportSize();
    return {
      text: `Viewport resized to ${viewport?.width ?? width}x${viewport?.height ?? height}`,
      details: { width: viewport?.width ?? width, height: viewport?.height ?? height },
    };
  }

  async selectTab(index: number): Promise<TextResult> {
    const context = await this.getContext();
    const pages = context.pages();
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
      throw new Error(`browser_tab_select: tab index ${index} out of range (0..${pages.length - 1})`);
    }
    const target = pages[index];
    if (!target) {
      throw new Error(`browser_tab_select: tab index ${index} out of range (0..${pages.length - 1})`);
    }
    await target.bringToFront();
    this.currentPageId = this.getPageId(target);
    return {
      text: `Selected tab [${index}] ${target.url() || "about:blank"}`,
      details: { tabIndex: index, url: target.url() || undefined, tabCount: pages.length },
    };
  }

  async closeTab(index?: number): Promise<TextResult> {
    const context = await this.getContext();
    const pages = context.pages();
    const targetIndex = index ?? pages.findIndex((candidate) => this.getPageId(candidate) === this.currentPageId);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= pages.length) {
      throw new Error(`browser_tab_close: tab index ${targetIndex} out of range (0..${pages.length - 1})`);
    }
    if (pages.length <= 1) {
      return {
        text: "Cannot close the last tab. Use browser_close to end the browser run.",
        details: { closed: false, tabCount: pages.length },
      };
    }
    const target = pages[targetIndex];
    if (!target) {
      throw new Error(`browser_tab_close: tab index ${targetIndex} out of range (0..${pages.length - 1})`);
    }
    const closedUrl = target.url();
    await target.close();
    // Focus another tab: prefer the one that shifted into the same slot,
    // otherwise the last remaining one.
    const remaining = context.pages();
    const next = remaining[Math.min(targetIndex, remaining.length - 1)] ?? remaining[0];
    if (!next) {
      throw new Error("browser_tab_close: no tab left to focus after close");
    }
    await next.bringToFront();
    this.currentPageId = this.getPageId(next);
    return {
      text: `Closed tab [${targetIndex}] ${closedUrl || "about:blank"}. Now on tab [${remaining.indexOf(next)}] ${next.url() || "about:blank"}`,
      details: {
        closed: true,
        closedIndex: targetIndex,
        closedUrl: closedUrl || undefined,
        tabCount: remaining.length,
        activeTabIndex: remaining.indexOf(next),
        activeTabUrl: next.url() || undefined,
      },
    };
  }

  async setOffline(offline: boolean): Promise<TextResult> {
    const context = await this.getContext();
    this.offline = offline;
    await context.setOffline(offline);
    return {
      text: offline
        ? "Browser is now OFFLINE. Network requests are disabled; the loopback-only request guard still applies, so any external request is still blocked and recorded as evidence."
        : "Browser is back ONLINE.",
      details: { offline },
    };
  }

  async setGeolocation(latitude: number, longitude: number): Promise<TextResult> {
    const context = await this.getContext();
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error("browser_set_geolocation: latitude must be in [-90, 90] and longitude in [-180, 180]");
    }
    // Pages only receive geolocation when the permission is granted.
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude, longitude });
    return {
      text: `Geolocation set to (${latitude}, ${longitude}) and the geolocation permission was granted.`,
      details: { latitude, longitude, permission: "granted" },
    };
  }

  async clearGeolocation(): Promise<TextResult> {
    const context = await this.getContext();
    await context.setGeolocation(null);
    return { text: "Geolocation cleared (browser default coordinates).", details: { cleared: true } };
  }

  async setPermission(permission: "geolocation" | "notifications", grant: boolean): Promise<TextResult> {
    const context = await this.getContext();
    if (grant) {
      await context.grantPermissions([permission]);
      return { text: `Granted ${permission} permission.`, details: { permission, grant: true } };
    }
    // Playwright has no per-permission revoke: clearPermissions removes all
    // overrides and the browser returns to its default behavior (denial in
    // headless Chromium, since no prompt UI exists).
    await context.clearPermissions();
    return {
      text: `Denied ${permission}: all permission overrides cleared; the browser returns to its default (permission denial) behavior.`,
      details: { permission, grant: false },
    };
  }

  async snapshot(selector?: string): Promise<SnapshotResult> {
    const page = await this.getCurrentPage();
    const rootLocator = page.locator(selector ?? "body");
    await rootLocator.waitFor({ state: "attached" });
    const aria = await rootLocator.ariaSnapshot();
    const collected = await this.collectRefs(page, selector);
    this.currentRefs.clear();
    for (const ref of collected.refs) {
      this.currentRefs.set(ref.ref, { pageId: this.getPageId(page), selector: ref.selector, description: ref.description });
    }
    const title = await page.title();
    const lines = [
      `URL: ${page.url()}`,
      `Title: ${title || "(untitled)"}`,
      "",
      "ARIA snapshot:",
      aria || "(empty)",
      "",
      ...buildInteractiveSummary(collected.refs),
    ];
    if (collected.pageText.length > 0) {
      lines.push("", "Visible text:", ...collected.pageText);
    }
    const fullText = lines.join("\n");
    const truncated = truncateText(fullText);
    let fullPath: string | undefined;
    if (truncated.truncated) {
      fullPath = await writeOutputFile(this.config.outputDir, `snapshot-${slugFromUrl(page.url())}`, "md", fullText);
    }
    const result: SnapshotResult = {
      text: fullPath ? `${truncated.text}\n\nFull snapshot saved to: ${fullPath}` : truncated.text,
      refs: collected.refs,
      aria,
    };
    if (fullPath) {
      result.fullPath = fullPath;
    }
    return result;
  }

  async click(params: { ref?: string; selector?: string; doubleClick?: boolean; button?: "left" | "right" | "middle" }): Promise<TextResult> {
    const context = await this.getContext();
    const page = await this.getCurrentPage();
    const beforePages = context.pages();
    const beforeCount = beforePages.length;
    const beforePageIds = new Set(beforePages.map((candidate) => this.getPageId(candidate)));
    const beforeUrl = page.url();

    const locator = await this.resolveLocator(params.ref, params.selector);
    await locator.scrollIntoViewIfNeeded();
    if (params.doubleClick) {
      await locator.dblclick({ button: params.button ?? "left" });
    } else {
      await locator.click({ button: params.button ?? "left" });
    }
    await page.waitForTimeout(150).catch(() => undefined);

    const afterPages = context.pages();
    const newPage = afterPages.find((candidate) => !beforePageIds.has(this.getPageId(candidate)));
    const currentPage = this.getCurrentPageOrUndefined();
    const currentUrl = currentPage?.url();

    const textLines = [`Clicked ${params.ref ?? params.selector ?? "element"}`];
    const details: Record<string, unknown> = {
      beforeTabCount: beforeCount,
      afterTabCount: afterPages.length,
      currentUrl,
    };

    if (newPage) {
      const newTabIndex = afterPages.indexOf(newPage);
      textLines.push(`A new tab opened: [${newTabIndex}] ${newPage.url() || "about:blank"}`);
      details.newTabOpened = true;
      details.newTabIndex = newTabIndex;
      details.newTabUrl = newPage.url();
    } else if (currentUrl && currentUrl !== beforeUrl) {
      textLines.push(`Current tab navigated to: ${currentUrl}`);
      details.newTabOpened = false;
      details.navigationInCurrentTab = true;
    } else {
      details.newTabOpened = false;
      details.navigationInCurrentTab = false;
    }

    return { text: textLines.join("\n"), details };
  }

  async type(params: { ref?: string; selector?: string; text: string; submit?: boolean; slowly?: boolean }): Promise<TextResult> {
    const page = await this.getCurrentPage();
    const locator = await this.resolveLocator(params.ref, params.selector);
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
    const isFillable = tagName === "input" || tagName === "textarea";
    if (isFillable && !params.slowly) {
      await locator.fill(params.text);
    } else {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
      await page.keyboard.type(params.text, { delay: params.slowly ? 40 : 0 });
    }
    if (params.submit) {
      await page.keyboard.press("Enter");
    }
    return { text: `Typed into ${params.ref ?? params.selector ?? "element"}` };
  }

  async select(params: { ref?: string; selector?: string; value?: string; label?: string }): Promise<TextResult> {
    const locator = await this.resolveLocator(params.ref, params.selector);
    await locator.scrollIntoViewIfNeeded();
    const target = params.ref ?? params.selector ?? "element";
    if (params.value !== undefined) {
      await locator.selectOption({ value: params.value });
      return { text: `Selected option value "${params.value}" in ${target}` };
    }
    if (params.label !== undefined) {
      await locator.selectOption({ label: params.label });
      return { text: `Selected option label "${params.label}" in ${target}` };
    }
    throw new Error("browser_select requires either value or label");
  }

  async pressKey(key: string): Promise<TextResult> {
    const page = await this.getCurrentPage();
    await page.keyboard.press(key);
    return { text: `Pressed key ${key}` };
  }

  async waitFor(
    params: { timeMs?: number; text?: string; textGone?: string; selector?: string },
    signal?: AbortSignal,
  ): Promise<TextResult> {
    const page = await this.getCurrentPage();

    if (signal?.aborted) {
      throw new Error("Wait cancelled by user");
    }

    if (params.timeMs !== undefined) {
      const waitPromise = page.waitForTimeout(params.timeMs);

      if (signal) {
        const abortPromise = new Promise<void>((_, reject) => {
          const onAbort = () => reject(new Error("Wait cancelled by user"));
          signal.addEventListener("abort", onAbort, { once: true });
          // Cleanup if wait completes before abort
          waitPromise.then(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
        });
        await Promise.race([waitPromise, abortPromise]);
      } else {
        await waitPromise;
      }

      return { text: `Waited ${params.timeMs}ms` };
    }

    if (params.selector) {
      const locator = page.locator(params.selector);
      if (signal) {
        await this.waitForLocatorWithSignal(locator, "visible", signal);
      } else {
        await locator.waitFor({ state: "visible" });
      }
      return { text: `Selector became visible: ${params.selector}` };
    }

    if (params.text) {
      const locator = page.getByText(params.text, { exact: false });
      if (signal) {
        await this.waitForLocatorWithSignal(locator, "visible", signal);
      } else {
        await locator.waitFor({ state: "visible" });
      }
      return { text: `Text became visible: ${params.text}` };
    }

    if (params.textGone) {
      const locator = page.getByText(params.textGone, { exact: false });
      if (signal) {
        await this.waitForLocatorWithSignal(locator, "hidden", signal);
      } else {
        await locator.waitFor({ state: "hidden" });
      }
      return { text: `Text disappeared: ${params.textGone}` };
    }

    throw new Error("browser_wait_for requires one of: timeMs, selector, text, textGone");
  }

  private async waitForLocatorWithSignal(
    locator: ReturnType<Page["locator"]>,
    state: "visible" | "hidden",
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      throw new Error("Wait cancelled by user");
    }

    return new Promise((resolvePromise, reject) => {
      const onAbort = () => {
        cleanup();
        reject(new Error("Wait cancelled by user"));
      };

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };

      signal.addEventListener("abort", onAbort, { once: true });

      locator.waitFor({ state }).then(
        () => {
          cleanup();
          resolvePromise();
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  async consoleMessages(level: ConsoleEntry["level"] = "info", all = false): Promise<TextResult> {
    const page = await this.getCurrentPage();
    const pageId = this.getPageId(page);
    const currentNavigationId = this.navigationIds.get(pageId) ?? 0;
    const minimumLevel = ["debug", "info", "warning", "error"];
    const levelIndex = minimumLevel.indexOf(level);
    const relevant = this.consoleEntries.filter(
      (entry) =>
        entry.pageId === pageId &&
        minimumLevel.indexOf(entry.level) >= levelIndex &&
        (all || entry.navigationId === currentNavigationId),
    );
    const lines = relevant.map((entry) => {
      const location = entry.location ? ` (${entry.location})` : "";
      return `[${entry.level}] ${entry.text}${location}`;
    });
    const fullText = lines.length > 0 ? lines.join("\n") : "No console messages for the current page.";
    const truncated = truncateText(fullText);
    let fullPath: string | undefined;
    if (truncated.truncated) {
      fullPath = await writeOutputFile(this.config.outputDir, "console", "log", fullText);
    }
    const result: TextResult = {
      text: fullPath ? `${truncated.text}\n\nFull console log saved to: ${fullPath}` : truncated.text,
    };
    if (fullPath) {
      result.fullPath = fullPath;
    }
    return result;
  }

  async networkRequests(includeStatic = false): Promise<TextResult> {
    const page = await this.getCurrentPage();
    const pageId = this.getPageId(page);
    const currentNavigationId = this.navigationIds.get(pageId) ?? 0;
    const relevant = this.networkEntries.filter(
      (entry) =>
        entry.pageId === pageId &&
        entry.navigationId <= currentNavigationId &&
        (includeStatic || !["image", "stylesheet", "font"].includes(entry.resourceType)),
    );
    // Blocked requests are security evidence and are always listed regardless
    // of the current page filter.
    const lines = [
      ...this.blockedEntries.map((entry) => {
        const reason = entry.blockedReason ?? "loopback-guard";
        return `${entry.method} BLOCKED(${reason}) ${entry.resourceType} ${entry.url}`;
      }),
      ...relevant.map((entry) => {
        if (entry.failureText) {
          return `${entry.method} FAILED(${entry.failureText}) ${entry.resourceType} ${entry.url}`;
        }
        if (entry.status !== undefined && entry.status >= 400) {
          return `${entry.method} ERROR(${entry.status}) ${entry.resourceType} ${entry.url}`;
        }
        return `${entry.method} ${entry.status ?? 0} ${entry.resourceType} ${entry.url}`;
      }),
    ];
    const fullText = lines.length > 0 ? lines.join("\n") : "No network requests recorded for the current page.";
    const truncated = truncateText(fullText);
    let fullPath: string | undefined;
    if (truncated.truncated) {
      fullPath = await writeOutputFile(this.config.outputDir, "network", "log", fullText);
    }
    const result: TextResult = {
      text: fullPath ? `${truncated.text}\n\nFull network log saved to: ${fullPath}` : truncated.text,
    };
    if (fullPath) {
      result.fullPath = fullPath;
    }
    return result;
  }

  async screenshot(params: { filename?: string; fullPage?: boolean; selector?: string }): Promise<TextResult> {
    const page = await this.getCurrentPage();
    await ensureDir(this.config.outputDir);
    const rawName = params.filename?.trim();
    const extension = rawName && extname(rawName) ? extname(rawName).slice(1) : "png";
    const safeName = rawName && basename(rawName).length > 0 ? basename(rawName) : `screenshot-${Date.now()}.${extension}`;
    const path = resolve(this.config.outputDir, safeName);
    if (params.selector) {
      await page.locator(params.selector).screenshot({ path, type: extension === "jpeg" ? "jpeg" : "png" });
    } else {
      await page.screenshot({ path, type: extension === "jpeg" ? "jpeg" : "png", fullPage: params.fullPage ?? false });
    }
    const cleanup = await this.pruneArtifacts();
    return {
      text:
        cleanup.removed.length > 0
          ? `Saved screenshot to ${path}\n\nArtifact cleanup removed ${cleanup.removed.length} file(s), freeing ${formatBytes(cleanup.bytesFreed)}.`
          : `Saved screenshot to ${path}`,
      details: { path, cleanup },
    };
  }

  private async pruneArtifacts(): Promise<{ removed: BrowserArtifactInfo[]; remaining: BrowserArtifactInfo[]; bytesFreed: number }> {
    return pruneArtifacts(this.config.outputDir, this.config.retention);
  }

  /**
   * Loopback enforcement point. Every HTTP(S) request (navigations, popups,
   * redirects, subresources, fetch/XHR) and every WebSocket upgrade in the
   * context is checked here; non-loopback traffic is aborted and recorded as
   * evidence. This is a security invariant, not a prompt rule.
   */
  private installLoopbackGuard(): void {
    const context = this.context;
    if (!context) return;

    context.on("page", (page) => {
      this.attachPage(page);
    });

    void context.route("**/*", async (route: Route) => {
      const rawUrl = route.request().url();
      if (!isAllowedRequestUrl(rawUrl)) {
        this.recordBlockedRequest(route, rawUrl, "loopback-guard");
        await route.abort("blockedbyclient").catch(() => undefined);
        return;
      }
      // Offline mode: context.setOffline() alone would not affect requests
      // fulfilled through route.fetch() (the passthrough below fetches via
      // Playwright's own network stack, which ignores the offline flag). The
      // guard therefore enforces offline itself by aborting every request
      // with the network error the browser would see when offline. This stays
      // fail-closed: route.continue() is never used, so no request can escape
      // the guard while offline.
      if (this.offline) {
        this.recordBlockedRequest(route, rawUrl, "offline");
        await route.abort("internetdisconnected").catch(() => undefined);
        return;
      }
      // Network passthrough: fetch the response ourselves so that redirect
      // targets can be validated before the browser follows them. Playwright
      // only routes the first request of a redirect chain, so a plain
      // route.continue() would let external redirect targets through.
      //
      // Fail closed: if the passthrough fetch fails (timeout, TLS, protocol,
      // or network error), the request is aborted and recorded as evidence.
      // Continuing unguarded would let a redirect chain escape the loopback
      // invariant, and error details may contain sensitive data (certificates,
      // response fragments), so the recorded reason is a fixed string.
      let response;
      try {
        response = await route.fetch({ maxRedirects: 0, timeout: this.config.actionTimeoutMs });
      } catch {
        this.recordBlockedRequest(route, rawUrl, "loopback-guard-fetch-failed");
        await route.abort("blockedbyclient").catch(() => undefined);
        return;
      }
      const status = response.status();
      if (status >= 300 && status < 400) {
        const location = response.headers()["location"];
        if (location) {
          let target: string | undefined;
          try {
            target = new URL(location, rawUrl).toString();
          } catch {
            target = undefined;
          }
          if (target && !isAllowedRequestUrl(target)) {
            this.recordBlockedRequest(route, target, "loopback-guard");
            await route
              .fulfill({ status: 403, contentType: "text/plain", body: "blocked by loopback guard" })
              .catch(() => undefined);
            return;
          }
        }
      }
      await route.fulfill({ response }).catch(() => undefined);
    });

    if (typeof context.routeWebSocket === "function") {
      void context.routeWebSocket("**/*", async (route: WebSocketRoute) => {
        const rawUrl = route.url();
        if (this.offline) {
          this.blockedEntries.push({
            pageId: "",
            pageIndex: -1,
            url: rawUrl,
            method: "WS",
            resourceType: "websocket",
            ok: false,
            blockedReason: "offline",
            timestamp: Date.now(),
            navigationId: 0,
          });
          await route.close().catch(() => undefined);
          return;
        }
        if (isAllowedRequestUrl(rawUrl)) {
          route.connectToServer();
          return;
        }
        this.blockedEntries.push({
          pageId: "",
          pageIndex: -1,
          url: rawUrl,
          method: "WS",
          resourceType: "websocket",
          ok: false,
          blockedReason: "loopback-guard",
          timestamp: Date.now(),
          navigationId: 0,
        });
        await route.close().catch(() => undefined);
      });
    }
  }

  private recordBlockedRequest(route: Route, rawUrl: string, reason: string): void {
    let pageId = "";
    let pageIndex = -1;
    try {
      const frame = route.request().frame();
      const page = frame.page();
      pageId = this.getPageId(page);
      pageIndex = this.getPageIndex(page);
    } catch {
      // Frame/page may be detached already; the block is still recorded.
    }
    this.blockedEntries.push({
      pageId,
      pageIndex,
      url: rawUrl,
      method: route.request().method(),
      resourceType: route.request().resourceType(),
      ok: false,
      blockedReason: reason,
      timestamp: Date.now(),
      navigationId: this.navigationIds.get(pageId) ?? 0,
    });
  }

  private async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      await this.start();
    }
    if (!this.context) {
      throw new Error("Browser context unavailable");
    }
    return this.context;
  }

  private async getCurrentPage(): Promise<Page> {
    const context = await this.getContext();
    const current = this.getCurrentPageOrUndefined();
    if (current) return current;
    const page = context.pages()[0] ?? (await context.newPage());
    this.attachPage(page);
    this.currentPageId = this.getPageId(page);
    return page;
  }

  private getCurrentPageOrUndefined(): Page | undefined {
    const pages = this.context?.pages() ?? [];
    if (!this.currentPageId) return pages[0];
    return pages.find((page) => this.getPageId(page) === this.currentPageId) ?? pages[0];
  }

  private getPageId(page: Page): string {
    const existing = this.pageIds.get(page);
    if (existing) return existing;
    const id = `p${++this.pageIdCounter}`;
    this.pageIds.set(page, id);
    return id;
  }

  private getPageIndex(page: Page): number {
    return (this.context?.pages() ?? []).findIndex((candidate) => candidate === page);
  }

  private attachPage(page: Page): void {
    if (this.attachedPages.has(page)) {
      return;
    }
    this.attachedPages.add(page);
    const pageId = this.getPageId(page);
    if (!this.navigationIds.has(pageId)) {
      this.navigationIds.set(pageId, 0);
    }
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.navigationIds.set(pageId, (this.navigationIds.get(pageId) ?? 0) + 1);
      }
    });
    page.on("console", (message) => {
      this.consoleEntries.push(this.serializeConsoleMessage(page, message));
      if (this.consoleEntries.length > 500) {
        this.consoleEntries.splice(0, this.consoleEntries.length - 500);
      }
    });
    page.on("pageerror", (error) => {
      this.consoleEntries.push({
        pageId,
        pageIndex: this.getPageIndex(page),
        level: "error",
        text: error.message,
        timestamp: Date.now(),
        navigationId: this.navigationIds.get(pageId) ?? 0,
      });
    });
    page.on("response", (response) => {
      this.networkEntries.push(this.serializeResponse(page, response));
      if (this.networkEntries.length > 1000) {
        this.networkEntries.splice(0, this.networkEntries.length - 1000);
      }
    });
    page.on("requestfailed", (request) => {
      const failureText = request.failure()?.errorText;
      // Aborts caused by the loopback guard are already recorded as blocked
      // entries; do not double-report them as generic failures.
      if (failureText?.startsWith(BLOCKED_BY_GUARD_PREFIX)) {
        return;
      }
      const failureEntry: NetworkEntry = {
        pageId,
        pageIndex: this.getPageIndex(page),
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        ok: false,
        timestamp: Date.now(),
        navigationId: this.navigationIds.get(pageId) ?? 0,
      };
      if (failureText) {
        failureEntry.failureText = failureText;
      }
      this.networkEntries.push(failureEntry);
    });
  }

  private serializeConsoleMessage(page: Page, message: ConsoleMessage): ConsoleEntry {
    const location = message.location();
    const locationText = location.url ? `${location.url}:${location.lineNumber ?? 0}` : undefined;
    const pageId = this.getPageId(page);
    const entry: ConsoleEntry = {
      pageId,
      pageIndex: this.getPageIndex(page),
      level: consoleLevel(message.type()),
      text: message.text(),
      timestamp: Date.now(),
      navigationId: this.navigationIds.get(pageId) ?? 0,
    };
    if (locationText) {
      entry.location = locationText;
    }
    return entry;
  }

  private serializeResponse(page: Page, response: Response): NetworkEntry {
    const request = response.request();
    const pageId = this.getPageId(page);
    return {
      pageId,
      pageIndex: this.getPageIndex(page),
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      ok: response.ok(),
      timestamp: Date.now(),
      navigationId: this.navigationIds.get(pageId) ?? 0,
    };
  }

  private async collectRefs(page: Page, selector?: string): Promise<CollectRefsResult> {
    const pageIndex = this.getPageIndex(page);
    const root = page.locator(selector ?? "body");
    const interactiveSelector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='tab']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[contenteditable='true']",
    ].join(",");
    const textSelector = "h1,h2,h3,h4,h5,h6,p,li,label,legend";

    const refs: InteractiveElementRef[] = [];
    const interactive = root.locator(interactiveSelector);
    const count = await interactive.count();
    for (let index = 0; index < count; index++) {
      const locator = interactive.nth(index);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const ref = `e${refs.length + 1}`;
      await locator.evaluate((element, value) => {
        (element as HTMLElement).dataset.piBrowserRef = value;
      }, ref);
      const metadata = await locator.evaluate((element) => {
        const htmlElement = element as HTMLElement;
        const explicitRole = htmlElement.getAttribute("role")?.trim();
        const role =
          explicitRole ??
          (htmlElement instanceof HTMLAnchorElement
            ? "link"
            : htmlElement instanceof HTMLButtonElement
              ? "button"
              : htmlElement instanceof HTMLInputElement
                ? htmlElement.type === "checkbox"
                  ? "checkbox"
                  : htmlElement.type === "radio"
                    ? "radio"
                    : htmlElement.type === "submit" || htmlElement.type === "button"
                      ? "button"
                      : "textbox"
                : htmlElement instanceof HTMLTextAreaElement
                  ? "textbox"
                  : htmlElement instanceof HTMLSelectElement
                    ? "select"
                    : htmlElement.tagName.toLowerCase());
        const labelledBy = htmlElement.getAttribute("aria-labelledby")?.trim();
        const labelledText = labelledBy
          ? labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
              .filter((value) => value.length > 0)
              .join(" ")
          : "";
        const textContent =
          htmlElement.innerText.replace(/\s+/g, " ").trim() ||
          htmlElement.textContent?.replace(/\s+/g, " ").trim() ||
          "";
        const name =
          htmlElement.getAttribute("aria-label")?.trim() ||
          labelledText ||
          (htmlElement instanceof HTMLInputElement ||
          htmlElement instanceof HTMLTextAreaElement ||
          htmlElement instanceof HTMLSelectElement
            ? htmlElement.labels?.[0]?.textContent?.trim() || ""
            : "") ||
          ("placeholder" in htmlElement
            ? String((htmlElement as HTMLInputElement | HTMLTextAreaElement).placeholder ?? "").trim()
            : "") ||
          htmlElement.getAttribute("title")?.trim() ||
          htmlElement.getAttribute("alt")?.trim() ||
          textContent ||
          htmlElement.tagName.toLowerCase();
        return {
          role,
          name,
          tagName: htmlElement.tagName.toLowerCase(),
          disabled: htmlElement.hasAttribute("disabled") || htmlElement.getAttribute("aria-disabled") === "true",
        };
      });
      refs.push({
        ref,
        role: metadata.role,
        name: metadata.name,
        tagName: metadata.tagName,
        selector: `[data-pi-browser-ref="${ref}"]`,
        description: `${metadata.role} "${metadata.name || metadata.tagName}"`,
        disabled: metadata.disabled,
        pageIndex,
      });
    }

    const pageText: string[] = [];
    const textLocators = root.locator(textSelector);
    const textCount = Math.min(await textLocators.count(), 40);
    for (let index = 0; index < textCount; index++) {
      const locator = textLocators.nth(index);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const line = await locator.evaluate((element) => {
        const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return text ? `- ${element.tagName.toLowerCase()}: ${text}` : "";
      });
      if (line) {
        pageText.push(line);
      }
    }

    return { refs, pageText };
  }

  private async resolveLocator(ref: string | undefined, selector: string | undefined) {
    const page = await this.getCurrentPage();
    if (ref) {
      const existing = this.currentRefs.get(ref);
      if (!existing) {
        throw new Error(`Unknown ref ${ref}. Run browser_snapshot again and use one of the exact returned refs.`);
      }
      if (existing.pageId !== this.getPageId(page)) {
        throw new Error(`Ref ${ref} belongs to a different tab. Select the correct tab or resnapshot.`);
      }
      return page.locator(existing.selector);
    }
    if (selector) {
      return page.locator(selector);
    }
    throw new Error("Tool requires either ref or selector. Prefer exact refs from browser_snapshot; use selectors only as a fallback.");
  }

  private async closeRuntime(): Promise<void> {
    this.currentRefs.clear();
    this.consoleEntries = [];
    this.networkEntries = [];
    this.blockedEntries = [];
    this.navigationIds.clear();
    this.currentPageId = undefined;
    this.offline = false;

    if (this.tracingActive && this.context) {
      try {
        const path = await resolveArtifactPath(this.config.outputDir, "trace", "zip");
        await this.context.tracing.stop({ path });
        this.lastTracePath = path;
      } catch {
        // Never let trace finalization block deterministic shutdown.
      }
      this.tracingActive = false;
    }

    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
    this.tracingActive = false;
  }
}
