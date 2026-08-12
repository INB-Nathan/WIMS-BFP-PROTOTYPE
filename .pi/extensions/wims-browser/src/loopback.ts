/**
 * Loopback-only network policy for the WIMS browser QA extension.
 *
 * Security invariant (enforced in code, not by prompt rules): the browser may
 * only reach loopback hosts over http(s)/ws(s), plus narrowly necessary
 * non-network schemes (about:, blob:, data:) that Playwright and local web
 * apps legitimately use. Credentials embedded in URLs are rejected.
 *
 * Allowed hosts:
 * - `localhost` (case-insensitive)
 * - `*.localhost` (RFC 6761 special-use domain; any subdomain, case-insensitive)
 * - `127.0.0.0/8` (any IPv4 address whose first octet is 127)
 * - `::1` (IPv6 loopback, with or without URL brackets)
 *
 * Everything else — including public hosts, private/link-local networks,
 * `file:`, `chrome:`, and similar schemes — is refused.
 */

const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
const DOCUMENT_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_NON_NETWORK_SCHEMES = new Set(["about:", "blob:", "data:"]);
const LOCALHOST_SUFFIX = ".localhost";

function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  if (parts[0] !== "127") return false;
  return parts.slice(1).every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    return Number(octet) <= 255;
  });
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") return true;
  if (lower === "::1" || lower === "[::1]") return true;
  if (isLoopbackIpv4(lower)) return true;
  // *.localhost special-use domain: exactly one or more labels before
  // ".localhost". A trailing dot ("localhost.") or a suffix like
  // "localhost.evil.com" does NOT match.
  if (lower.length > LOCALHOST_SUFFIX.length && lower.endsWith(LOCALHOST_SUFFIX)) {
    return true;
  }
  return false;
}

function parseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

/**
 * Validate a URL that the agent explicitly navigates to. Throws with a
 * descriptive error when the URL is not an http(s) loopback URL without
 * credentials. Returns the normalized URL string on success.
 */
export function assertLoopbackUrl(rawUrl: string): string {
  const url = parseUrl(rawUrl);
  if (!url) {
    throw new Error(`browser_navigate: invalid URL "${rawUrl}"`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("browser_navigate: URLs with embedded credentials are not allowed");
  }
  if (!DOCUMENT_SCHEMES.has(url.protocol)) {
    throw new Error(`browser_navigate: only http(s) loopback URLs are allowed (got scheme "${url.protocol}")`);
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error(
      `browser_navigate: only loopback hosts are allowed (localhost, *.localhost, 127.0.0.0/8, [::1]); got host "${url.hostname}"`,
    );
  }
  return url.toString();
}

/**
 * Decide whether a browser request (navigation, popup, redirect, subresource,
 * fetch/XHR, or WebSocket) may proceed. This is the request-level guard that
 * runs for every request in the browser context.
 */
export function isAllowedRequestUrl(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (ALLOWED_NON_NETWORK_SCHEMES.has(url.protocol)) return true;
  if (!NETWORK_SCHEMES.has(url.protocol)) return false;
  if (url.username !== "" || url.password !== "") return false;
  return isLoopbackHost(url.hostname);
}
