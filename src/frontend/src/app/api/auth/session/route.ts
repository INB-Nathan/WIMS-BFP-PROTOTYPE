import { NextRequest, NextResponse } from 'next/server';

const BACKEND_ORIGIN =
  process.env.BACKEND_URL ||
  // Fall back to localhost via nginx. Keep this as an origin, not an /api base,
  // because callers append backend route paths explicitly.
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/:\d+$/, '') ||
  'http://localhost';

function backendUrl(path: string): string {
  return `${BACKEND_ORIGIN.replace(/\/$/, '')}${path}`;
}

export async function GET(req: NextRequest) {
  try {
    // Forward the browser's access_token cookie to the backend.
    // Without this the backend sees an unauthenticated request and returns 401,
    // causing the login loop on every page load.
    const cookieHeader = req.headers.get('cookie') || '';
    const backendRes = await fetch(backendUrl('/api/user/me'), {
      headers: {
        cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!backendRes.ok) {
      return NextResponse.json({ user: null }, { status: backendRes.status });
    }

    const data = await backendRes.json();
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
  } catch (err) {
    console.error('[api/auth/session] backend session fetch failed:', err);
    // Return 503 (not 500) to let the client distinguish "backend unreachable"
    // from a genuine auth failure, so it can restore the offline session cache.
    return NextResponse.json({ user: null, reason: 'network_error' }, { status: 503 });
  }
}
