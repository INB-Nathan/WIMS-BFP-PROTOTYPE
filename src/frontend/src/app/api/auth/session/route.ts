import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  try {
    const cookieHeader = req.headers.get('cookie') || '';
    const res = await fetch(`${BACKEND_URL}/api/user/me`, {
      headers: {
        cookie: cookieHeader,
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
