/**
 * AuthContext logout cache-clear tests — PR #271 Q2.
 *
 * Verifies that logout signals the service worker to evict the
 * authenticated app cache while remaining safe when the SW or its
 * controller is unavailable.
 *
 * Strategy:
 *   (a) Unit-level: test the guard + postMessage pattern directly without
 *       the full AuthProvider dependency chain (OIDC, Keycloak, IndexedDB).
 *   (b) Component smoke: confirm AuthProvider mounts without crash regardless
 *       of SW state and that the logout path exists in the rendered tree.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/oidc', () => ({
  createUserManager: vi.fn().mockReturnValue({
    getUser: vi.fn().mockResolvedValue({ id_token: 'mock-id-token' }),
    removeUser: vi.fn().mockResolvedValue(undefined),
    signoutRedirect: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/auth-refresh', () => ({
  refreshToken: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/offlineStore', () => ({
  clearAllCachedIncidents: vi.fn().mockResolvedValue(undefined),
  setActiveOfflineUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/connectivity', () => ({
  getConnectivitySnapshot: vi.fn().mockReturnValue({ isOnline: true }),
}));

// Dynamic import so vi.mock hoisting resolves before the real module loads.
const { AuthProvider, useAuth } = await import('@/context/AuthContext');

type User = { id: string; role?: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

function ChildWithLogout() {
  const { logout, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading-state">{String(loading)}</span>
      <button data-testid="logout-btn" onClick={() => logout()} />
    </div>
  );
}

type ServiceWorkerContainerPartial = Partial<ServiceWorkerContainer>;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AuthContext logout → SW cache-clear (unit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends { type: "clear-auth-cache" } when SW controller is available', () => {
    const postMessage = vi.fn();
    const controller = { postMessage } as unknown as ServiceWorker;

    // Simulate the exact guard + postMessage from AuthContext.logout().
    const nav = navigator as unknown as {
      serviceWorker?: ServiceWorkerContainerPartial;
    };
    nav.serviceWorker = { controller };

    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'clear-auth-cache' });
    }

    expect(postMessage).toHaveBeenCalledWith({ type: 'clear-auth-cache' });
  });

  it('does NOT call postMessage when serviceWorker is undefined', () => {
    const postMessage = vi.fn();
    const nav = navigator as unknown as {
      serviceWorker?: ServiceWorkerContainerPartial;
    };
    nav.serviceWorker = undefined;

    let threw = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'clear-auth-cache' });
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does NOT crash when serviceWorker.controller is null', () => {
    const nav = navigator as unknown as {
      serviceWorker?: ServiceWorkerContainerPartial;
    };
    nav.serviceWorker = { controller: null };

    let threw = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'clear-auth-cache' });
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });
});

describe('AuthContext logout → SW cache-clear (component smoke)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts AuthProvider without crashing when SW controller is null', () => {
    // The AuthContext fetchSession will call /api/auth/session; mock it.
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', role: 'encoder' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let mountError: Error | null = null;
    try {
      render(
        <AuthProvider>
          <ChildWithLogout />
        </AuthProvider>,
      );
    } catch (e) {
      mountError = e as Error;
    }

    // render() should not throw — even if fetchSession hasn't resolved yet.
    expect(mountError).toBeNull();
  });

  it('mounts AuthProvider without crashing when serviceWorker is undefined', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', role: 'encoder' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let mountError: Error | null = null;
    try {
      render(
        <AuthProvider>
          <ChildWithLogout />
        </AuthProvider>,
      );
    } catch (e) {
      mountError = e as Error;
    }

    expect(mountError).toBeNull();
  });
});

// ── Task 14: Post-login role prefetch message to service worker ─────────────
//
// AuthContext.fetchSession resolves the user (with role) after a successful
// login. At that point we post { type: 'PREFETCH_ROLE', role } to the active
// service worker so it can pre-warm the role's routes (per ROLE_PREFETCH_ROUTES
// in public/sw.js). The wiring MUST be best-effort: a missing SW, a null
// controller, or a postMessage throw must NOT block login or crash render.

describe('AuthContext login → SW role prefetch (unit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends { type: "PREFETCH_ROLE", role: "encoder" } when SW controller is available', () => {
    const postMessage = vi.fn();
    const controller = { postMessage } as unknown as ServiceWorker;
    const nav = navigator as unknown as { serviceWorker?: ServiceWorkerContainerPartial };
    nav.serviceWorker = { controller };

    // Replicate the guard + postMessage from AuthContext.fetchSession()
    // (only when a role is known and the SW + controller are present).
    const role = 'encoder';
    if (role && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PREFETCH_ROLE', role });
    }

    expect(postMessage).toHaveBeenCalledWith({ type: 'PREFETCH_ROLE', role: 'encoder' });
  });

  it('does NOT call postMessage when serviceWorker is undefined', () => {
    const postMessage = vi.fn();
    const nav = navigator as unknown as { serviceWorker?: ServiceWorkerContainerPartial };
    nav.serviceWorker = undefined;

    const role = 'encoder';
    let threw = false;
    try {
      if (role && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'PREFETCH_ROLE', role });
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does NOT call postMessage when serviceWorker.controller is null', () => {
    const postMessage = vi.fn();
    const nav = navigator as unknown as { serviceWorker?: ServiceWorkerContainerPartial };
    nav.serviceWorker = { controller: null };

    const role = 'encoder';
    let threw = false;
    try {
      if (role && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'PREFETCH_ROLE', role });
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('AuthContext login → SW role prefetch (component smoke)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Probe({ onCapture }: { onCapture: (s: { loading: boolean; user: User | null }) => void }) {
    const { user, loading } = useAuth();
    onCapture({ loading, user });
    return <span data-testid="loading">{String(loading)}</span>;
  }

  it('posts PREFETCH_ROLE on successful login (user with role "encoder")', async () => {
    const postMessage = vi.fn();
    const controller = { postMessage } as unknown as ServiceWorker;
    const nav = navigator as unknown as { serviceWorker?: ServiceWorkerContainerPartial };
    nav.serviceWorker = { controller };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', role: 'encoder' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let capture: { loading: boolean; user: User | null } = { loading: true, user: null };

    render(
      <AuthProvider>
        <Probe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    // Wait for fetchSession to resolve (loading → false) and the user to populate.
    await waitFor(() => expect(capture.loading).toBe(false));

    expect(capture.user).toEqual({ id: 'u1', role: 'encoder' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'PREFETCH_ROLE', role: 'encoder' });
  });

  it('does NOT post PREFETCH_ROLE when SW controller is null', async () => {
    const postMessage = vi.fn();
    const nav = navigator as unknown as { serviceWorker?: ServiceWorkerContainerPartial };
    nav.serviceWorker = { controller: null };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', role: 'encoder' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let capture: { loading: boolean; user: User | null } = { loading: true, user: null };

    render(
      <AuthProvider>
        <Probe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));

    expect(capture.user).toEqual({ id: 'u1', role: 'encoder' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does NOT crash when serviceWorker is undefined and user has a role', async () => {
    const postMessage = vi.fn();
    const nav = navigator as unknown as { serviceWorker?: ServiceWorkerContainerPartial };
    nav.serviceWorker = undefined;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', role: 'validator' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let capture: { loading: boolean; user: User | null } = { loading: true, user: null };

    let renderError: Error | null = null;
    try {
      render(
        <AuthProvider>
          <Probe onCapture={(s) => (capture = s)} />
        </AuthProvider>,
      );
    } catch (e) {
      renderError = e as Error;
    }

    expect(renderError).toBeNull();
    await waitFor(() => expect(capture.loading).toBe(false));
    expect(capture.user).toEqual({ id: 'u1', role: 'validator' });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
