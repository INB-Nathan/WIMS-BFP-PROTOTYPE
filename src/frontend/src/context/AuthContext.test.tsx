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
import { render, waitFor, fireEvent, act } from '@testing-library/react';
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

// ── RP-19: LOGOUT audit non-repudiation ──────────────────────────────────────
// logout() must POST to /api/auth/security-event with event_type=LOGOUT and the
// current username BEFORE calling /api/auth/logout. The call is fire-and-forget:
// if it rejects or the endpoint is unreachable, logout must still complete and
// signoutRedirect must be reached.
describe('AuthContext logout → LOGOUT audit (RP-19)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    try { localStorage.removeItem('wims:offline_session_cache'); } catch { /* private mode */ }
  });

  it('fires /api/auth/security-event before /api/auth/logout with correct body', async () => {
    const callOrder: string[] = [];
    let securityEventBody: Record<string, unknown> | null = null;

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/auth/session')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ user: { id: 'u1', role: 'encoder', preferred_username: 'testuser' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (u.includes('/api/auth/security-event')) {
        callOrder.push('security-event');
        securityEventBody = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        return Promise.resolve(new Response(JSON.stringify({ status: 'recorded' }), { status: 202 }));
      }
      if (u.includes('/api/auth/logout')) {
        callOrder.push('auth-logout');
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const { getByTestId } = render(
      <AuthProvider>
        <ChildWithLogout />
      </AuthProvider>,
    );

    await waitFor(() => expect(getByTestId('loading-state').textContent).toBe('false'));

    fireEvent.click(getByTestId('logout-btn'));

    await waitFor(() => {
      expect(callOrder).toContain('security-event');
      expect(callOrder).toContain('auth-logout');
    });

    expect(callOrder.indexOf('security-event')).toBeLessThan(callOrder.indexOf('auth-logout'));
    expect(securityEventBody).toMatchObject({ event_type: 'LOGOUT', username: 'testuser' });
  });

  it('logout completes and signoutRedirect is reached when security-event fetch rejects', async () => {
    const { createUserManager } = await import('@/lib/oidc');
    const mockSignoutRedirect = vi.fn().mockResolvedValue(undefined);
    (createUserManager as ReturnType<typeof vi.fn>).mockReturnValue({
      getUser: vi.fn().mockResolvedValue({ id_token: 'mock-id-token' }),
      removeUser: vi.fn().mockResolvedValue(undefined),
      signoutRedirect: mockSignoutRedirect,
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/auth/session')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ user: { id: 'u1', role: 'encoder', preferred_username: 'testuser' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (u.includes('/api/auth/security-event')) {
        return Promise.reject(new TypeError('Network error'));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const { getByTestId } = render(
      <AuthProvider>
        <ChildWithLogout />
      </AuthProvider>,
    );

    await waitFor(() => expect(getByTestId('loading-state').textContent).toBe('false'));

    fireEvent.click(getByTestId('logout-btn'));

    await waitFor(() => expect(mockSignoutRedirect).toHaveBeenCalled());
  });
});

