import { NextRequest, NextResponse } from 'next/server';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getKeycloakTokenUrl(): string | null {
  const serverAuthUrl =
    process.env.AUTH_SERVER_URL ||
    process.env.KEYCLOAK_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_AUTH_INTERNAL_URL;

  if (serverAuthUrl) {
    return `${trimTrailingSlash(serverAuthUrl)}/realms/bfp/protocol/openid-connect/token`;
  }

  const publicAuthUrl = process.env.NEXT_PUBLIC_AUTH_API_URL;
  if (!publicAuthUrl || publicAuthUrl.startsWith('/')) return null;
  return `${trimTrailingSlash(publicAuthUrl)}/realms/bfp/protocol/openid-connect/token`;
}

const CLIENT_ID = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'wims-web';
const ACCESS_TOKEN_COOKIE_MAX_AGE = 24 * 60 * 60; // 24h: cookie stores the token; Keycloak enforces actual expiry
const REFRESH_TOKEN_COOKIE_MAX_AGE = 24 * 60 * 60; // 24h: same as access token cookie

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
};

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('__Host-refresh_token')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const keycloakTokenUrl = getKeycloakTokenUrl();
  if (!keycloakTokenUrl) {
    return NextResponse.json(
      { error: 'Auth URL not configured for server-side refresh' },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(keycloakTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) {
        return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
      }

      const response = NextResponse.json({ error: 'Refresh token invalid or expired' }, { status: 401 });
      response.cookies.set('__Host-access_token', '', { ...COOKIE_OPTIONS, maxAge: 0 });
      response.cookies.set('__Host-refresh_token', '', { ...COOKIE_OPTIONS, maxAge: 0 });
      return response;
    }

    const data = await res.json();
    const response = NextResponse.json({ ok: true });
    response.cookies.set('__Host-access_token', data.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_COOKIE_MAX_AGE,
    });
    if (data.refresh_token) {
      response.cookies.set('__Host-refresh_token', data.refresh_token, {
        ...COOKIE_OPTIONS,
        maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
  }
}
