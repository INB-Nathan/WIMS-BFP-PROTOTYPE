/**
 * Authenticated API transport for cookie-based WIMS backend requests.
 */
import { refreshToken } from '../auth-refresh';

export const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '/api')
  : process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api';

export class ApiRequestError extends Error {
  status: number;
  detail?: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
  }
}

export function errorMessageFromJson(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const asObj = json as { message?: unknown; detail?: unknown };
  if (typeof asObj.message === 'string' && asObj.message.trim()) {
    return asObj.message;
  }
  if (typeof asObj.detail === 'string' && asObj.detail.trim()) {
    return asObj.detail;
  }
  if (asObj.detail && typeof asObj.detail === 'object') {
    if (Array.isArray(asObj.detail)) {
      const first = asObj.detail[0] as { msg?: unknown; loc?: unknown } | undefined;
      if (first) {
        const msg = typeof first.msg === 'string' ? first.msg : 'Validation failed';
        const loc = Array.isArray(first.loc) ? first.loc.join('.') : '';
        return loc ? `${loc}: ${msg}` : msg;
      }
      return 'Validation failed';
    }
    const detailObj = asObj.detail as { message?: unknown; code?: unknown };
    if (typeof detailObj.message === 'string' && detailObj.message.trim()) {
      return detailObj.message;
    }
    if (typeof detailObj.code === 'string' && detailObj.code.trim()) {
      return detailObj.code;
    }
  }
  return fallback;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { _retried?: boolean; skipAuthRedirect?: boolean } = {}
): Promise<T> {
  const normalizedPath =
    path === '/api' ? '/' : path.startsWith('/api/') ? path.slice(4) : path;
  const url = normalizedPath.startsWith('http')
    ? normalizedPath
    : `${API_BASE.replace(/\/$/, '')}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
  const headers = new Headers(options.headers ?? {});
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const { _retried, skipAuthRedirect, ...fetchOptions } = options;
  const res = await fetch(url, {
    ...fetchOptions,
    credentials: 'include',
    headers,
  });
  if (res.status === 401 && !_retried) {
    try {
      const refreshed = await refreshToken();
      if (refreshed.ok) {
        return apiFetch<T>(path, { ...options, _retried: true });
      }
    } catch { /* ignore, fall through to throw */ }
    if (!skipAuthRedirect && typeof window !== 'undefined') {
      sessionStorage.setItem('wims:redirect_after_login', window.location.href);
      window.location.href = '/login';
    }
    throw new ApiRequestError('Session expired. Please log in again.', 401);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(
      errorMessageFromJson(json, `Request failed: ${res.status}`),
      res.status,
      (json as { detail?: unknown }).detail,
    );
  }
  return json as T;
}
