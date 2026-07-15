import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshToken, REFRESH_TIMEOUT_MS } from './auth-refresh';

describe('refreshToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies auth service failures as offline, not expired auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    await expect(refreshToken()).resolves.toEqual({ ok: false, reason: 'offline' });
  });

  it('classifies rejected refresh tokens as auth failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }));

    await expect(refreshToken()).resolves.toEqual({ ok: false, reason: 'auth' });
  });

  it('aborts a hanging refresh after REFRESH_TIMEOUT_MS and reports offline (issue #604)', async () => {
    vi.useFakeTimers();
    // A fetch that never resolves until its AbortSignal fires, then rejects
    // with AbortError — mirroring the browser's own abort behavior.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
    ));

    const promise = refreshToken();
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 100);
    await expect(promise).resolves.toEqual({ ok: false, reason: 'offline' });
    vi.useRealTimers();
  });
});
