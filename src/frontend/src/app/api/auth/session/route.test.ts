/**
 * TDD: Session route maps backend role to frontend router.
 * When backend returns role: "SYSTEM_ADMIN", the session route must expose
 * role and assignedRegionId so the frontend router can redirect correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

describe('Session Route — SYSTEM_ADMIN role mapping', () => {
  const mockBackendResponse = {
    user_id: 'uuid-123',
    email: 'admin@bfp.gov.ph',
    username: 'system_admin',
    role: 'SYSTEM_ADMIN',
    assigned_region_id: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps role SYSTEM_ADMIN from backend so frontend router can see it', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockBackendResponse),
    });
    vi.stubGlobal('fetch', mockFetch);

    const req = new NextRequest('http://localhost/api/auth/session', {
      headers: { cookie: 'access_token=foo' },
    });

    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.role).toBe('SYSTEM_ADMIN');
    expect(data.assignedRegionId).toBeNull();
    expect(data.user).toBeDefined();
    expect(data.user.role).toBe('SYSTEM_ADMIN');
  });

  it('maps assignedRegionId when backend provides it', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ...mockBackendResponse,
          assigned_region_id: 4,
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const req = new NextRequest('http://localhost/api/auth/session');
    const res = await GET(req);
    const data = await res.json();

    expect(data.assignedRegionId).toBe(4);
    expect(data.user.assignedRegionId).toBe(4);
  });
});
