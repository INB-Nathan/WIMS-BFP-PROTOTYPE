import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  // Fall back to localhost via nginx — this ensures the browser's localhost cookies
  // (domain=localhost, port=80 from nginx) are forwarded.  Using the Docker
  // internal host (backend:8000) bypasses the browser cookie jar and always fails.
  (process.env.NEXT_PUBLIC_BASE_URL?.replace(/:\d+$/, '') + '/api');

export async function GET(req: NextRequest) {
  try {
    // Forward the browser's access_token cookie to the backend.
    // Without this the backend sees an unauthenticated request and returns 401,
    // causing the login loop on every page load.
    const cookieHeader = req.headers.get('cookie') || '';
    const res = await fetch(`${BACKEND_URL}/api/user/me`, {
      headers: {
        cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return NextResponse.json({ user: null }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({
      user: {
        id: data.user_id,
        email: data.email,
        username: data.username,
        role: data.role,
        preferred_username: data.username,
        assignedRegionId: data.assigned_region_id ?? null,
      },
      role: data.role,
      assignedRegionId: data.assigned_region_id ?? null,
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
