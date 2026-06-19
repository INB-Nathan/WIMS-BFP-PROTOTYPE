/**
 * Transport error tests — tracer bullet for GH #386: Frontend Validation Foundation.
 *
 * Verifies that publicApiFetch / apiFetch throw typed ApiParseError instead of
 * silently swallowing malformed/non-JSON responses with `{}`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { publicApiFetch } from '../public-transport';
import { apiFetch } from '../transport';
import { ApiParseError } from '@/lib/validation';
import { refreshToken } from '../../auth-refresh';

vi.mock('../../auth-refresh', () => ({
  refreshToken: vi.fn(),
}));

describe('publicApiFetch parse errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws ApiParseError on non-JSON response body (tracer bullet)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      text: () => Promise.resolve('<html>Internal Server Error</html>'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(publicApiFetch('/test')).rejects.toThrow(ApiParseError);
  });

  it('throws ApiParseError on syntactically invalid JSON body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"broken'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(publicApiFetch('/test')).rejects.toThrow(ApiParseError);
  });

  it('throws Error with status detail on HTTP error response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve(JSON.stringify({ detail: 'Bad data' })),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(publicApiFetch('/test')).rejects.toThrow(/Bad data|422/);
  });

  it('ApiParseError carries status, originalBody, and cause properties', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 502,
      text: () => Promise.resolve('<h1>502 Bad Gateway</h1>'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      await publicApiFetch('/test');
      expect.fail('Expected ApiParseError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiParseError);
      const parseErr = err as ApiParseError;
      expect(parseErr.status).toBe(502);
      expect(parseErr.originalBody).toBe('<h1>502 Bad Gateway</h1>');
      expect(parseErr.cause).toBeDefined();
    }
  });

  it('returns valid JSON on successful response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ data: 'hello' })),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await publicApiFetch<{ data: string }>('/test');
    expect(result).toEqual({ data: 'hello' });
  });
});

describe('apiFetch parse errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws ApiParseError on non-JSON response body (200 OK)', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve('<html>bad</html>'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(apiFetch('/test', { skipAuthRedirect: true })).rejects.toThrow(ApiParseError);
  });

  it('throws ApiRequestError on HTTP error with unparseable body', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(apiFetch('/test', { skipAuthRedirect: true })).rejects.toThrow(/500/);
  });

  it('sets application/json header for JSON body', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await apiFetch('/test', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
      skipAuthRedirect: true,
    });

    const [, options] = fetchSpy.mock.calls[0];
    const headers = new Headers(options?.headers as HeadersInit | undefined);
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
