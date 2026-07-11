import { API_BASE } from './transport';
import { ApiRequestError } from './errors';
import { ApiParseError } from '@/lib/validation';

/**
 * Shared response-parsing logic used by both publicApiFetch and
 * fetchWithOptionalAuth so error handling stays consistent.
 */
async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiParseError(
      `Failed to parse response body as JSON (status ${res.status})`,
      res.status,
      text,
      cause,
    );
  }

  if (!res.ok) {
    const retryAfterHeader = res.headers?.get?.('retry-after');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
    throw new ApiRequestError(
      (json as { message?: string; detail?: string }).message
        ?? (json as { detail?: string }).detail
        ?? `Request failed: ${res.status}`,
      res.status,
      json,
      retryAfter,
    );
  }
  return json as T;
}

/**
 * Build the full URL from a path, matching the transport.ts convention.
 */
function buildUrl(path: string): string {
  const normalizedPath =
    path === '/api' ? '/' : path.startsWith('/api/') ? path.slice(4) : path;
  return normalizedPath.startsWith('http')
    ? normalizedPath
    : `${API_BASE.replace(/\/$/, '')}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

/**
 * Build request headers, omitting Content-Type for FormData bodies.
 */
function buildHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers ?? {});
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

/**
 * Zero-trust fetch — never sends cookies, never redirects to login.
 * Used for purely anonymous endpoints where the backend has no auth dependency.
 */
export async function publicApiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = buildUrl(path);
  const headers = buildHeaders(options);
  const res = await fetch(url, {
    ...options,
    credentials: 'omit',
    headers,
  });
  return parseResponse<T>(res);
}

/**
 * Fetch with optional cookie-based auth.
 *
 * Sends `credentials: 'include'` so registered users' cookies reach the
 * backend (which may skip CAPTCHA via `optional_auth`).  Does NOT redirect
 * to /login on 401 — the caller is responsible for handling auth errors.
 *
 * Use for civilian report/append/photo endpoints where the backend supports
 * `optional_auth`.
 */
export async function fetchWithOptionalAuth<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = buildUrl(path);
  const headers = buildHeaders(options);
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });
  return parseResponse<T>(res);
}
