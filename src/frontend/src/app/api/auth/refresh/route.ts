import { NextRequest, NextResponse } from 'next/server';

const KEYCLOAK_TOKEN_URL = process.env.NEXT_PUBLIC_AUTH_API_URL
  ? `${process.env.NEXT_PUBLIC_AUTH_API_URL}/realms/bfp/protocol/openid-connect/token`
  : null;

const CLIENT_ID = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'wims-web';
const IS_PROD = process.env.NODE_ENV === 'production';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh_token')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  if (!KEYCLOAK_TOKEN_URL) {
    return NextResponse.json({ error: 'Auth URL not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(KEYCLOAK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!res.ok) {
      const response = NextResponse.json({ error: 'Refresh failed' }, { status: 401 });
      response.cookies.set('access_token', '', { maxAge: 0, path: '/' });
      response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' });
      return response;
    }

    const data = await res.json();
    const response = NextResponse.json({ ok: true });
    response.cookies.set('access_token', data.access_token, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
    if (data.refresh_token) {
      response.cookies.set('refresh_token', data.refresh_token, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
