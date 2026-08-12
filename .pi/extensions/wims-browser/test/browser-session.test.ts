import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserSession } from "../src/browser-session.js";

let server: Server;
let baseUrl = "";
let outputDir = "";

const LOGIN_PAGE = `<!doctype html>
<html>
  <head><title>Login</title></head>
  <body>
    <h1>Login</h1>
    <label>Email <input id="email" placeholder="Email" /></label>
    <label>Color
      <select id="color">
        <option value="red">Red</option>
        <option value="green">Green</option>
      </select>
    </label>
    <button id="submit" onclick="console.error('clicked submit'); fetch('/api/data').then(() => location.href='/next');">Submit</button>
    <a href="/next" target="_blank" rel="noopener" aria-label="Open next tab">Open next tab</a>
    <a href="https://example.com/" target="_blank" rel="noopener" aria-label="External tab">External tab</a>
    <img src="https://example.com/logo.png" alt="external image" />
    <script>
      document.getElementById('color').addEventListener('change', function () {
        document.title = 'picked-' + document.getElementById('color').value;
      });
      fetch('https://example.com/api/x').catch(function () {});
      try { new WebSocket('wss://example.com/socket'); } catch (e) {}
    </script>
  </body>
</html>`;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "wims-browser-test-"));
  server = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.url.startsWith("/api/data")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url.startsWith("/next")) {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><html><body><h1>Next page</h1><p>Done</p></body></html>");
      return;
    }
    if (req.url.startsWith("/geo")) {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><body><h1>Geo test</h1>
        <p id="geo">pending</p>
        <script>
          var out = document.getElementById('geo');
          navigator.geolocation.getCurrentPosition(
            function (pos) { out.textContent = 'lat:' + pos.coords.latitude.toFixed(2) + ',lon:' + pos.coords.longitude.toFixed(2); },
            function (err) { out.textContent = 'denied:' + err.code; }
          );
          setTimeout(function () { if (out.textContent === 'pending') out.textContent = 'timeout'; }, 5000);
        </script></body></html>`);
      return;
    }
    if (req.url.startsWith("/redirect")) {
      res.statusCode = 302;
      res.setHeader("Location", "https://example.com/");
      res.end();
      return;
    }
    if (req.url.startsWith("/slow-redirect")) {
      // Deliberately answer only after the guarded passthrough fetch has
      // timed out, so the fetch fails before the 302 exists. If the guard
      // ever continued unguarded, the browser would follow this redirect to
      // the external URL.
      res.on("error", () => undefined);
      setTimeout(() => {
        if (res.destroyed || res.writableEnded) return;
        res.statusCode = 302;
        res.setHeader("Location", "https://example.com/");
        res.end();
      }, 500);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(LOGIN_PAGE);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(outputDir, { recursive: true, force: true });
});

function makeSession(
  overrides: Partial<ConstructorParameters<typeof BrowserSession>[0]> = {},
): BrowserSession {
  return new BrowserSession({
    cwd: outputDir,
    outputDir,
    viewport: { width: 1200, height: 800 },
    retention: { maxArtifacts: 50, maxBytes: 512 * 1024 * 1024, maxAgeDays: 7 },
    actionTimeoutMs: 10_000,
    navigationTimeoutMs: 10_000,
    ...overrides,
  });
}

test("loopback QA flow: start, navigate, snapshot refs, type, select, click, wait, console, network, screenshot", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const snapshot = await session.snapshot();
    assert.match(snapshot.text, /Login/);
    assert.match(snapshot.text, /Interactive elements:/);

    const emailRef = snapshot.refs.find((ref) => ref.role === "textbox");
    const buttonRef = snapshot.refs.find((ref) => ref.role === "button");
    const selectRef = snapshot.refs.find((ref) => ref.role === "select");
    assert.ok(emailRef, "expected textbox ref");
    assert.ok(buttonRef, "expected button ref");
    assert.ok(selectRef, "expected select ref");

    await session.type({ ref: emailRef.ref, text: "qa@example.com" });
    await session.select({ ref: selectRef.ref, value: "green" });
    const afterSelect = await session.snapshot();
    assert.match(afterSelect.text, /Title: picked-green/, "select change listener should have run");

    await session.click({ ref: buttonRef.ref });
    await session.waitFor({ text: "Next page" });

    const consoleMessages = await session.consoleMessages("error", true);
    assert.match(consoleMessages.text, /clicked submit/);

    const network = await session.networkRequests();
    assert.match(network.text, /GET 200 fetch http:\/\/127\.0\.0\.1:\d+\/api\/data/);
    // Loopback guard evidence: external subresource, fetch/XHR, and WebSocket
    // attempts from the local page are blocked.
    assert.match(network.text, /BLOCKED\(loopback-guard\)/);
    assert.match(network.text, /https:\/\/example\.com\/api\/x/);
    assert.match(network.text, /wss:\/\/example\.com\/socket/);
    assert.match(network.text, /https:\/\/example\.com\/logo\.png/);
    assert.doesNotMatch(network.text, /BLOCKED.*\/api\/data/, "loopback requests must not be blocked");

    const shot = await session.screenshot({ filename: "qa-flow.png" });
    assert.ok(shot.details && typeof shot.details.path === "string", "expected screenshot path");
    const shotStats = await stat(shot.details.path as string);
    assert.ok(shotStats.size > 0, "expected non-empty screenshot");
  } finally {
    await session.stop();
  }
});

test("external navigation is rejected before any request", async () => {
  const session = makeSession();
  await session.start();
  try {
    await assert.rejects(session.navigate("https://example.com/"), /only loopback hosts/);
    await assert.rejects(session.navigate("http://user:pass@localhost:3000/"), /credentials/);
  } finally {
    await session.stop();
  }
});

test("redirect to an external URL is blocked and recorded as evidence", async () => {
  const session = makeSession();
  await session.start();
  try {
    // The guard fulfills the navigation with 403 instead of letting the
    // browser follow the external redirect target.
    await session.navigate(`${baseUrl}/redirect`);
    const network = await session.networkRequests();
    assert.match(network.text, /BLOCKED\(loopback-guard\)/);
    assert.match(network.text, /https:\/\/example\.com\//);
    assert.match(network.text, /ERROR\(403\)/);
  } finally {
    await session.stop();
  }
});

test("fail-closed: passthrough fetch failure aborts the request and no external redirect is followed", async () => {
  // The server answers /slow-redirect only after 500ms; the passthrough
  // fetch (300ms timeout) fails first. The guard must abort the request and
  // never continue it unguarded, so the 302 to the external URL is never
  // seen by the browser and no external request can occur.
  const session = makeSession({ actionTimeoutMs: 300 });
  await session.start();
  try {
    await assert.rejects(session.navigate(`${baseUrl}/slow-redirect`));
    const network = await session.networkRequests();
    assert.match(network.text, /BLOCKED\(loopback-guard-fetch-failed\)/);
    assert.match(network.text, /\/slow-redirect/);
    assert.doesNotMatch(network.text, /example\.com/, "no external request may be attempted");
    const status = session.getStatus();
    assert.ok(
      status.currentUrl === undefined || !status.currentUrl.includes("example.com"),
      "page must never reach the external URL",
    );
  } finally {
    await session.stop();
  }
});

test("popup to an external URL is blocked; popup to loopback works", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const snapshot = await session.snapshot();
    const externalTabRef = snapshot.refs.find((ref) => ref.name === "External tab");
    assert.ok(externalTabRef, "expected external tab link ref");
    const clickResult = await session.click({ ref: externalTabRef.ref });
    assert.match(clickResult.text, /A new tab opened/);
    const network = await session.networkRequests();
    assert.match(network.text, /BLOCKED\(loopback-guard\)/);
    assert.match(network.text, /https:\/\/example\.com\//);
  } finally {
    await session.stop();
  }

  const session2 = makeSession();
  await session2.start();
  try {
    await session2.navigate(baseUrl);
    const snapshot2 = await session2.snapshot();
    const loopbackTabRef = snapshot2.refs.find((ref) => ref.name === "Open next tab");
    assert.ok(loopbackTabRef, "expected loopback tab link ref");
    const clickResult2 = await session2.click({ ref: loopbackTabRef.ref });
    assert.match(clickResult2.text, /A new tab opened: \[1\]/);
    assert.match(clickResult2.text, /\/next/);
    const network2 = await session2.networkRequests();
    assert.doesNotMatch(network2.text, /BLOCKED.*\/next/, "loopback popup navigation must not be blocked");
  } finally {
    await session2.stop();
  }
});

test("fresh run semantics: restart discards refs and captured state", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const snapshot = await session.snapshot();
    const buttonRef = snapshot.refs.find((ref) => ref.role === "button");
    assert.ok(buttonRef, "expected button ref");

    await session.stop();
    assert.equal(session.getStatus().started, false);

    await session.start();
    await assert.rejects(session.click({ ref: buttonRef.ref }), /Unknown ref/);
  } finally {
    await session.stop();
  }
});

test("bounded wait: timeMs works and an aborted signal cancels the wait", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const waited = await session.waitFor({ timeMs: 50 });
    assert.match(waited.text, /Waited 50ms/);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(session.waitFor({ timeMs: 1000 }, controller.signal), /Wait cancelled by user/);

    const tooLong = await session.waitFor({ selector: "#email" });
    assert.match(tooLong.text, /Selector became visible/);
  } finally {
    await session.stop();
  }
});

test("tracing: start/stop writes a trace archive; deterministic close finalizes an active trace", async () => {
  const session = makeSession();
  await session.start();
  try {
    const started = await session.startTracing();
    assert.match(started.text, /Tracing started/);
    await session.navigate(baseUrl);
    await session.snapshot();

    const stopped = await session.stopTracing();
    assert.ok(stopped.fullPath, "expected trace path");
    const traceStats = await stat(stopped.fullPath as string);
    assert.ok(traceStats.size > 0, "expected non-empty trace archive");
  } finally {
    await session.stop();
  }

  const session2 = makeSession();
  await session2.start();
  try {
    await session2.startTracing();
    await session2.navigate(baseUrl);
    await session2.closeRun();
    assert.equal(session2.getStatus().started, false);
    const artifacts = await readdir(outputDir);
    assert.ok(artifacts.some((name) => name.startsWith("trace-") && name.endsWith(".zip")), "expected finalized trace artifact");
  } finally {
    await session2.stop();
  }
});

test("reload: reloads the current page, optionally bypassing the cache", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const plain = await session.reload();
    assert.match(plain.text, /Reloaded http:\/\/127\.0\.0\.1/);
    const afterReload = await session.snapshot();
    assert.match(afterReload.text, /Login/);

    const hard = await session.reload(true);
    assert.match(hard.text, /bypassing cache/);
    const afterHard = await session.snapshot();
    assert.match(afterHard.text, /Login/);
  } finally {
    await session.stop();
  }
});

test("go back / go forward: browser history navigation on the same loopback origin", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    await session.navigate(`${baseUrl}/next`);
    const back = await session.goBack();
    assert.equal(back.details?.moved, true, "expected a real history entry to go back to");
    assert.match(back.text, /Went back to/);
    const snapshot = await session.snapshot();
    assert.match(snapshot.text, /Login/);

    const forward = await session.goForward();
    assert.equal(forward.details?.moved, true, "expected a forward history entry");
    assert.match(forward.text, /Went forward to/);
    await session.waitFor({ text: "Next page" });

    // No further history in either direction: stays on the current page.
    const noForward = await session.goForward();
    assert.equal(noForward.details?.moved, false);
  } finally {
    await session.stop();
  }
});

test("viewport: resize the page viewport and keep it across a reload", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const resized = await session.setViewport(375, 667);
    assert.match(resized.text, /Viewport resized to 375x667/);
    assert.equal(resized.details?.width, 375);
    assert.equal(resized.details?.height, 667);
    await session.reload();
    const again = await session.setViewport(320, 568);
    assert.match(again.text, /Viewport resized to 320x568/);
    await assert.rejects(session.setViewport(0, 100), /positive integers/);
  } finally {
    await session.stop();
  }
});

test("tabs: select by index, close current or by index, refuse to close the last tab", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const snapshot = await session.snapshot();
    const loopbackTabRef = snapshot.refs.find((ref) => ref.name === "Open next tab");
    assert.ok(loopbackTabRef, "expected loopback tab link ref");
    await session.click({ ref: loopbackTabRef.ref });
    assert.equal(session.getStatus().tabCount, 2);

    const selected = await session.selectTab(1);
    assert.match(selected.text, /Selected tab \[1\]/);
    assert.match(selected.text, /\/next/);

    await session.selectTab(0);
    const closedCurrent = await session.closeTab();
    assert.equal(closedCurrent.details?.closed, true);
    assert.equal(closedCurrent.details?.tabCount, 1);
    assert.match(closedCurrent.text, /\/next/);

    const refused = await session.closeTab();
    assert.equal(refused.details?.closed, false);
    assert.match(refused.text, /Cannot close the last tab/);
    assert.equal(session.getStatus().tabCount, 1);

    await assert.rejects(session.selectTab(5), /out of range/);
    await assert.rejects(session.closeTab(3), /out of range/);
  } finally {
    await session.stop();
  }
});

test("offline/online: navigation fails while offline and recovers after going online", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(baseUrl);
    const offline = await session.setOffline(true);
    assert.match(offline.text, /OFFLINE/);
    // While offline, the network is down; a reload of the current page fails.
    await assert.rejects(session.reload());
    await assert.rejects(session.navigate(`${baseUrl}/next`));
    // The loopback guard still runs: the failed requests are recorded as
    // BLOCKED(offline) evidence rather than being continued unguarded.
    const network = await session.networkRequests();
    assert.match(network.text, /BLOCKED\(offline\)/);

    const online = await session.setOffline(false);
    assert.match(online.text, /ONLINE/);
    await session.navigate(`${baseUrl}/next`);
    await session.waitFor({ text: "Next page" });
  } finally {
    await session.stop();
  }
});

test("geolocation: set deterministic coordinates, then clear and deny for the fallback path", async () => {
  const session = makeSession();
  await session.start();
  try {
    const set = await session.setGeolocation(14.5995, 120.9842);
    assert.equal(set.details?.latitude, 14.5995);
    assert.equal(set.details?.longitude, 120.9842);

    await session.navigate(`${baseUrl}/geo`);
    await session.waitFor({ text: "lat:14.60,lon:120.98" });

    const cleared = await session.clearGeolocation();
    assert.match(cleared.text, /Geolocation cleared/);

    // Deny: clearing permission overrides makes headless Chromium deny the
    // request, which the page reports as PERMISSION_DENIED (code 1).
    const denied = await session.setPermission("geolocation", false);
    assert.match(denied.text, /Denied geolocation/);
    await session.navigate(`${baseUrl}/geo`);
    await session.waitFor({ text: "denied:1" });

    // Grant again and re-set coordinates: the page reports them again.
    await session.setPermission("geolocation", true);
    await session.setGeolocation(14.5995, 120.9842);
    await session.navigate(`${baseUrl}/geo`);
    await session.waitFor({ text: "lat:14.60,lon:120.98" });

    await assert.rejects(session.setGeolocation(91, 0), /latitude must be in/);
  } finally {
    await session.stop();
  }
});
