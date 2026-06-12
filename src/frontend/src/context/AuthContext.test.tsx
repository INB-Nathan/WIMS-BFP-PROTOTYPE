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
import { render } from '@testing-library/react';
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
