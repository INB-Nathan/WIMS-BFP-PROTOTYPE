import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendCivilianReport } from '@/lib/api';

const mockRouterReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn(), replace: mockRouterReplace }),
}));

// Mock next/image
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// Mock next/link
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    <a href={href} {...rest}>{children}</a>,
}));

// Mock API
vi.mock('@/lib/api', () => ({
  fetchClusters: vi.fn().mockResolvedValue({ clusters: [] }),
  fetchCivilianDuplicateSuggestions: vi.fn().mockResolvedValue([]),
  submitCivilianReportV2: vi.fn().mockResolvedValue({ report_id: 1 }),
  appendCivilianReport: vi.fn().mockResolvedValue({}),
  fetchReportStatus: vi.fn().mockResolvedValue({
    report_id: 42,
    latitude: 14.5,
    longitude: 121,
    category: 'STRUCTURAL',
    sub_category: null,
    reporting_context: 'WITNESS',
    safety_status: 'I_AM_SAFE',
    status: 'PENDING',
    created_at: '2026-06-20T08:00:00Z',
  }),
  fetchReportClusters: vi.fn().mockResolvedValue({ areas: [], mode: 'national', stale: false, degraded: false }),
  fetchEmergencyServices: vi.fn().mockResolvedValue({ emergency_number: '911' }),
}));

// Mock react-leaflet (heavy dependency)
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle-marker">{children}</div>
  ),
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="marker">{children}</div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
  useMapEvents: () => ({
    getBounds: () => ({
      getNorthEast: () => ({ lat: 15, lng: 122 }),
      getSouthWest: () => ({ lat: 14, lng: 120 }),
    }),
    getZoom: () => 10,
  }),
}));

// Mock MapPicker (used in Context step)
let mapPickerChange: ((lat: number, lng: number) => void) | null = null;
vi.mock('@/components/MapPicker', () => ({
  MapPicker: ({ onChange }: { onChange?: (lat: number, lng: number) => void }) => {
    // Store the onChange callback so tests can simulate pin drop
    mapPickerChange = onChange ?? null;
    return <div data-testid="map-picker" />;
  },
}));

// Mock CalmEmergencyBlock
vi.mock('../CalmEmergencyBlock', () => ({
  CalmEmergencyBlock: () => <div data-testid="calm-block" />,
}));

// Mock EmergencyReferenceCard
vi.mock('@/components/EmergencyReferenceCard', () => ({
  EmergencyReferenceCard: ({ compact }: { compact?: boolean }) =>
    <div data-testid="emergency-card">{compact ? 'compact' : 'full'}</div>,
}));

describe('ReportPage — submitted-screen append', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    mapPickerChange = null;
  });

  it('submits an update from the submitted success screen', async () => {
    const user = userEvent.setup();
    localStorage.setItem('wims_civilian_device_id', 'device-a');

    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    // Safety step — select 'I am safe', then Continue
    fireEvent.click(screen.getByText('I am safe'));
    fireEvent.click(screen.getByText('Continue'));

    // Context step — select WITNESS, simulate pin via mapPickerChange
    await screen.findByText('How did you learn about this fire?');
    fireEvent.click(screen.getByText('I saw it happen'));
    await waitFor(() => expect(mapPickerChange).not.toBeNull());
    mapPickerChange!(14.5, 121);
    fireEvent.click(screen.getByText('Continue'));

    // Category step
    await screen.findByText('What type of fire is this?');
    fireEvent.click(screen.getByText('Structural'));
    fireEvent.click(screen.getByText('Continue'));

    // Details step — has Review & Submit button
    await screen.findByText('Observed time (optional)');
    fireEvent.click(screen.getByText('Review & Submit'));

    // Review step
    await screen.findByText('Review Your Report');
    fireEvent.click(screen.getByText('Submit Report'));

    // Submitted screen
    await screen.findByText('Report Submitted');
    expect(screen.getByText(/Report #1 has been received/)).toBeInTheDocument();

    // Append from the submitted screen
    await user.type(
      screen.getByPlaceholderText('Describe any new information... / Ilarawan ang anumang bagong impormasyon...'),
      'Fire seems to be spreading northwards.',
    );
    fireEvent.click(screen.getByText('Submit Update / Magsumite ng Update'));

    await waitFor(() => {
      expect(appendCivilianReport).toHaveBeenCalledWith(1, expect.objectContaining({
        latitude: 14.5,
        longitude: 121,
        category: 'STRUCTURAL',
        reporting_context: 'WITNESS',
        safety_status: 'I_AM_SAFE',
        device_id: 'device-a',
        description: 'Fire seems to be spreading northwards.',
      }));
    });
  });
});

describe('ReportPage — Safety step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
  });

  it('renders Nearby fire activity heading and disclaimer in Safety step', async () => {
    // Dynamic import to let module-level mocks initialize first
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    // ReportPage starts at step='safety', so these should be visible on initial render
    expect(screen.getByText('Nearby fire activity / Mga kalapit na sunog')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Based on nearby public reports awaiting review. Not yet confirmed by BFP.',
      ),
    ).toBeInTheDocument();
  });

  it('does not render removed Public Fire Report Areas card', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    // The "Public Fire Report Areas" heading was rendered by NearbyPublicReportAreas
    // which is now removed. Ensure it's not in the DOM.
    expect(screen.queryByText('Public Fire Report Areas')).not.toBeInTheDocument();
  });

  it('renders Safety status cards for user selection', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    // Key safety status options should be visible
    expect(screen.getByText('I am safe')).toBeInTheDocument();
    expect(screen.getByText('I need help')).toBeInTheDocument();
    expect(screen.getByText('I am not sure')).toBeInTheDocument();
  });

  it('submits an update against the report id from the query string', async () => {
    const user = userEvent.setup();
    localStorage.setItem('wims_civilian_device_id', 'device-a');
    mockSearchParams = new URLSearchParams('update_report_id=42');

    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    await screen.findByText('Update Report #42');
    await user.type(screen.getByLabelText('Additional Information *'), 'Smoke is getting heavier.');
    await user.click(screen.getByRole('button', { name: 'Submit Update' }));

    await waitFor(() => {
      expect(appendCivilianReport).toHaveBeenCalledWith(42, expect.objectContaining({
        latitude: 14.5,
        longitude: 121,
        category: 'STRUCTURAL',
        reporting_context: 'WITNESS',
        safety_status: 'I_AM_SAFE',
        device_id: 'device-a',
        description: 'Smoke is getting heavier.',
      }));
    });
  });

  it('cancel exits update mode and returns to the main safety screen', async () => {
    localStorage.setItem('wims_civilian_device_id', 'device-a');
    mockSearchParams = new URLSearchParams('update_report_id=42');

    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    await screen.findByText('Update Report #42');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockRouterReplace).toHaveBeenCalledWith('/');
    expect(screen.getByText('Are you or anyone else in danger?')).toBeInTheDocument();
  });
});
