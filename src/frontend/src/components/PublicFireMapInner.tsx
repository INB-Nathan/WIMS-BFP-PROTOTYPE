'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMapEvents,
  useMap,
  Marker,
} from 'react-leaflet';
import L from 'leaflet';
import { fetchClusters } from '@/lib/api';
import { fetchStations } from '@/lib/api/map';
import type { StationItem } from '@/lib/api/map';
import { userLocationIcon, firePinIcon } from './map/leafletIcons';
import type {
  MapClusterItem,
} from '@/lib/api';

// ── Constants ───────────────────────────────────────────────────────────────

/** Polling interval in ms for new clusters */
const POLL_INTERVAL_MS = 60_000;
/** Minimum zoom for showing individual markers instead of clusters */
const INDIVIDUAL_ZOOM = 15;
/** Debounce delay before re-fetching clusters after viewport change */
const VIEWPORT_DEBOUNCE_MS = 400;

// ── Marker icons ───────────────────────────────────────────────────────────

const PinIcon = firePinIcon;

type LocationStatus = 'idle' | 'loading' | 'success' | 'denied' | 'timedOut' | 'error';

// ── Props ───────────────────────────────────────────────────────────────────

export interface PublicFireMapInnerProps {
  center: [number, number];
  zoom: number;
  onLocationSelect?: (lat: number, lng: number) => void;
  selectionMode?: boolean;
  selectedLocation?: [number, number] | null;
  onGeolocationAvailable?: (lat: number, lng: number) => void;
  showStations?: boolean;
  /** Auto-request the user's location on mount and fly to it at barangay zoom */
  locateOnLoad?: boolean;
}

// ── Cluster color helpers ───────────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case 'high':   return '#dc2626'; // red-600
    case 'medium': return '#ea580c'; // orange-600
    default:       return '#eab308'; // yellow-500
  }
}

function severityFillOpacity(count: number): number {
  if (count >= 20) return 0.7;
  if (count >= 10) return 0.55;
  if (count >= 5)  return 0.4;
  return 0.25;
}

function markerRadius(count: number, zoom: number): number {
  if (zoom >= INDIVIDUAL_ZOOM) return 8;
  return Math.min(8 + count * 1.5, 30);
}

// ── Viewport change detector (debounced) ────────────────────────────────────

function ViewportHandler({
  onViewportChange,
}: {
  onViewportChange: (bounds: L.LatLngBounds, zoom: number) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      const z = map.getZoom();
      onViewportChange(bounds, z);
    },
  });

  // Fire initial load
  useEffect(() => {
    // Small delay so the map has settled
    const timer = setTimeout(() => {
      onViewportChange(map.getBounds(), map.getZoom());
    }, 200);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ── Map recenter (avoids setView loops) ────────────────────────────────────

function MapRecenter({ target, zoom }: { target: [number, number] | null; zoom: number }) {
  const map = useMap();
  const lastTarget = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!target) return;
    if (lastTarget.current && lastTarget.current[0] === target[0] && lastTarget.current[1] === target[1]) {
      return;
    }
    lastTarget.current = target;
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.setView(target, zoom, { animate: !reduceMotion });
  }, [target, zoom, map]);

  return null;
}

// ── Geolocation handler ─────────────────────────────────────────────────────

