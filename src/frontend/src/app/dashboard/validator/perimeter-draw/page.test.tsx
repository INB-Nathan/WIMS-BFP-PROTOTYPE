import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import {
  fetchPerimeter,
  fetchPerimeterIncidentOptions,
  fetchRegionalIncident,
} from '@/lib/api';
import ValidatorPerimeterDrawPage from './page';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/dynamic', () => ({
  default: () => function MockPerimeterDrawInner({ incident, error }: {
    incident: { id: number } | null;
    error: string | null;
  }) {
    return <div>{incident ? `Drawing incident ${incident.id}` : error ?? 'No incident selected'}</div>;
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/useNetworkStatus', () => ({ useNetworkStatus: vi.fn() }));
vi.mock('@/lib/api', () => ({
  ApiRequestError: class ApiRequestError extends Error { status = 404; },
  fetchPerimeter: vi.fn(),
  fetchPerimeterIncidentOptions: vi.fn(),
  fetchRegionalIncident: vi.fn(),
}));

const option = {
  incident_id: 42,
  reference_number: 'NCR-2026-0042',
  general_category: 'STRUCTURAL',
  location: 'Quezon City, NCR',
  notification_dt: '2026-07-19T07:00:00Z',
  applied_at: '2026-07-19T08:30:00Z',
  civilian_report_count: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { role: 'NATIONAL_VALIDATOR' },
    loading: false,
    serverValidated: true,
  } as ReturnType<typeof useAuth>);
  vi.mocked(useNetworkStatus).mockReturnValue({ isOnline: true } as ReturnType<typeof useNetworkStatus>);
  vi.mocked(fetchPerimeterIncidentOptions).mockResolvedValue([option]);
  vi.mocked(fetchRegionalIncident).mockResolvedValue({
    incident_id: 42,
    verification_status: 'VERIFIED',
    region_id: 13,
    latitude: 14.65,
    longitude: 121.05,
    reference_number: option.reference_number,
    incident_type_code: null,
    parent_incident_id: null,
    is_duplicate: false,
    duplicate_of: null,
    is_wildland: false,
    wildland_fire_type: null,
    wildland_area_hectares: null,
    wildland_area_display: null,
    created_at: option.notification_dt,
    updated_at: option.applied_at,
    nonsensitive: { general_category: 'STRUCTURAL', province_district: 'NCR' },
    sensitive: {},
    rejection_reason: null,
    rejection_at: null,
  });
  vi.mocked(fetchPerimeter).mockResolvedValue(null as never);
});

describe('Validator perimeter incident selection', () => {
  it('uses a civilian-report-backed dropdown and shows incident context', async () => {
    const user = userEvent.setup();
    render(<ValidatorPerimeterDrawPage />);

    const select = await screen.findByRole('combobox', { name: 'Verified incident' });
    expect(screen.queryByLabelText('Verified incident ID')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull();

    await user.selectOptions(select, '42');

    await waitFor(() => expect(fetchRegionalIncident).toHaveBeenCalledWith(42));
    expect(await screen.findByText('Drawing incident 42')).toBeInTheDocument();
    expect(screen.getByText(/Location:/).parentElement).toHaveTextContent('Quezon City, NCR');
    expect(screen.getByText(/Civilian reports applied:/)).toBeInTheDocument();
    expect(screen.getByText(/3 ·/)).toBeInTheDocument();

    await user.selectOptions(select, '');

    expect(screen.getByText('No incident selected')).toBeInTheDocument();
    expect(screen.queryByText('Drawing incident 42')).toBeNull();
  });
});
