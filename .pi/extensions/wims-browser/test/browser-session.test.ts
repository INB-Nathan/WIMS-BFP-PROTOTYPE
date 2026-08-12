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
