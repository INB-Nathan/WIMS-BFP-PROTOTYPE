'use client';

import { MapPin, Phone } from 'lucide-react';
import type { TriageClusterEntry } from '@/lib/api';

export interface JurisdictionContextProps {
  cluster: TriageClusterEntry;
}

/**
 * Compact context strip for the triage workflow header.
 * Surfaces the jurisdiction (province, derived from the nearest station's region)
 * and the nearest fire station (name, phone, distance) so the validator has
 * grounding context before acting. Read-only.
 */
export function JurisdictionContext({ cluster }: JurisdictionContextProps) {
  const province = cluster.province_name ?? null;
  const station = cluster.station;
  const stationName = station?.name ?? null;
  const distanceM = station?.distance_m ?? null;
  const phone = station?.phone ?? null;

  const hasAny = province || stationName || distanceM !== null || phone;

  return (
    <div className="triage-context" data-testid="triage-jurisdiction-context">
      <div className="triage-context__group" data-testid="triage-context-jurisdiction">
        <span className="triage-context__label">
          <MapPin className="h-3 w-3" /> Jurisdiction
        </span>
        <span className="triage-context__value" data-testid="triage-context-province">
          {province ?? 'Unknown'}
        </span>
      </div>
      <div className="triage-context__divider" aria-hidden="true" />
      <div className="triage-context__group" data-testid="triage-context-station">
        <span className="triage-context__label">Nearest station</span>
        <span className="triage-context__value">
          <span data-testid="triage-context-station-name">{stationName ?? 'Unknown'}</span>
          {distanceM !== null && (
            <span className="triage-context__sub" data-testid="triage-context-station-distance">
              {' '}
              · {distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`}
            </span>
          )}
          {phone && (
            <span className="triage-context__sub" data-testid="triage-context-station-phone">
              {' '}
              · <Phone className="h-3 w-3 inline" /> {phone}
            </span>
          )}
        </span>
      </div>
      {!hasAny && (
        <span className="triage-context__empty">No jurisdiction or station data available.</span>
      )}
    </div>
  );
}
