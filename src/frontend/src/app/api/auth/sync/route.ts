import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.API_SERVER_URL ||
  'http://backend:8000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, code_verifier, redirect_uri, access_token } = body;

    // Accept access_token from client-side signinCallback() flow
    if (access_token) {
      const response = NextResponse.json({ user_id: 'ok' });
      response.cookies.set('access_token', access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24, // 24h
      });
      return response;
    }

    if (!code || !code_verifier || !redirect_uri) {
      return NextResponse.json(
        { error: 'Missing code, code_verifier, redirect_uri, or access_token' },
        { status: 400 }
      );
    }

    const res = await fetch(`${BACKEND_URL}/api/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const response = NextResponse.json({ user_id: data.user_id });
    response.cookies.set('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24h
    });
    return response;
  } catch (err) {
    console.error('Auth sync error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
