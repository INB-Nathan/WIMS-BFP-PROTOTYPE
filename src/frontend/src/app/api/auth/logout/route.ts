import { NextResponse } from 'next/server';

const COOKIE_CLEAR = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 0,
};

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('__Host-access_token', '', COOKIE_CLEAR);
  res.cookies.set('__Host-refresh_token', '', COOKIE_CLEAR);
  return res;
}
