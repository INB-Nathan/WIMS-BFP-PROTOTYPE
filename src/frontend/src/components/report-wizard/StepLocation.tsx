'use client';

import { useEffect, useRef, useState } from 'react';
import { Locate, AlertTriangle, MapPin } from 'lucide-react';
import { MapPicker } from '@/components/MapPicker';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

const GPS_TIMEOUT_MS = 10_000;

export interface StepLocationProps {
  latitude: number | null;
  longitude: number | null;
  landmark: string;
  onChange: (next: { latitude: number | null; longitude: number | null; landmark: string }) => void;
}

/**
 * Step 1 — Location. Map picker / GPS / landmark text input (all optional).
 * Reuses the shared MapPicker (next/dynamic MapPickerInner) and a manual
 * lat/lng fallback if the map chunk fails (boundary handled by the Wizard).
 */
export function StepLocation({ latitude, longitude, landmark, onChange }: StepLocationProps) {
  const { isOnline } = useNetworkStatus();
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'acquiring' | 'denied' | 'timeout' | 'acquired'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function requestGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('denied');
      return;
    }
    setGpsStatus('acquiring');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setGpsStatus('acquired');
        onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, landmark });
      },
      () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setGpsStatus('denied');
      },
      { timeout: GPS_TIMEOUT_MS, maximumAge: 30_000 },
    );
    timeoutRef.current = setTimeout(() => setGpsStatus('timeout'), GPS_TIMEOUT_MS);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Where is the fire? <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>(required)</span>
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          Drop a pin on the map or use your location. A nearby landmark is optional extra context.
        </p>

        <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          <MapPicker
            value={latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null}
            onChange={(lat, lng) => onChange({ latitude: lat, longitude: lng, landmark })}
          />
        </div>

        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={requestGps}
            data-testid="gps-button"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Locate className="w-3.5 h-3.5" /> Use my location
          </button>
          {gpsStatus === 'acquired' && latitude !== null && (
            <span className="text-xs flex items-center gap-1" style={{ color: '#16a34a' }}>
              <MapPin className="w-3.5 h-3.5" /> GPS: {latitude.toFixed(5)}, {longitude?.toFixed(5)}
            </span>
          )}
          {(gpsStatus === 'denied' || gpsStatus === 'timeout') && (
            <span className="text-xs flex items-center gap-1" style={{ color: '#b91c1c' }}>
              <AlertTriangle className="w-3.5 h-3.5" /> Location unavailable
            </span>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="landmark" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
          Nearby landmark <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>(optional)</span>
        </label>
        <input
          id="landmark"
          type="text"
          value={landmark}
          onChange={(e) => onChange({ latitude, longitude, landmark: e.target.value })}
          placeholder="e.g. near Jollibee on Rizal Ave"
          className="form-input"
          style={{ fontSize: '0.875rem' }}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Helps validators locate the fire. Not a replacement for coordinates.
        </p>
      </div>

      {!isOnline && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: '#b45309' }}>
          <AlertTriangle className="w-3.5 h-3.5" /> Offline — the map may not load. Coordinates can still be typed later or the report queued.
        </p>
      )}
    </div>
  );
}
