import { API_BASE } from './transport';
import { ApiRequestError } from './errors';
import { ApiParseError } from '@/lib/validation';

export async function publicApiFetch<T>(
  path: string,
  options: RequestInit = {},
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
  const res = await fetch(url, {
    ...options,
    credentials: 'omit',
    headers,
  });

  // Read body as text first so we can throw a typed ApiParseError on malformed
  // JSON instead of silently swallowing the error with `{}`.
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