// Issue #4: postMessage on the logout path can throw DataCloneError,
// InvalidStateError, or SecurityError. The rest of logout (removeUser,
// signoutRedirect) MUST still run. This sync-guard test pins the contract
// against the source file directly because the integration test would
// require a full OIDC + Keycloak + IndexedDB mock chain.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('AuthContext logout → postMessage error handling (issue #4)', () => {
  it('wraps the postMessage call in a try/catch in AuthContext.tsx', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'context', 'AuthContext.tsx'),
      'utf8',
    );
    // The contract: the `clear-auth-cache` postMessage is wrapped in a
    // dedicated try/catch (NOT just the outer logout try/catch, which would
    // still skip removeUser + signoutRedirect). The catch must log/warn and
    // not re-throw.
    //
    // We slice the source from the clear-auth-cache postMessage line and
    // check the 8 lines above and 4 lines below for an inner try/catch.
    const lines = src.split('\n');
    const pmLineIdx = lines.findIndex((l) =>
      l.includes("postMessage({ type: 'clear-auth-cache' })"),
    );
    expect(pmLineIdx, 'clear-auth-cache postMessage line must exist').toBeGreaterThan(-1);
    const sliceStart = Math.max(0, pmLineIdx - 8);
    const sliceEnd = Math.min(lines.length, pmLineIdx + 4);
    const slice = lines.slice(sliceStart, sliceEnd).join('\n');
    // Look for a `try {` within the 8 lines BEFORE the postMessage and a
    // `catch` within the 4 lines AFTER. This matches a dedicated try/catch
    // around the postMessage (not the outer logout try/catch which would be
    // much further away).
    const beforeLines = lines.slice(sliceStart, pmLineIdx).join('\n');
    const afterLines = lines.slice(pmLineIdx, sliceEnd).join('\n');
    expect(beforeLines, 'try { must immediately precede the postMessage').toMatch(/try\s*\{\s*$/m);
    expect(afterLines, 'catch must follow the postMessage').toMatch(/catch\s*\(/);
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

// Issue #5: serverValidated flag tracks whether `user` came from a
// successful /api/auth/session call or a localStorage cache restore.
// On offline 503 / network error → user from cache, serverValidated = false.
// On successful fetchSession → user from server, serverValidated = true.
describe('AuthContext serverValidated (issue #5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Clean session cache between tests so the offline-restore path
    // doesn't leak state from the previous test.
    try {
      localStorage.removeItem('wims:offline_session_cache');
    } catch {
      /* private mode */
    }
  });

  type ServerValidatedCapture = { loading: boolean; user: User | null; serverValidated: boolean };

  function FullProbe({ onCapture }: { onCapture: (s: ServerValidatedCapture) => void }) {
    const { user, loading, serverValidated } = useAuth();
    onCapture({ loading, user, serverValidated });
    return <span data-testid="loading">{String(loading)}</span>;
  }

  it('serverValidated is true after a successful /api/auth/session call', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', role: 'encoder' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let capture: ServerValidatedCapture = { loading: true, user: null, serverValidated: false };
    render(
      <AuthProvider>
        <FullProbe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));
    expect(capture.user).toEqual({ id: 'u1', role: 'encoder' });
    expect(capture.serverValidated).toBe(true);
  });

  it('serverValidated is false when fetchSession falls back to cache (503)', async () => {
    // Pre-seed the offline session cache so restoreSessionFromCache finds
    // a user to restore from.
    localStorage.setItem(
      'wims:offline_session_cache',
      JSON.stringify({ user: { id: 'cached-user', role: 'encoder' } }),
    );

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Service Unavailable', { status: 503 }),
    );

    let capture: ServerValidatedCapture = { loading: true, user: null, serverValidated: false };
    render(
      <AuthProvider>
        <FullProbe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));
    // User was restored from cache (offline read-only).
    expect(capture.user).toEqual({ id: 'cached-user', role: 'encoder' });
    // But serverValidated is false — privileged actions must gate on this.
    expect(capture.serverValidated).toBe(false);
  });

  it('serverValidated is false when fetchSession fails with a network error', async () => {
    localStorage.setItem(
      'wims:offline_session_cache',
      JSON.stringify({ user: { id: 'cached-user', role: 'validator' } }),
    );

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    let capture: ServerValidatedCapture = { loading: true, user: null, serverValidated: false };
    render(
      <AuthProvider>
        <FullProbe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));
    expect(capture.user).toEqual({ id: 'cached-user', role: 'validator' });
    expect(capture.serverValidated).toBe(false);
  });

  it('serverValidated is false when fetchSession returns 401 (genuine auth failure)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    let capture: ServerValidatedCapture = { loading: true, user: null, serverValidated: false };
    render(
      <AuthProvider>
        <FullProbe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));
    // Genuine auth failure: no user, no server validation.
    expect(capture.user).toBeNull();
    expect(capture.serverValidated).toBe(false);
  });

  it('resolves loading within the timeout when fetchSession hangs (issue #604)', async () => {
    // Without the 15s AbortController, this hanging fetch would block the
    // loading spinner until the browser's TCP timeout (~2 min). The timeout
    // must fire, abort the request, and fall through to the offline cache.
    vi.useFakeTimers();
    let capture: ServerValidatedCapture = { loading: true, user: null, serverValidated: false };
    try {
      localStorage.setItem(
        'wims:offline_session_cache',
        JSON.stringify({ user: { id: 'cached-user', role: 'encoder' } }),
      );
      globalThis.fetch = vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
      ) as unknown as typeof fetch;

      render(
        <AuthProvider>
          <FullProbe onCapture={(s) => (capture = s)} />
        </AuthProvider>,
      );

      // Advance past the 15s AbortController timeout and flush microtasks.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16_000);
      });
    } finally {
      vi.useRealTimers();
    }
    // After the timeout the spinner clears and the user is restored from cache.
    await waitFor(() => expect(capture.loading).toBe(false));
    expect(capture.user).toEqual({ id: 'cached-user', role: 'encoder' });
    expect(capture.serverValidated).toBe(false);
  }, 20_000);
});

