import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getKeycloakTokenUrl, POST } from './route';

describe('auth refresh route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.AUTH_SERVER_URL;
    delete process.env.KEYCLOAK_INTERNAL_URL;
    delete process.env.NEXT_PUBLIC_AUTH_INTERNAL_URL;
    delete process.env.NEXT_PUBLIC_AUTH_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses the server-side Keycloak URL instead of browser-relative /auth', () => {
    process.env.AUTH_SERVER_URL = 'http://keycloak:8080/auth/';
    process.env.NEXT_PUBLIC_AUTH_API_URL = '/auth';

    expect(getKeycloakTokenUrl()).toBe(
      'http://keycloak:8080/auth/realms/bfp/protocol/openid-connect/token'
    );
  });

  it('does not build a server fetch URL from a relative public auth URL', () => {
    process.env.NEXT_PUBLIC_AUTH_API_URL = '/auth';

    expect(getKeycloakTokenUrl()).toBeNull();
  });

  it('returns 503 without clearing cookies when the auth service is unavailable', async () => {
    process.env.AUTH_SERVER_URL = 'http://keycloak:8080/auth';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    }));

    const req = new NextRequest('http://localhost/api/auth/refresh', {
      headers: { cookie: 'refresh_token=refresh-token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('clears cookies only when Keycloak rejects the refresh token', async () => {
    process.env.AUTH_SERVER_URL = 'http://keycloak:8080/auth';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({}),
    }));

    const req = new NextRequest('http://localhost/api/auth/refresh', {
      headers: { cookie: 'refresh_token=refresh-token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toContain('access_token=');
  });
});
