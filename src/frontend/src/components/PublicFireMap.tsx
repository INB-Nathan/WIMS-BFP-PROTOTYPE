'use client';

import dynamic from 'next/dynamic';
import { useMemo, type ComponentType } from 'react';
import type { PublicFireMapInnerProps } from './PublicFireMapInner';

// SSR guard: react-leaflet breaks without window
const MapInner = dynamic(
  () => import('./PublicFireMapInner') as Promise<{ default: ComponentType<PublicFireMapInnerProps> }>,
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 w-full items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-400">
        Loading map...
      </div>
    ),
  },
);

export interface PublicFireMapProps {
  /** Initial center point [lat, lng] */
  center?: [number, number];
  /** Initial zoom level */
  zoom?: number;
  /** Height of the map container */
  height?: number | string;
  /** Callback when user clicks a cluster to report location */
  onLocationSelect?: (lat: number, lng: number) => void;
  /** Show a draggable pin for location selection */
  selectionMode?: boolean;
  /** Currently selected pin location (lat, lng) — null to clear */
  selectedLocation?: [number, number] | null;
  /** Callback when the user's geolocation is available */
  onGeolocationAvailable?: (lat: number, lng: number) => void;
  /** Additional CSS class */
  className?: string;
  /** Show fire-station markers on the map */
  showStations?: boolean;
}

export function PublicFireMap({
  center = [14.5995, 120.9842],
  zoom = 10,
  height = 320,
  onLocationSelect,
  selectionMode = false,
  selectedLocation,
  onGeolocationAvailable,
  className = '',
  showStations = false,
}: PublicFireMapProps) {
  const style = useMemo(() => {
    const h = typeof height === 'number' ? `${height}px` : height;
    return {
      height: h,
      minHeight: '200px',
      width: '100%',
    } as React.CSSProperties;
  }, [height]);

  return (
    <div className={`rounded-md overflow-hidden border border-slate-200 ${className}`} style={style}>
      <MapInner
        center={center}
        zoom={zoom}
        onLocationSelect={onLocationSelect}
        selectionMode={selectionMode}
        selectedLocation={selectedLocation}
        onGeolocationAvailable={onGeolocationAvailable}
        showStations={showStations}
      />
    </div>
  );
}
