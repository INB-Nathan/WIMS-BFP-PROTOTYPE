'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { RouteMapInnerProps } from './RouteMapInner';

/**
 * SSR-safe RouteMap — wraps the Leaflet RouteMapInner with next/dynamic.
 * Renders a loading placeholder until the client bundle arrives.
 *
 * Domain-neutral: accepts report/station endpoints, optional GeoJSON
 * LineString geometry, and presentation options.
 */
const RouteMap = dynamic(
  () =>
    import('./RouteMapInner').then(
      (m) => m.RouteMapInner,
    ) as Promise<ComponentType<RouteMapInnerProps>>,
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center rounded-lg text-xs"
        style={{ height: '200px', background: '#f8fafc', color: '#64748b' }}
      >
        Loading map…
      </div>
    ),
  },
);

export type { RouteMapInnerProps };
export default RouteMap;
