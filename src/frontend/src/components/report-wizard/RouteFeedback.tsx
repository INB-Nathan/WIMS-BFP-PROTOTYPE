'use client';

import { AlertTriangle, MapPin, Loader2, CheckCircle2, XCircle, Navigation } from 'lucide-react';
import type { PublicTrackingData } from '@/lib/api/tracking';

export type RouteState = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface RouteFeedbackProps {
  reportLat: number;
  reportLng: number;
  /** Nearest station target for the straight line. */
  station?: { name: string; lat: number; lng: number } | null;
  /** Tracking data once fetched; null while loading. */
  tracking?: PublicTrackingData | null;
  /** True while the tracking fetch is in flight. */
  loading: boolean;
  /** Optional controlled state override (defaults to derived). */
  state?: RouteState;
}

/**
 * Report Wizard receipt routing feedback (Issue #613).
 *
 * VERIFIED FACT (backend CivilianTrackingResponse, src/backend/schemas/
 * civilian.py:94): the tracking payload exposes routing_distance_m,
 * routing_duration_s, and routing_data_source — but the frontend has NO road
 * polyline. Therefore THIS PR renders a STRAIGHT LINE between the report
 * location and the nearest station in ALL three states. The state machine
 * (PENDING / SUCCESS / FAILED) is driven purely by tracking-response
 * availability:
 *   - loading (no response yet)          => PENDING  ("calculating route…")
 *   - response present (routing source)  => SUCCESS  (road-path placeholder)
 *   - response present but no route      => FAILED   (permanent straight line)
 *
 * GAP (documented, not fixed here): when the backend starts returning a real
 * road geometry, swap the straight-line <line> for the polyline and animate.
 * Do NOT call OSRM or any routing service client-side — geometry is only ever
 * provided by the token-gated tracking endpoint.
 */
export function RouteFeedback({ reportLat, reportLng, station, tracking, loading, state: forcedState }: RouteFeedbackProps) {
  const state: RouteState = forcedState ?? (loading
    ? 'PENDING'
    : tracking && tracking.routing_data_source
      ? 'SUCCESS'
      : 'FAILED');

  const stationLat = station?.lat ?? reportLat;
  const stationLng = station?.lng ?? reportLng;

  // Map lat/lng to a small SVG viewport (simple linear projection).
  const W = 320;
  const H = 140;
  const pad = 28;
  const lats = [reportLat, stationLat];
  const lngs = [reportLng, stationLng];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;

  const project = (lat: number, lng: number) => {
    const x = pad + ((lng - minLng) / spanLng) * (W - 2 * pad);
    const y = H - pad - ((lat - minLat) / spanLat) * (H - 2 * pad);
    return { x, y };
  };

  const reportPt = project(reportLat, reportLng);
  const stationPt = project(stationLat, stationLng);

  const lineColor =
    state === 'SUCCESS' ? '#16a34a' : state === 'PENDING' ? '#d97706' : '#dc2626';

  return (
    <div
      data-testid="route-feedback"
      data-state={state}
      className="rounded-lg border p-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-base)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Route to nearest station
        </p>
        <RouteStateBadge state={state} />
      </div>

      <svg
        data-testid="route-line"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Straight-line route to ${station?.name ?? 'nearest station'} (state: ${state})`}
        style={{ display: 'block' }}
      >
        {/* Straight line for ALL states (no road polyline available). */}
        <line
          x1={reportPt.x}
          y1={reportPt.y}
          x2={stationPt.x}
          y2={stationPt.y}
          stroke={lineColor}
          strokeWidth={3}
          strokeDasharray={state === 'SUCCESS' ? undefined : '6 5'}
        />
        {/* Report pin */}
        <circle cx={reportPt.x} cy={reportPt.y} r={6} fill="#dc2626" />
        {/* Station pin */}
        <circle cx={stationPt.x} cy={stationPt.y} r={6} fill="#1d4ed8" />
        <text x={reportPt.x} y={reportPt.y - 10} fontSize={9} textAnchor="middle" fill="var(--text-secondary)">
          Report
        </text>
        <text x={stationPt.x} y={stationPt.y - 10} fontSize={9} textAnchor="middle" fill="var(--text-secondary)">
          Station
        </text>
      </svg>

      <div className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          <span>Nearest: {station?.name ?? '—'}</span>
        </div>
        {state === 'PENDING' && (
          <div className="flex items-center gap-1.5" style={{ color: '#d97706' }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating route…
          </div>
        )}
        {state === 'SUCCESS' && (
          <div className="flex items-center gap-1.5" style={{ color: '#16a34a' }}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            {tracking?.routing_distance_m != null
              ? `Distance: ${formatDistance(tracking.routing_distance_m)}`
              : 'Route available.'}
            {tracking?.routing_duration_s != null
              ? ` · ETA ${Math.round(tracking.routing_duration_s / 60)} min`
              : ''}
          </div>
        )}
        {state === 'FAILED' && (
          <div className="flex items-center gap-1.5" style={{ color: '#dc2626' }}>
            <XCircle className="w-3.5 h-3.5" />
            Route unavailable — showing straight-line distance.
          </div>
        )}
        {tracking?.routing_data_source && (
          <div className="flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5" />
            <span>Source: {tracking.routing_data_source}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteStateBadge({ state }: { state: RouteState }) {
  const config = {
    PENDING: { label: 'Calculating', color: '#d97706', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    SUCCESS: { label: 'Routed', color: '#16a34a', icon: <CheckCircle2 className="w-3 h-3" /> },
    FAILED: { label: 'No route', color: '#dc2626', icon: <AlertTriangle className="w-3 h-3" /> },
  }[state];
  return (
    <span
      data-testid="route-state-badge"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: `${config.color}1a`, color: config.color }}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}
