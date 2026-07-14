import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { GeolocationProvider, PH_CENTER, STALE_GPS_MS } from '@/components/GeolocationProvider';
import { useGeolocation } from './useGeolocation';

type SuccessCb = (pos: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void;
type ErrorCb = (err: { code: number; message?: string }) => void;

function setGeolocation(mockImpl: (success: SuccessCb, error: ErrorCb, opts?: unknown) => void) {
  const getCurrentPosition = vi.fn(mockImpl);
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

// Renders the live context values as data-testid nodes so assertions read the
// DOM instead of mutating variables defined outside the component.
function Harness() {
  const ctx = useGeolocation();
  useEffect(() => {
    ctx.requestGeolocation();
  }, [ctx]);
  return (
    <div>
      <span data-testid="status">{ctx.status}</span>
      <span data-testid="source">{String(ctx.source)}</span>
      <span data-testid="lat">{String(ctx.latitude)}</span>
      <span data-testid="lng">{String(ctx.longitude)}</span>
      <span data-testid="acc">{String(ctx.accuracy)}</span>
    </div>
  );
}

function text(id: string): string {
  return screen.getByTestId(id).textContent ?? '';
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useGeolocation / GeolocationProvider', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken() {
      useGeolocation();
      return null;
    }
    expect(() => render(<Broken />)).toThrow(/GeolocationProvider/);
    spy.mockRestore();
  });

  it('sets a granted gps position on success', () => {
    const getCurrentPosition = setGeolocation((success) =>
      success({ coords: { latitude: 14.6, longitude: 120.98, accuracy: 12 } }),
    );
    render(
      <GeolocationProvider>
        <Harness />
      </GeolocationProvider>,
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(text('status')).toBe('granted');
    expect(text('source')).toBe('gps');
    expect(text('lat')).toBe('14.6');
    expect(text('lng')).toBe('120.98');
    expect(text('acc')).toBe('12');
  });

  it('falls back to the PH center on permission denied', () => {
    const getCurrentPosition = setGeolocation((_success, error) =>
      error({ code: 1, message: 'denied' }),
    );
    render(
      <GeolocationProvider>
        <Harness />
      </GeolocationProvider>,
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(text('status')).toBe('denied');
    expect(text('source')).toBe('fallback');
    expect(text('lat')).toBe(String(PH_CENTER.latitude));
    expect(text('lng')).toBe(String(PH_CENTER.longitude));
  });

  it('falls back to the PH center when position is unavailable', () => {
    setGeolocation((_success, error) => error({ code: 2, message: 'unavailable' }));
    render(
      <GeolocationProvider>
        <Harness />
      </GeolocationProvider>,
    );
    expect(text('status')).toBe('unavailable');
    expect(text('source')).toBe('fallback');
    expect(text('lat')).toBe(String(PH_CENTER.latitude));
  });

  it('requests geolocation only once (grant once)', () => {
    const getCurrentPosition = setGeolocation((success) =>
      success({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }),
    );
    function Controls() {
      const ctx = useGeolocation();
      return <button onClick={() => ctx.requestGeolocation()}>grant</button>;
    }
    render(
      <GeolocationProvider>
        <Controls />
      </GeolocationProvider>,
    );
    fireEvent.click(screen.getByText('grant'));
    fireEvent.click(screen.getByText('grant'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('silently refreshes a stale gps position', () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi.fn((success: SuccessCb) => {
      success({ coords: { latitude: 14.6, longitude: 120.98, accuracy: 12 } });
    });
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    render(
      <GeolocationProvider>
        <Harness />
      </GeolocationProvider>,
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    // Advance beyond the stale check interval + the 5-minute staleness window.
    act(() => {
      vi.advanceTimersByTime(60 * 1000 + STALE_GPS_MS + 1000);
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(text('lat')).toBe('14.6');
  });
});
