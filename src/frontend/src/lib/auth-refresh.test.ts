import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshToken } from './auth-refresh';

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
});