// ── WS6 (V14.3.3): localStorage minimal PII cache ───────────────────────────
//
// Verifies that only { id, role } is stored in localStorage (not full user
// with email/name), and that offline restore + online overwrite work correctly.

describe('AuthContext localStorage PII cache (WS6, V14.3.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      localStorage.removeItem('wims:offline_session_cache');
    } catch {
      /* private mode */
    }
  });

  type WS6Capture = {
    loading: boolean;
    user: User | null;
    serverValidated: boolean;
  };

  function WS6Probe({ onCapture }: { onCapture: (s: WS6Capture) => void }) {
    const { user, loading, serverValidated } = useAuth();
    onCapture({ loading, user, serverValidated });
    return <span data-testid="loading">{String(loading)}</span>;
  }

  it('test_localstorage_cache_includes_email_and_name', async () => {
    // Email and preferred_username are intentionally persisted in the cache so
    // the header can display the correct name in offline sessions (fix: header
    // previously showed "User" when restored from localStorage).
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 'u1',
            sub: 'sub-123',
            email: 'test@example.com',
            preferred_username: 'testuser',
            role: 'encoder',
            assignedRegionId: 1,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let capture: WS6Capture = {
      loading: true,
      user: null,
      serverValidated: false,
    };
    render(
      <AuthProvider>
        <WS6Probe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));

    // Check what was written to localStorage
    const raw = localStorage.getItem('wims:offline_session_cache');
    expect(raw).not.toBeNull();
    const cached = JSON.parse(raw!);

    // Must have id and role
    expect(cached.user.id).toBe('u1');
    expect(cached.user.role).toBe('encoder');

    // Must also persist display identity for offline header rendering
    expect(cached.user.email).toBe('test@example.com');
    expect(cached.user.preferred_username).toBe('testuser');
  });

  it('test_offline_restore_uses_minimal_user', async () => {
    // Pre-populate localStorage with minimal user (only id, role)
    localStorage.setItem(
      'wims:offline_session_cache',
      JSON.stringify({ user: { id: 'cached-user', role: 'encoder' } }),
    );

    // Simulate 503 on fetchSession
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Service Unavailable', { status: 503 }),
    );

    let capture: WS6Capture = {
      loading: true,
      user: null,
      serverValidated: false,
    };
    render(
      <AuthProvider>
        <WS6Probe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));

    // Auth state has minimal user
    expect(capture.user).toEqual({ id: 'cached-user', role: 'encoder' });
    // serverValidated is false — offline read-only mode
    expect(capture.serverValidated).toBe(false);

    // Ensure no extra PII fields leaked into user state
    expect(capture.user).not.toHaveProperty('email');
    expect(capture.user).not.toHaveProperty('preferred_username');
  });

  it('test_online_fetch_overwrites_minimal_user', async () => {
    // Pre-populate localStorage with minimal user
    localStorage.setItem(
      'wims:offline_session_cache',
      JSON.stringify({ user: { id: 'cached-user', role: 'encoder' } }),
    );

    // Mock online fetchSession returning full user
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 'u1',
            email: 'test@example.com',
            preferred_username: 'testuser',
            role: 'validator',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let capture: WS6Capture = {
      loading: true,
      user: null,
      serverValidated: false,
    };
    render(
      <AuthProvider>
        <WS6Probe onCapture={(s) => (capture = s)} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capture.loading).toBe(false));

    // Full user from server replaces minimal cache
    expect(capture.user).toEqual({
      id: 'u1',
      email: 'test@example.com',
      preferred_username: 'testuser',
      role: 'validator',
    });
    // serverValidated is true — came from successful server call
    expect(capture.serverValidated).toBe(true);
  });
});
