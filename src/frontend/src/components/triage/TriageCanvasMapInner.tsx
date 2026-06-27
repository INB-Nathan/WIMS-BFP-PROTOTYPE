'use client';

import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import {
  deriveClusterGeometry,
  getTriageItemIdentity,
  isValidPhilippinesCoordinate,
  type TriageItemIdentity,
} from './triageGeometry';

interface TriageCanvasMapInnerProps {
  items: TriageClusterEntry[];
  selectedIdentity: TriageItemIdentity | null;
  selectedReportId: number | null;
  onSelectItem: (item: TriageClusterEntry) => void;
  onSelectReport: (reportId: number) => void;
}

function severityColor(severity: string): string {
  if (severity === 'HIGH') return '#b91c1c';
  if (severity === 'MEDIUM') return '#ea580c';
  return '#64748b';
}

function sameIdentity(a: TriageItemIdentity | null, b: TriageItemIdentity | null): boolean {
  return Boolean(a && b && a.type === b.type && a.id === b.id);
}

function offsetForIndex(value: number): [number, number] {
  const ring = value % 6;
  const delta = 0.00008;
  return [Math.cos(ring) * delta, Math.sin(ring) * delta];
}

function TriageMapViewport({
  selectedItem,
  selectedReportId,
}: {
  selectedItem: TriageClusterEntry | null;
  selectedReportId: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedItem) return;

    if (selectedReportId != null) {
      const report = selectedItem.reports.find((entry) => entry.report_id === selectedReportId);
      if (report && isValidPhilippinesCoordinate(report.latitude, report.longitude)) {
        map.setView([report.latitude, report.longitude], Math.max(map.getZoom(), 15), { animate: true });
        return;
      }
    }

    const geometry = deriveClusterGeometry(selectedItem);
    if (geometry.bounds && geometry.validReports.length > 1) {
      map.fitBounds(geometry.bounds, { animate: true, maxZoom: 15, padding: [32, 32] });
      return;
    }

    if (geometry.centroid) {
      map.setView(geometry.centroid, Math.max(map.getZoom(), 15), { animate: true });
    }
  }, [map, selectedItem, selectedReportId]);

  return null;
}

export default function TriageCanvasMapInner({
  items,
  selectedIdentity,
  selectedReportId,
  onSelectItem,
  onSelectReport,
}: TriageCanvasMapInnerProps) {
  const selectedItem = useMemo(() => {
    if (!selectedIdentity) return null;
    return items.find((item) => sameIdentity(getTriageItemIdentity(item), selectedIdentity)) ?? null;
  }, [items, selectedIdentity]);

  return (
    <MapContainer
      center={[12.8, 121.8]}
      zoom={6}
      style={{ height: 'min(68vh, 680px)', minHeight: '420px', width: '100%', borderRadius: '0.75rem' }}
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <TriageMapViewport selectedItem={selectedItem} selectedReportId={selectedReportId} />

      {items.map((item) => {
        const identity = getTriageItemIdentity(item);
        if (!identity) return null;
        const selected = sameIdentity(identity, selectedIdentity);
        const geometry = deriveClusterGeometry(item);
        const isCluster = identity.type === 'cluster';
        const color = severityColor(item.severity);

        if (isCluster && geometry.centroid && geometry.radiusMeters) {
          return (
            <Circle
              key={`cluster-${identity.id}`}
              center={geometry.centroid}
              radius={geometry.radiusMeters}
              eventHandlers={{ click: () => onSelectItem(item) }}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: selected ? 0.35 : 0.16,
                weight: selected ? 4 : 2,
              }}
            >
              <Popup>
                <div className="text-xs min-w-[160px]">
                  <p className="font-semibold text-sm">Cluster #{identity.id}</p>
                  <p>{item.member_count} report(s) Â· {item.severity}</p>
                  <button type="button" className="mt-2 text-red-700 font-semibold" onClick={() => onSelectItem(item)}>
                    Select cluster
                  </button>
                </div>
              </Popup>
            </Circle>
          );
        }

        const report = item.reports[0] as TriageReportEntry | undefined;
        if (!report || !isValidPhilippinesCoordinate(report.latitude, report.longitude)) return null;
        const [latOffset, lngOffset] = offsetForIndex(report.report_id);
        const selectedReport = report.report_id === selectedReportId || selected;

        return (
          <CircleMarker
            key={`report-${report.report_id}`}
            center={[report.latitude + latOffset, report.longitude + lngOffset]}
            radius={selectedReport ? 10 : 7}
            eventHandlers={{
              click: () => {
                onSelectItem(item);
                onSelectReport(report.report_id);
              },
            }}
            pathOptions={{
              color: selectedReport ? '#142849' : color,
              fillColor: color,
              fillOpacity: selectedReport ? 0.95 : 0.72,
              weight: selectedReport ? 4 : 2,
            }}
          >
            <Popup>
              <div className="text-xs min-w-[150px]">
                <p className="font-semibold text-sm">Report #{report.report_id}</p>
                <p>{report.category ?? 'Unclassified'}{report.sub_category ? ` / ${report.sub_category}` : ''}</p>
                <button type="button" className="mt-2 text-red-700 font-semibold" onClick={() => onSelectReport(report.report_id)}>
                  Select report
                </button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

