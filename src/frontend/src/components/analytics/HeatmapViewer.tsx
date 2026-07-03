'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import { Download, Maximize2, Minimize2 } from 'lucide-react';
/* leaflet.css loaded globally in app/globals.css */
import type { HeatmapGeoJSON } from '@/lib/api';

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];
const DEFAULT_ZOOM = 6;

export interface HeatmapViewerProps {
  geojson: HeatmapGeoJSON;
  className?: string;
  emptyMessage?: string;
  exportDisabled?: boolean;
  exportFilenamePrefix?: string;
}

export function HeatmapViewer({
  geojson,
  className = 'h-[400px]',
  emptyMessage = 'No incidents to display on map',
  exportDisabled = false,
  exportFilenamePrefix = 'wims-heatmap',
}: HeatmapViewerProps) {
  const { features } = geojson;
  const [fullscreen, setFullscreen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exportMapRef = useRef<any>(null);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  // ── Export helpers ──────────────────────────────────────────────────────

  const validPoints = features
    .filter((f) => f.geometry?.coordinates?.length >= 2)
    .map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number]);

  const handleExport = useCallback(async (format: 'png' | 'jpeg') => {
    if (exporting || validPoints.length === 0) return;
    setExporting(true);
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-99999px;top:0;width:1080px;height:1600px;';
    container.setAttribute('data-heatmap-export-container', 'true');
    document.body.appendChild(container);

    try {
      const L = await import('leaflet');
      const { createRoot } = await import('react-dom/client');
      const domToImage = await import('dom-to-image-more');
      const root = createRoot(container);

      await new Promise<void>((resolve) => {
        const ExportMap = () => {
          const mapReady = useRef(false);
          return (
            <MapContainer
              ref={(m) => { exportMapRef.current = m; }}
              center={DEFAULT_CENTER}
              zoom={DEFAULT_ZOOM}
              style={{ width: '100%', height: '100%' }}
              scrollWheelZoom={false}
              whenReady={() => {
                if (mapReady.current || !exportMapRef.current) return;
                mapReady.current = true;
                const map = exportMapRef.current;
                if (validPoints.length === 1) {
                  map.setView(validPoints[0], 13);
                } else {
                  const bounds = L.latLngBounds(validPoints);
                  if (bounds.isValid()) {
                    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 13 });
                  }
                }
                // ponytail: inline timeout for tile load, fire-and-forget
                setTimeout(() => resolve(), 2500);
              }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                crossOrigin="anonymous"
              />
              {features.map((f, i) => {
                const coords = f.geometry?.coordinates;
                if (!coords || coords.length < 2) return null;
                const [lon, lat] = coords;
                return (
                  <CircleMarker
                    key={f.properties?.incident_id ?? i}
                    center={[lat, lon]}
                    radius={6}
                    pathOptions={{ color: '#b91c1c', fillColor: '#dc2626', fillOpacity: 0.7, weight: 1 }}
                  />
                );
              })}
            </MapContainer>
          );
        };
        root.render(<ExportMap />);
      });

      const dataUrl = format === 'png'
        ? await domToImage.toPng(container, { width: 1080, height: 1600 })
        : await domToImage.toJpeg(container, { quality: 0.92, width: 1080, height: 1600, bgcolor: '#ffffff' });

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${exportFilenamePrefix}-${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      root.unmount();
    } catch (err) {
      console.error('Heatmap export failed:', err);
    } finally {
      document.body.removeChild(container);
      exportMapRef.current = null;
      setExporting(false);
    }
  }, [exporting, validPoints, features, exportFilenamePrefix]);

  // ── Export button fragment ──────────────────────────────────────────────

  const hasFeatures = features && features.length > 0;

  const exportButtons = hasFeatures ? (
    <>
      <button
        type="button"
        onClick={() => void handleExport('png')}
        disabled={exportDisabled || exporting}
        title={exportDisabled ? 'Unavailable offline' : 'Download PNG'}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
        style={{ backgroundColor: '#991B1B' }}
        aria-label="Download heatmap as PNG"
      >
        <Download className="h-3 w-3" aria-hidden="true" />
        PNG
      </button>
      <button
        type="button"
        onClick={() => void handleExport('jpeg')}
        disabled={exportDisabled || exporting}
        title={exportDisabled ? 'Unavailable offline' : 'Download JPEG'}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
        style={{ backgroundColor: '#991B1B' }}
        aria-label="Download heatmap as JPEG"
      >
        <Download className="h-3 w-3" aria-hidden="true" />
        JPEG
      </button>
    </>
  ) : null;

  // ── Render map ──────────────────────────────────────────────────────────

  const renderMap = (mapClassName: string) => {
    if (!hasFeatures) {
      return (
        <div className={`flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500 ${mapClassName}`}>
          <p className="text-sm font-medium">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: '100%' }}
        className={`rounded-md z-0 ${mapClassName}`}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          crossOrigin="anonymous"
        />
        {features.map((f, i) => {
          const coords = f.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const [lon, lat] = coords;
          return (
            <CircleMarker
              key={f.properties?.incident_id ?? i}
              center={[lat, lon]}
              radius={6}
              pathOptions={{ color: '#b91c1c', fillColor: '#dc2626', fillOpacity: 0.7, weight: 1 }}
            />
          );
        })}
      </MapContainer>
    );
  };

  return (
    <>
      <div className="relative">
        <div className="absolute right-3 top-3 z-[500] flex items-center gap-2">
          {exportButtons}
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            aria-label="Open heatmap fullscreen"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            Fullscreen
          </button>
        </div>
        {renderMap(className)}
      </div>

      {fullscreen && (
        <div
          className="fixed z-[100] bg-black/70 p-4 sm:p-6"
          role="dialog" aria-modal="true" aria-label="Fullscreen heatmap"
          style={{ top: 'var(--header-height)', left: 'var(--sidebar-width)', right: 0, bottom: 0 }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="absolute right-4 top-4 z-[500] flex items-center gap-2">
              {exportButtons}
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                aria-label="Exit heatmap fullscreen"
              >
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
                Exit fullscreen
              </button>
            </div>
            <div className="h-full p-4 pt-16 sm:p-6 sm:pt-20">
              {renderMap('h-full min-h-[320px]')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
