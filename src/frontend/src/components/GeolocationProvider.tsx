'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Geographic center of the Philippines, used as the fallback position when the
 * browser denies or cannot provide geolocation.
 */
export const PH_CENTER = { latitude: 12.8797, longitude: 121.774 };

/** A fresh GPS reading older than this is considered stale and refreshed silently. */
export const STALE_GPS_MS = 5 * 60 * 1000;

/** How often the provider checks whether the last GPS reading is stale. */
const STALE_CHECK_INTERVAL_MS = 60 * 1000;

export type GeolocationStatus =
  | 'idle'
  | 'loading'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'fallback';

export interface GeolocationContextValue {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  status: GeolocationStatus;
  error: string | null;
  /** `gps` once a real position is obtained, `fallback` when PH center is used. */
  source: 'gps' | 'fallback' | null;
  /** Epoch ms of the last successful position read (gps or fallback). */
  timestamp: number | null;
  /** Request geolocation once; subsequent calls reuse the existing result. */
  requestGeolocation: () => void;
  /** Force a fresh position read without flipping to the loading state. */
  refresh: () => void;
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 30_000,
};

function buildInitialState(): GeolocationContextValue {
  return {
    latitude: null,
    longitude: null,
    accuracy: null,
    status: 'idle',
    error: null,
    source: null,
    timestamp: null,
    requestGeolocation: () => {},
    refresh: () => {},
  };
}

export const GeolocationContext = createContext<GeolocationContextValue | null>(null);

export function GeolocationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GeolocationContextValue>(buildInitialState());
  const requestedRef = useRef(false);
  // Mirror state in a ref so interval/refresh callbacks read fresh values
  // without re-subscribing on every render. Kept in sync via effect (not during
  // render) to satisfy the React ref-access rules.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const handleSuccess = useCallback((pos: GeolocationPosition) => {
    setState((s) => ({
      ...s,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
      status: 'granted',
      error: null,
      source: 'gps',
      timestamp: Date.now(),
    }));
  }, []);

  const applyFallback = useCallback(
    (status: 'denied' | 'unavailable', message: string) => {
      setState((s) => ({
        ...s,
        latitude: PH_CENTER.latitude,
        longitude: PH_CENTER.longitude,
        accuracy: null,
        status,
        error: message,
        source: 'fallback',
        timestamp: Date.now(),
      }));
    },
    [],
  );

  const readPosition = useCallback(
    (opts?: { silent?: boolean }) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        applyFallback('unavailable', 'Geolocation is not supported on this device.');
        return;
      }
      if (!opts?.silent) {
        setState((s) => ({ ...s, status: 'loading', error: null }));
      }
      navigator.geolocation.getCurrentPosition(
        handleSuccess,
        (err) => {
          // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
          if (err.code === 1) {
            applyFallback('denied', 'Location permission was denied.');
          } else {
            applyFallback('unavailable', 'Your current location could not be determined.');
          }
        },
        GEO_OPTIONS,
      );
    },
    [applyFallback, handleSuccess],
  );

  const requestGeolocation = useCallback(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    readPosition({ silent: false });
  }, [readPosition]);

  const refresh = useCallback(() => {
    if (stateRef.current.source !== 'gps') return;
    readPosition({ silent: true });
  }, [readPosition]);

  // Silent refresh: once we hold a real GPS position, re-read it whenever it
  // goes stale (>5 min) so maps always show a recent coordinate.
  useEffect(() => {
    const interval = setInterval(() => {
      const s = stateRef.current;
      if (s.source === 'gps' && s.timestamp && Date.now() - s.timestamp > STALE_GPS_MS) {
        refresh();
      }
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const value: GeolocationContextValue = {
    ...state,
    requestGeolocation,
    refresh,
  };

  return <GeolocationContext.Provider value={value}>{children}</GeolocationContext.Provider>;
}
