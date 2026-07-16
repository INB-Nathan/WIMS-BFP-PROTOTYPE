/**
 * Unit tests for deviceTokenHash — header capture + localStorage persistence
 * (Wayfinder issue #571, criterion 3).
 *
 * Coverage:
 * 1. getStoredDeviceTokenHash reads the expected localStorage key
 * 2. setStoredDeviceTokenHash writes to the expected localStorage key
 * 3. Auto-registered transport observer captures X-Device-Token-Hash
 * 4. Observer does not call setItem when header is absent
 * 5. Observer does not break when headers are empty or malformed
 * 6. SSR safety: operations guarded when localStorage is unavailable
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock for transport ─────────────────────────────────────────────
// We mock transport so the module-level side-effect in deviceTokenHash.ts
// registers its observer against a test-controlled mock. The callback array
// is mutable and accessible by tests via getCallbacks().
//
// IMPORTANT: The module-level code runs only ONCE (on first module import).
// We must NOT clear the callbacks between tests — the observer registration
// is permanent. Different tests simply invoke the already-registered observer
// with different header scenarios.

const transportMock = vi.hoisted(() => {
  const callbacks: Array<(headers: Headers) => void> = [];
  const onResponseHeader = vi.fn((cb: (headers: Headers) => void) => {
    callbacks.push(cb);
    return () => {
      const idx = callbacks.indexOf(cb);
      if (idx >= 0) callbacks.splice(idx, 1);
    };
  });
  return {
    onResponseHeader,
    /** The registered observer callbacks (module-level side-effect pushes one). */
    getCallbacks: () => callbacks,
  };
});

vi.mock('../api/transport', () => ({
  onResponseHeader: transportMock.onResponseHeader,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function stubLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((idx: number) => Object.keys(store)[idx] ?? null),
  });
}

// ── Standalone storage tests ───────────────────────────────────────────────
// These test the get/set functions without relying on the observer.

describe('getStoredDeviceTokenHash / setStoredDeviceTokenHash', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when no value is stored', async () => {
    const { getStoredDeviceTokenHash } = await import('../deviceTokenHash');
    expect(getStoredDeviceTokenHash()).toBeNull();
  });

  it('stores and retrieves a token hash', async () => {
    const { getStoredDeviceTokenHash, setStoredDeviceTokenHash } = await import('../deviceTokenHash');
    setStoredDeviceTokenHash('abc123hash');
    expect(getStoredDeviceTokenHash()).toBe('abc123hash');
    expect(localStorage.setItem).toHaveBeenCalledWith('wims_device_token_hash', 'abc123hash');
    expect(localStorage.getItem).toHaveBeenCalledWith('wims_device_token_hash');
  });

  it('overwrites an existing stored hash', async () => {
    const { getStoredDeviceTokenHash, setStoredDeviceTokenHash } = await import('../deviceTokenHash');
    setStoredDeviceTokenHash('first');
    setStoredDeviceTokenHash('second');
    expect(getStoredDeviceTokenHash()).toBe('second');
  });

  it('gracefully handles localStorage.setItem throwing (quota/private browsing)', async () => {
    localStorage.setItem = vi.fn(() => { throw new Error('QuotaExceededError'); });
    const { setStoredDeviceTokenHash } = await import('../deviceTokenHash');
    expect(() => setStoredDeviceTokenHash('hash')).not.toThrow();
  });

  it('gracefully handles localStorage.getItem throwing', async () => {
    localStorage.getItem = vi.fn(() => { throw new Error('SecurityError'); });
    const { getStoredDeviceTokenHash } = await import('../deviceTokenHash');
    expect(getStoredDeviceTokenHash()).toBeNull();
  });

  it('returns null when localStorage is undefined (SSR)', async () => {
    vi.stubGlobal('localStorage', undefined);
    const { getStoredDeviceTokenHash } = await import('../deviceTokenHash');
    expect(getStoredDeviceTokenHash()).toBeNull();
  });
});

// ── Observer registration tests ────────────────────────────────────────────
// These test that deviceTokenHash.ts auto-registers a transport observer that
// captures X-Device-Token-Hash from response headers.

describe('deviceTokenHash auto-observer', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers a transport header observer on first import', async () => {
    // The module-level side-effect runs on first import (from the standalone
    // tests above). Verify the mock was called and a callback was registered.
    expect(transportMock.onResponseHeader).toHaveBeenCalled();
    expect(transportMock.getCallbacks().length).toBeGreaterThanOrEqual(1);
  });

  it('captures and persists X-Device-Token-Hash from response headers', async () => {
    const { getStoredDeviceTokenHash } = await import('../deviceTokenHash');

    // Invoke the already-registered observer with a response header
    const headers = new Headers({ 'X-Device-Token-Hash': 'my-device-hash-value' });
    transportMock.getCallbacks()[0](headers);

    expect(getStoredDeviceTokenHash()).toBe('my-device-hash-value');
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'wims_device_token_hash',
      'my-device-hash-value',
    );
  });

  it('does NOT persist when X-Device-Token-Hash header is absent', async () => {
    await import('../deviceTokenHash');

    const headers = new Headers({ 'Content-Type': 'application/json' });
    transportMock.getCallbacks()[0](headers);

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not break when headers are empty', async () => {
    await import('../deviceTokenHash');

    const headers = new Headers({});
    expect(() => transportMock.getCallbacks()[0](headers)).not.toThrow();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
