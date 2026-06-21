import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClusterMapInner from '../ClusterMapInner';
import type { TriageReportEntry } from '@/lib/api/legacy';

let markerCount = 0;

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children?: React.ReactNode }) => {
    markerCount++;
    return <div data-testid="marker">{children}</div>;
  },
  Circle: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle">{children}</div>
  ),
}));

describe('ClusterMapInner', () => {
  beforeEach(() => {
    markerCount = 0;
  });

  it('renders TileLayer and MapContainer with required props', () => {
    render(<ClusterMapInner center={[14.6, 121.0]} reports={[]} suggestedReportIds={[]} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });

  it('renders markers for each report', () => {
    const reports: TriageReportEntry[] = [
      {
        report_id: 1,
        latitude: 14.6,
        longitude: 121.0,
        category: 'STRUCTURAL',
        sub_category: 'FIRE',
        reporting_context: null,
        safety_status: null,
        status: 'PENDING',
        status_explanation: null,
        trust_breakdown: {
          score: 0,
          included_signals: [],
          missing_signals: [],
          gps_mismatch: false,
          duplicate_device_count_30m: 0,
        },
        severity: 'LOW' as TriageReportEntry['severity'],
      },
      {
        report_id: 2,
        latitude: 14.61,
        longitude: 121.01,
        category: 'VEHICULAR',
        sub_category: 'COLLISION',
        reporting_context: null,
        safety_status: null,
        status: 'PENDING',
        status_explanation: null,
        trust_breakdown: {
          score: 0,
          included_signals: [],
          missing_signals: [],
          gps_mismatch: false,
          duplicate_device_count_30m: 0,
        },
        severity: 'LOW' as TriageReportEntry['severity'],
      },
    ];
    render(
      <ClusterMapInner center={[14.6, 121.0]} reports={reports} suggestedReportIds={[]} />,
    );
    expect(markerCount).toBe(2);
  });

  it('renders a Circle for reports with anchor position', () => {
    const reports: TriageReportEntry[] = [
      {
        report_id: 1,
        latitude: 14.6,
        longitude: 121.0,
        category: null,
        sub_category: null,
        reporting_context: null,
        safety_status: null,
        status: 'PENDING',
        status_explanation: null,
        trust_breakdown: {
          score: 0,
          included_signals: [],
          missing_signals: [],
          gps_mismatch: false,
          duplicate_device_count_30m: 0,
        },
        severity: 'LOW' as TriageReportEntry['severity'],
      },
    ];
    render(
      <ClusterMapInner center={[14.6, 121.0]} reports={reports} suggestedReportIds={[]} />,
    );
    expect(screen.getByTestId('circle')).toBeInTheDocument();
  });
});
