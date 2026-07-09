import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.API_SERVER_URL ||
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/:\d+$/, '') ||
  'http://localhost';

function backendUrl(path: string): string {
  return `${BACKEND_URL.replace(/\/$/, '')}${path}`;
}

function trustedClientIp(req: NextRequest): string | null {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = req.headers.get('x-forwarded-for');
  if (!forwardedFor) {
    return null;
  }

  // Nginx appends the immediate remote address to X-Forwarded-For. Forward only
  // that trusted hop instead of relaying a client-supplied chain that the
  // backend rate limiter would treat as authoritative.
  return forwardedFor.split(',').pop()?.trim() || null;
}

const ACCESS_TOKEN_COOKIE_MAX_AGE = 24 * 60 * 60; // 24h: cookie stores the token; Keycloak enforces actual expiry
const REFRESH_TOKEN_COOKIE_MAX_AGE = 24 * 60 * 60; // 24h: same as access token cookie

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: '/',
  };
}

function isHttps(req: NextRequest): boolean {
  return req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, code_verifier, redirect_uri, access_token } = body;

    // Accept access_token from client-side signinCallback() flow
    if (access_token) {
      const secure = isHttps(req);
      const response = NextResponse.json({ user_id: 'ok' });
      response.cookies.set('access_token', access_token, {
        ...cookieOptions(secure),
        maxAge: ACCESS_TOKEN_COOKIE_MAX_AGE,
      });
      const { refresh_token: refreshToken } = body as { refresh_token?: string };
      if (refreshToken) {
        response.cookies.set('refresh_token', refreshToken, {
          ...cookieOptions(secure),
          maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
        });
      }
      return response;
    }

    if (!code || !code_verifier || !redirect_uri) {
      return NextResponse.json(
        { error: 'Missing code, code_verifier, redirect_uri, or access_token' },
        { status: 400 }
      );
    }

    const callbackHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const clientIp = trustedClientIp(req);
    if (clientIp) {
      callbackHeaders['X-Real-IP'] = clientIp;
      callbackHeaders['X-Forwarded-For'] = clientIp;
    }

    const res = await fetch(backendUrl('/api/auth/callback'), {
      method: 'POST',
      headers: callbackHeaders,
      body: JSON.stringify({ code, code_verifier, redirect_uri }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.detail || 'Token exchange failed' },
        { status: res.status }
      );
    }

    const data = await res.json();
    const token = data.access_token;

    if (!token) {
      return NextResponse.json(
        { error: 'No access token in response' },
        { status: 500 }
      );
    }

    const secure = isHttps(req);
    const response = NextResponse.json({ user_id: data.user_id });
    response.cookies.set('access_token', token, {
      ...cookieOptions(secure),
      maxAge: ACCESS_TOKEN_COOKIE_MAX_AGE,
    });
    if (data.refresh_token) {
      response.cookies.set('refresh_token', data.refresh_token, {
        ...cookieOptions(secure),
        maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
      });
    }
    return response;
  } catch (err) {
    console.error('Auth sync error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
