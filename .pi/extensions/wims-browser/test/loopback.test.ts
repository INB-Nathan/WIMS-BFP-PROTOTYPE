import test from "node:test";
import assert from "node:assert/strict";
import { assertLoopbackUrl, isAllowedRequestUrl } from "../src/loopback.js";

const ALLOWED_NAVIGATIONS = [
  "http://localhost:3000/",
  "http://localhost/",
  "https://localhost:8443/x?y=1",
  "http://127.0.0.1:3000/",
  "http://127.0.0.2:8080/",
  "http://127.255.255.255/",
  "http://[::1]:3000/",
  "https://[::1]/",
  "http://app.localhost:3000/",
  "http://deep.sub.localhost:8080/x",
  "http://LOCALHOST:3000/",
];

const REJECTED_NAVIGATIONS = [
  "https://example.com/",
  "http://192.168.1.1/",
  "http://10.0.0.1/",
  "http://0.0.0.0:3000/",
  "http://localhost.evil.com/",
  "http://evil-localhost.com/",
  "http://localhost.com/",
  "http://127.0.0.1.nip.io/",
  "http://user:pass@localhost:3000/",
  "http://user@127.0.0.1/",
  "file:///etc/passwd",
  "chrome://settings/",
  "http://localhost.:3000/",
  "not a url",
];

test("assertLoopbackUrl accepts loopback http(s) URLs without credentials", () => {
  for (const url of ALLOWED_NAVIGATIONS) {
    assert.doesNotThrow(() => assertLoopbackUrl(url), `expected ${url} to be accepted`);
  }
});

test("assertLoopbackUrl rejects external hosts, credentials, and non-http schemes", () => {
  for (const url of REJECTED_NAVIGATIONS) {
    assert.throws(() => assertLoopbackUrl(url), `expected ${url} to be rejected`);
  }
});

test("assertLoopbackUrl rejects ws(s) and data schemes for navigation", () => {
  assert.throws(() => assertLoopbackUrl("ws://localhost:3000/socket"), /only http\(s\)/);
  // data: URLs are refused regardless of whether the URL parser accepts the
  // payload (some payloads are rejected as invalid before scheme checks run).
  assert.throws(() => assertLoopbackUrl("data:text/html,<h1>x</h1>"));
  assert.throws(() => assertLoopbackUrl("data:text/plain,hello"));
});

test("assertLoopbackUrl error messages identify the offending host", () => {
  assert.throws(() => assertLoopbackUrl("https://example.com/"), /loopback/);
  assert.throws(() => assertLoopbackUrl("http://user:pass@localhost:3000/"), /credentials/);
});

test("assertLoopbackUrl normalizes and returns the URL", () => {
  assert.equal(assertLoopbackUrl("http://localhost:3000"), "http://localhost:3000/");
});

test("isAllowedRequestUrl permits loopback network requests and necessary non-network schemes", () => {
  const allowed = [
    "http://localhost:3000/api/data",
    "https://127.0.0.1:8443/x",
    "http://[::1]:3000/",
    "ws://localhost:3000/socket",
    "wss://127.0.0.1:3000/socket",
    "about:blank",
    "about:srcdoc",
    "data:text/plain,hello",
    "data:image/png;base64,iVBORw0KGgo=",
    "blob:http://localhost:3000/abc-123",
  ];
  for (const url of allowed) {
    assert.equal(isAllowedRequestUrl(url), true, `expected ${url} to be allowed`);
  }
});

test("isAllowedRequestUrl blocks external and disallowed schemes", () => {
  const blocked = [
    "https://example.com/",
    "http://192.168.1.1/",
    "http://0.0.0.0/",
    "http://localhost.evil.com/",
    "ws://example.com/socket",
    "wss://localhost.evil.com/socket",
    "file:///etc/passwd",
    "chrome://settings/",
    "http://user:pass@localhost:3000/",
    "ftp://localhost/x",
  ];
  for (const url of blocked) {
    assert.equal(isAllowedRequestUrl(url), false, `expected ${url} to be blocked`);
  }
});
