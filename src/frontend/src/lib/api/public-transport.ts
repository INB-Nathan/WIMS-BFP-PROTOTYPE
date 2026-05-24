import { API_BASE } from './transport';

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
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { message?: string; detail?: string }).message ?? (json as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return json as T;
}
