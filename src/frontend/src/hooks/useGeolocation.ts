'use client';

import { useContext } from 'react';
import {
  GeolocationContext,
  type GeolocationContextValue,
} from '@/components/GeolocationProvider';

/**
 * Consume the shared geolocation state provided by <GeolocationProvider>.
 *
 * Calling `requestGeolocation()` grants permission once; every map or component
 * that calls this hook shares the same coordinate, falling back to the
 * Philippines center when permission is denied.
 *
 * Throws if used outside a <GeolocationProvider>.
 */
export function useGeolocation(): GeolocationContextValue {
  const ctx = useContext(GeolocationContext);
  if (!ctx) {
    throw new Error('useGeolocation must be used within a <GeolocationProvider>');
  }
  return ctx;
}