function GeolocateButton({
  onLocation,
  onStatusChange,
}: {
  onLocation: (lat: number, lng: number) => void;
  onStatusChange: (status: LocationStatus) => void;
}) {
  const handleClick = useCallback(() => {
    if (!navigator.geolocation) {
      onStatusChange('error');
      return;
    }
    onStatusChange('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onStatusChange('success');
        onLocation(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        // Use numeric codes: PERMISSION_DENIED=1, TIMEOUT=3
        if (err.code === 1) {
          onStatusChange('denied');
        } else if (err.code === 3) {
          onStatusChange('timedOut');
        } else {
          onStatusChange('error');
        }
      },
      { timeout: 10_000, maximumAge: 30_000 },
    );
  }, [onLocation, onStatusChange]);

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Use my location"
      aria-label="Use my location / Gamitin ang lokasyon ko"
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 1000,
        background: 'white',
        border: '2px solid rgba(0,0,0,0.15)',
        borderRadius: 6,
        padding: '5px 10px',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: '18px',
        color: '#333',
        boxShadow: '0 1px 5px rgba(0,0,0,0.2)',
      }}
    >
      <span role="img" aria-hidden="true">📍</span>{' '}
      Use my location
    </button>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function PublicFireMapInner({
  center,
  zoom: initialZoom,
  onLocationSelect,
  selectionMode = false,
  selectedLocation,
  onGeolocationAvailable,
  showStations = false,
  locateOnLoad = false,
}: PublicFireMapInnerProps) {
  const [clusters, setClusters] = useState<MapClusterItem[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pinPosition, setPinPosition] = useState<[number, number] | null>(
    selectedLocation ?? null,
  );
  const [degraded, setDegraded] = useState(false);
  const [stations, setStations] = useState<StationItem[] | null>(null);
  const [stationError, setStationError] = useState(false);

  // ── Fetch stations when layer is toggled on ─────────────────────────
  useEffect(() => {
    if (!showStations) {
      setStations(null);
      setStationError(false);
      return;
    }
    let cancelled = false;
    fetchStations()
      .then((data) => {
        if (!cancelled) {
          setStations(data);
          setStationError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setStationError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [showStations]);

  // Station marker style (blue, distinct from cluster circles)
  const stationIcon = useMemo(() => L.divIcon({
    className: 'leaflet-station-marker',
    html: `<div style="
      width: 12px; height: 12px;
      background: #3b82f6;
      border: 2px solid #fff;
      border-radius: 2px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }), []);

  // Display-only geolocation state (non-selection mode)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [viewTarget, setViewTarget] = useState<[number, number] | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBounds = useRef<{ sw: [number, number]; ne: [number, number] } | null>(null);
  const lastZoom = useRef<number>(initialZoom);

  // Sync selectedLocation prop
  useEffect(() => {
    setPinPosition(selectedLocation ?? null);
  }, [selectedLocation]);

  // ── Fetch clusters ──────────────────────────────────────────────────────
  const loadClusters = useCallback(
    async (bounds: L.LatLngBounds, zoom: number) => {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      lastBounds.current = {
        sw: [sw.lat, sw.lng],
        ne: [ne.lat, ne.lng],
      };
      lastZoom.current = zoom;

      setLoading(true);
      try {
        const data = await fetchClusters(
          [sw.lat, sw.lng],
          [ne.lat, ne.lng],
          zoom,
        );
        setClusters(data.clusters);
        setMapError(null);
        setDegraded(false);
      } catch {
        setMapError(
          'Unable to load fire incident data. Showing last available information.',
        );
        setDegraded(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Handle viewport change (debounced) ──────────────────────────────────
  const handleViewportChange = useCallback(
    (bounds: L.LatLngBounds, zoom: number) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        loadClusters(bounds, zoom);
      }, VIEWPORT_DEBOUNCE_MS);
    },
    [loadClusters],
  );

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // ── Polling (60s when visible; paused when tab hidden) ──────────────────
  useEffect(() => {
    const startPolling = () => {
      if (pollTimer.current) return; // already polling
      pollTimer.current = setInterval(() => {
        if (lastBounds.current) {
          const bounds = L.latLngBounds(
            L.latLng(lastBounds.current.sw[0], lastBounds.current.sw[1]),
            L.latLng(lastBounds.current.ne[0], lastBounds.current.ne[1]),
          );
          loadClusters(bounds, lastZoom.current);
        }
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadClusters]);

  // ── Handle geolocation ──────────────────────────────────────────────────
  const handleGeolocation = useCallback(
    (lat: number, lng: number) => {
      // Call parent callback if provided (backward compat)
      onGeolocationAvailable?.(lat, lng);
      if (selectionMode) {
        setPinPosition([lat, lng]);
        onLocationSelect?.(lat, lng);
      } else {
        // Display-only: recenter map + show user marker
        setUserLocation([lat, lng]);
        setViewTarget([lat, lng]);
      }
    },
    [onGeolocationAvailable, onLocationSelect, selectionMode],
  );

  // ── Auto-locate on load (silent; does not surface the status banner) ──
  useEffect(() => {
    if (!locateOnLoad) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handleGeolocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        // Permission denied / unavailable: stay at the default barangay view.
      },
      { timeout: 10_000, maximumAge: 30_000 },
    );
  }, [locateOnLoad, handleGeolocation]);

  // ── Map click for selection mode ────────────────────────────────────────
  function handleMapClick(e: L.LeafletMouseEvent) {
    if (!selectionMode) return;
    const { lat, lng } = e.latlng;
    setPinPosition([lat, lng]);
    onLocationSelect?.(lat, lng);
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={initialZoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ViewportHandler onViewportChange={handleViewportChange} />

        {/* Recenter map when viewTarget changes */}
        <MapRecenter target={viewTarget} zoom={initialZoom >= 14 ? initialZoom : 14} />

        {/* Map click handler for selection mode */}
        {selectionMode && <MapClickHandler onClick={handleMapClick} />}

        {/* Draggable pin in selection mode */}
        {selectionMode && pinPosition && (
          <DraggablePin
            position={pinPosition}
            onDragEnd={(lat, lng) => {
              setPinPosition([lat, lng]);
              onLocationSelect?.(lat, lng);
            }}
          />
        )}

        {/* Static pin (non-selection mode) */}
        {!selectionMode && pinPosition && (
          <Marker position={pinPosition} icon={PinIcon} />
        )}

        {/* User location marker (display-only, non-selection mode) */}
        {!selectionMode && userLocation && (
          <Marker
            position={userLocation}
            icon={userLocationIcon}
            interactive={false}
          />
        )}

        {/* Cluster circles */}
        {clusters.map((c, i) => (
          <CircleMarker
            key={`${c.lat}-${c.lng}-${i}`}
            center={[c.lat, c.lng]}
            radius={markerRadius(c.count, lastZoom.current)}
            pathOptions={{
              color: severityColor(c.severity),
              fillColor: severityColor(c.severity),
              fillOpacity: severityFillOpacity(c.count),
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-xs min-w-[120px]">
                <p className="font-semibold text-sm">
                  {c.count} incident{c.count !== 1 ? 's' : ''}
                </p>
                <p className="text-slate-500 mt-0.5">
                  Severity: <span className="font-medium">{c.severity}</span>
                </p>
                {c.latest_at && (
                  <p className="text-slate-400 mt-0.5">
                    Latest: {new Date(c.latest_at).toLocaleDateString()}
                  </p>
                )}
                <p className="text-slate-400">
                  {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                </p>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Fire-station markers (togglable layer) */}
        {showStations && stationError && (
          <div className="absolute bottom-12 left-3 z-[1000] bg-white/90 rounded-md px-3 py-1.5 text-xs text-red-600 shadow-sm border border-slate-200">
            Unable to load fire stations
          </div>
        )}
        {showStations && stations && stations.length > 0 && (
          <div className="absolute bottom-12 left-3 z-[1000] bg-white/90 rounded-md px-3 py-1.5 text-xs text-slate-500 shadow-sm border border-slate-200">
            {stations.length} fire station{stations.length !== 1 ? 's' : ''}
          </div>
        )}
        {showStations && stations?.map((s) => (
          <Marker
            key={s.station_id}
            position={[s.latitude, s.longitude]}
            icon={stationIcon}
            interactive={false}
          />
        ))}
      </MapContainer>

      {/* Geolocation button */}
      <GeolocateButton onLocation={handleGeolocation} onStatusChange={setLocationStatus} />

      {/* Geolocation status (non-blocking) */}
      {locationStatus !== 'idle' && locationStatus !== 'success' && (
        <div className="absolute top-0 left-3 right-12 z-[1000] bg-white/95 border border-slate-200 rounded-b-md px-3 py-1.5 text-xs text-slate-500 shadow-sm">
          {locationStatus === 'loading' && 'Locating...'}
          {locationStatus === 'denied' && 'Location access denied. Showing national map.'}
          {locationStatus === 'timedOut' && 'Location request timed out. Showing national map.'}
          {locationStatus === 'error' && 'Could not get location. Showing national map.'}
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 rounded-full px-3 py-1 text-xs text-slate-500 shadow-sm border border-slate-200">
          Loading...
        </div>
      )}

      {/* Degraded state banner */}
      {degraded && (
        <div className="absolute top-12 left-3 right-3 z-[1000] bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 shadow-sm">
          {mapError ?? 'Map data may be outdated.'}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

/** Captures map clicks for location selection */
function MapClickHandler({
  onClick,
}: {
  onClick: (e: L.LeafletMouseEvent) => void;
}) {
  useMapEvents({ click: onClick });
  return null;
}

/** A draggable marker that reports new position on drag end */
function DraggablePin({
  position,
  onDragEnd,
}: {
  position: [number, number];
  onDragEnd: (lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const marker = markerRef.current;
    if (marker) {
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onDragEnd(pos.lat, pos.lng);
      });
    }
  }, [onDragEnd]);

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={PinIcon}
      draggable={true}
    />
  );
}
