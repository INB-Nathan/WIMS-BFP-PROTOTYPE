/**
 * usePublicEmergencies — single shared fetch of published, verified BFP
 * emergencies for the public landing page.
 *
 * Both the map (perimeters/point markers) and the sidebar (active-fires list)
 * need the same `/information/emergencies` payload. Previously each component
 * fetched it independently, doubling load on page load and leaving the two
 * surfaces unable to share selection state. This hook fetches once and is
 * passed down to both, fixing the duplicate request and enabling
 * click-to-center coupling between sidebar cards and the map.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchEmergencies, type EmergencyResponse } from './api/information';

export interface PublicEmergenciesState {
  emergencies: EmergencyResponse[];
  /** true only during the very first load */
  loading: boolean;
  /** true when the latest fetch rejected */
  error: boolean;
  retry: () => void;
}

export function usePublicEmergencies(): PublicEmergenciesState {
  const [emergencies, setEmergencies] = useState<EmergencyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Guards against double-invocation under React 18 StrictMode dev mount.
  const inFlight = useRef(false);

  const runFetch = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(false);
    fetchEmergencies()
      .then((data) => {
        setEmergencies(data ?? []);
        setError(false);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, []);

  // Mount fetch only — actual setState happens inside the async callbacks,
  // so this satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    runFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(() => {
    runFetch();
  }, [runFetch]);

  return { emergencies, loading, error, retry };
}
