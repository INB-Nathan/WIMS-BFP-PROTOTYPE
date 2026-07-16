/**
 * Transport error tests — tracer bullet for GH #386: Frontend Validation Foundation.
 *
 * Verifies that publicApiFetch / apiFetch throw typed ApiParseError instead of
 * silently swallowing malformed/non-JSON responses with `{}`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { publicApiFetch } from '../public-transport';
import { apiFetch, onResponseHeader } from '../transport';
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

  // ── Response header observer (Wayfinder #571) ─────────────────────────

  it('onResponseHeader observer receives response headers after fetch', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
    const responseHeaders = new Headers({
      'X-Device-Token-Hash': 'test-device-hash-123',
      'Content-Type': 'application/json',
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: responseHeaders,
      text: () => Promise.resolve(JSON.stringify({ data: 'ok' })),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const observer = vi.fn();
    const unsubscribe = onResponseHeader(observer);

    try {
      await apiFetch<{ data: string }>('/test', { skipAuthRedirect: true });

      expect(observer).toHaveBeenCalledTimes(1);
      const headers = observer.mock.calls[0][0] as Headers;
      expect(headers.get('X-Device-Token-Hash')).toBe('test-device-hash-123');
      expect(headers.get('Content-Type')).toBe('application/json');
    } finally {
      unsubscribe();
    }
  });

  it('calls all registered observers on each apiFetch call', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Device-Token-Hash': 'hash1' }),
      text: () => Promise.resolve('{}'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const obs1 = vi.fn();
    const obs2 = vi.fn();
    const unsub1 = onResponseHeader(obs1);
    const unsub2 = onResponseHeader(obs2);

    try {
      await apiFetch('/test', { skipAuthRedirect: true });
      expect(obs1).toHaveBeenCalledTimes(1);
      expect(obs2).toHaveBeenCalledTimes(1);
    } finally {
      unsub1();
      unsub2();
    }
  });

  it('observer does not break apiFetch when it throws', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Device-Token-Hash': 'hash2' }),
      text: () => Promise.resolve(JSON.stringify({ data: 'ok' })),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const badObs = vi.fn(() => { throw new Error('observer crashed'); });
    const goodObs = vi.fn();
    const unsubBad = onResponseHeader(badObs);
    const unsubGood = onResponseHeader(goodObs);

    try {
      const result = await apiFetch<{ data: string }>('/test', { skipAuthRedirect: true });
      // The bad observer should not prevent the good one from being called
      expect(goodObs).toHaveBeenCalledTimes(1);
      // The response should still be returned
      expect(result).toEqual({ data: 'ok' });
    } finally {
      unsubBad();
      unsubGood();
    }
  });

  it('unsubscribed observer is not called on subsequent requests', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({}),
      text: () => Promise.resolve('{}'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const obs = vi.fn();
    const unsubscribe = onResponseHeader(obs);

    // First call — observer should fire
    await apiFetch('/test1', { skipAuthRedirect: true });
    expect(obs).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    // Second call — observer should NOT fire
    await apiFetch('/test2', { skipAuthRedirect: true });
    expect(obs).toHaveBeenCalledTimes(1);
  });
});
