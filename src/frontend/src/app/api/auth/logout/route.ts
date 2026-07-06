import { NextRequest, NextResponse } from 'next/server';

function clearCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 0,
  };
}

function isHttps(req: NextRequest): boolean {
  return req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
}

export async function POST(req: NextRequest) {
  const secure = isHttps(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('access_token', '', clearCookieOptions(secure));
  res.cookies.set('refresh_token', '', clearCookieOptions(secure));
  return res;
}
