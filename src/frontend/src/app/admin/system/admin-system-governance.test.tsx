/**
 * TDD: Identity Governance filters, pagination, edit modal, and role cleanup (#346)
 * plus Active Sessions username filter and pagination (#347).
 */
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdminSystemPage from './page';

const mockUsers = [
    { user_id: 'u1', keycloak_id_masked: null, username: 'encoder_juan', role: 'REGIONAL_ENCODER', assigned_region_id: 1, is_active: true, created_at: '2025-01-01T00:00:00Z' },
    { user_id: 'u2', keycloak_id_masked: null, username: 'validator_maria', role: 'NATIONAL_VALIDATOR', assigned_region_id: 2, is_active: true, created_at: '2025-01-02T00:00:00Z' },
    { user_id: 'u3', keycloak_id_masked: null, username: 'analyst_pedro', role: 'NATIONAL_ANALYST', assigned_region_id: null, is_active: false, created_at: '2025-01-03T00:00:00Z' },
    { user_id: 'u4', keycloak_id_masked: null, username: 'admin_sys', role: 'SYSTEM_ADMIN', assigned_region_id: null, is_active: true, created_at: '2025-01-04T00:00:00Z' },
    { user_id: 'u5', keycloak_id_masked: null, username: 'encoder_ana', role: 'REGIONAL_ENCODER', assigned_region_id: 3, is_active: true, created_at: '2025-01-05T00:00:00Z' },
    { user_id: 'u6', keycloak_id_masked: null, username: 'encoder_bob', role: 'REGIONAL_ENCODER', assigned_region_id: 1, is_active: false, created_at: '2025-01-06T00:00:00Z' },
    { user_id: 'u7', keycloak_id_masked: null, username: 'validator_leo', role: 'NATIONAL_VALIDATOR', assigned_region_id: 2, is_active: true, created_at: '2025-01-07T00:00:00Z' },
    { user_id: 'u8', keycloak_id_masked: null, username: 'encoder_chris', role: 'REGIONAL_ENCODER', assigned_region_id: 3, is_active: true, created_at: '2025-01-08T00:00:00Z' },
    { user_id: 'u9', keycloak_id_masked: null, username: 'encoder_dan', role: 'REGIONAL_ENCODER', assigned_region_id: 1, is_active: true, created_at: '2025-01-09T00:00:00Z' },
    { user_id: 'u10', keycloak_id_masked: null, username: 'encoder_eve', role: 'REGIONAL_ENCODER', assigned_region_id: 2, is_active: true, created_at: '2025-01-10T00:00:00Z' },
    { user_id: 'u11', keycloak_id_masked: null, username: 'encoder_frank', role: 'REGIONAL_ENCODER', assigned_region_id: 1, is_active: false, created_at: '2025-01-11T00:00:00Z' },
    { user_id: 'u12', keycloak_id_masked: null, username: 'encoder_gina', role: 'REGIONAL_ENCODER', assigned_region_id: 3, is_active: true, created_at: '2025-01-12T00:00:00Z' },
];

const mockRegions = [
    { region_id: 1, region_name: 'NCR', region_code: 'NCR' },
    { region_id: 2, region_name: 'Region IV-A', region_code: 'R4A' },
    { region_id: 3, region_name: 'Region VII', region_code: 'R7' },
];

const mockSessions = [
    { session_id: 's1', user_id: 'u1', username: 'session_user_1', role: 'REGIONAL_ENCODER', ip_address: '192.168.1.1', last_access: '2025-06-16T10:00:00Z', clients: {} },
    { session_id: 's2', user_id: 'u2', username: 'session_user_2', role: 'NATIONAL_VALIDATOR', ip_address: '192.168.1.2', last_access: '2025-06-16T10:05:00Z', clients: {} },
];

// Helpers to scope queries to specific sections
function governanceSection() {
    const el = document.getElementById('governance');
    if (!el) throw new Error('Governance section not found');
    return within(el);
}

function sessionsSection() {
    const el = document.getElementById('sessions');
    if (!el) throw new Error('Sessions section not found');
    return within(el);
}

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({
        user: { role: 'SYSTEM_ADMIN' },
        loading: false,
        logout: vi.fn(),
    }),
}));

const mockFetchAdminUsers = vi.fn();
const mockFetchRegions = vi.fn();
const mockFetchActiveSessions = vi.fn();
const mockUpdateAdminUser = vi.fn();

vi.mock('@/lib/useNetworkStatus', () => ({
    useNetworkStatus: () => ({ isOnline: true, isReconnecting: false }),
}));

vi.mock('@/lib/connectivity', () => ({
    getConnectivitySnapshot: () => ({ state: 'online' as const, isOnline: true, isChecking: false, isReconnecting: false, lastCheckedAt: Date.now() }),
    subscribeConnectivity: vi.fn(() => vi.fn()),
    probeConnectivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api', () => ({
    fetchAdminUsers: () => mockFetchAdminUsers(),
    updateAdminUser: (...args: unknown[]) => mockUpdateAdminUser(...args),
    createAdminUser: vi.fn(),
    fetchAdminSecurityLogs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    updateAdminSecurityLog: vi.fn(),
    fetchAuditLogs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    fetchAuditLogsOfflineAware: vi.fn().mockResolvedValue({ response: { items: [], total: 0 }, fromCache: false }),
    analyzeSecurityLog: vi.fn(),
    createIncidentFromAlert: vi.fn(),
    fetchRegions: () => mockFetchRegions(),
    fetchUserSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    terminateUserSessions: vi.fn(),
    KeycloakSession: {},
    fetchActiveSessions: () => mockFetchActiveSessions(),
    fetchActiveSessionsOfflineAware: async () => ({ response: await mockFetchActiveSessions(), fromCache: false }),
    revokeUserSessions: vi.fn(),
    fetchSystemHealth: vi.fn().mockResolvedValue({
        status: 'HEALTHY',
        components: { database: { status: 'HEALTHY', latency_ms: 1 }, redis: { status: 'HEALTHY', latency_ms: 1 }, keycloak: { status: 'HEALTHY', latency_ms: 1 } },
    }),
    fetchSystemHealthOfflineAware: vi.fn().mockResolvedValue({
        response: { status: 'HEALTHY', components: { database: { status: 'HEALTHY', latency_ms: 1 }, redis: { status: 'HEALTHY', latency_ms: 1 }, keycloak: { status: 'HEALTHY', latency_ms: 1 } } },
        fromCache: false,
    }),
    fetchSystemMetrics: vi.fn().mockResolvedValue({ cpu_percent: 10, memory: { total_mb: 8000, used_mb: 2000, percent: 25 }, disk: { total_gb: 100, used_gb: 40, percent: 40 } }),
    fetchSystemMetricsOfflineAware: vi.fn().mockResolvedValue({ response: { cpu_percent: 10, memory: { total_mb: 8000, used_mb: 2000, percent: 25 }, disk: { total_gb: 100, used_gb: 40, percent: 40 } }, fromCache: false }),
    fetchWorkerStatus: vi.fn().mockResolvedValue([]),
    fetchWorkerStatusOfflineAware: vi.fn().mockResolvedValue({ response: [], fromCache: false }),
    fetchScheduledReports: vi.fn().mockResolvedValue([]),
    createScheduledReport: vi.fn(),
    updateScheduledReport: vi.fn(),
    deleteScheduledReport: vi.fn(),
}));

describe('Identity Governance filters and pagination (#346)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchAdminUsers.mockResolvedValue(mockUsers);
        mockFetchRegions.mockResolvedValue(mockRegions);
        mockFetchActiveSessions.mockResolvedValue(mockSessions);
        mockUpdateAdminUser.mockResolvedValue({});
    });

    afterEach(() => {
        cleanup();
    });

    it('renders filter inputs for username, role, region, and active status', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByLabelText('Filter by username')).toBeInTheDocument();
        });
        expect(governanceSection().getByLabelText('Filter by role')).toBeInTheDocument();
        expect(governanceSection().getByLabelText('Filter by region')).toBeInTheDocument();
        expect(governanceSection().getByLabelText('Filter by active status')).toBeInTheDocument();
    });

    it('username filter narrows the table rows', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
            expect(governanceSection().getByText('validator_maria')).toBeInTheDocument();
        });

        const usernameInput = governanceSection().getByLabelText('Filter by username');
        await userEvent.clear(usernameInput);
        await userEvent.type(usernameInput, 'validator');

        await waitFor(() => {
            expect(governanceSection().queryByText('encoder_juan')).not.toBeInTheDocument();
            expect(governanceSection().getByText('validator_maria')).toBeInTheDocument();
            expect(governanceSection().getByText('validator_leo')).toBeInTheDocument();
        });

        expect(governanceSection().queryByText('encoder_ana')).not.toBeInTheDocument();
    });

    it('role filter narrows to matching roles', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        const roleSelect = governanceSection().getByLabelText('Filter by role');
        await userEvent.selectOptions(roleSelect, 'NATIONAL_VALIDATOR');

        await waitFor(() => {
            expect(governanceSection().queryByText('encoder_juan')).not.toBeInTheDocument();
            expect(governanceSection().getByText('validator_maria')).toBeInTheDocument();
            expect(governanceSection().getByText('validator_leo')).toBeInTheDocument();
        });
    });

    it('active status filter shows only active users', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('analyst_pedro')).toBeInTheDocument();
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        const statusSelect = governanceSection().getByLabelText('Filter by active status');
        await userEvent.selectOptions(statusSelect, 'active');

        await waitFor(() => {
            expect(governanceSection().queryByText('analyst_pedro')).not.toBeInTheDocument();
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        await userEvent.selectOptions(statusSelect, 'inactive');
        await waitFor(() => {
            expect(governanceSection().getByText('analyst_pedro')).toBeInTheDocument();
            expect(governanceSection().queryByText('encoder_juan')).not.toBeInTheDocument();
        });
    });

    it('region filter narrows by assigned region', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByLabelText('Filter by region')).toBeInTheDocument();
        });

        const regionSelect = governanceSection().getByLabelText('Filter by region');
        await userEvent.selectOptions(regionSelect, '1');

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
            expect(governanceSection().queryByText('validator_maria')).not.toBeInTheDocument();
            expect(governanceSection().queryByText('admin_sys')).not.toBeInTheDocument();
        });
    });

    it('pagination shows correct page of results', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('Page 1 of 2')).toBeInTheDocument();
        });

        expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        expect(governanceSection().getByText('encoder_eve')).toBeInTheDocument();

        const nextButton = governanceSection().getByText('Next');
        fireEvent.click(nextButton);

        await waitFor(() => {
            expect(governanceSection().getByText('Page 2 of 2')).toBeInTheDocument();
            expect(governanceSection().getByText('encoder_frank')).toBeInTheDocument();
            expect(governanceSection().getByText('encoder_gina')).toBeInTheDocument();
            expect(governanceSection().queryByText('encoder_juan')).not.toBeInTheDocument();
        });
    });

    it('pagination resets to page 1 when filter changes', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('Page 1 of 2')).toBeInTheDocument();
        });

        fireEvent.click(governanceSection().getByText('Next'));
        await waitFor(() => {
            expect(governanceSection().getByText('Page 2 of 2')).toBeInTheDocument();
        });

        // Filter to a single user so pagination resets
        const usernameInput = governanceSection().getByLabelText('Filter by username');
        await userEvent.clear(usernameInput);
        await userEvent.type(usernameInput, 'admin_sys');

        await waitFor(() => {
            expect(governanceSection().getByText('Page 1 of 1')).toBeInTheDocument();
        });
    });

    it('shows filter-aware empty state when no results match', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        const usernameInput = governanceSection().getByLabelText('Filter by username');
        await userEvent.type(usernameInput, 'nonexistent_user');

        await waitFor(() => {
            expect(governanceSection().getByText('No users match the current filters.')).toBeInTheDocument();
        });
    });

    it('sessions column is absent from Identity Governance table', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Identity Governance')).toBeInTheDocument();
        });

        const gov = document.getElementById('governance')!;
        const headers = gov.querySelectorAll('th');
        const headerTexts = Array.from(headers).map((th) => th.textContent?.trim());
        expect(headerTexts).not.toContain('Sessions');
        expect(headerTexts).toContain('Username');
        expect(headerTexts).toContain('Role');
        expect(headerTexts).toContain('Active');
        expect(headerTexts).toContain('Actions');
    });

    it('edit modal opens with correct user data', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        // Find the Edit button in encoder_juan's row
        const editButtons = governanceSection().getAllByText('Edit');
        fireEvent.click(editButtons[0]);

        await waitFor(() => {
            expect(screen.getByText('Edit User — encoder_juan')).toBeInTheDocument();
        });

        // Role dropdown should show current role
        const roleSelect = screen.getByDisplayValue('REGIONAL_ENCODER') as HTMLSelectElement;
        expect(roleSelect).toBeInTheDocument();

        // Active checkbox should be checked
        const activeCheckbox = screen.getByLabelText('Active') as HTMLInputElement;
        expect(activeCheckbox.checked).toBe(true);
    });

    it('edit modal role dropdown excludes CIVILIAN_REPORTER', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        const editButtons = governanceSection().getAllByText('Edit');
        fireEvent.click(editButtons[0]);

        await waitFor(() => {
            expect(screen.getByText('Edit User — encoder_juan')).toBeInTheDocument();
        });

        const roleSelect = screen.getByDisplayValue('REGIONAL_ENCODER') as HTMLSelectElement;
        const options = Array.from(roleSelect.options).map((o) => o.value);

        expect(options).not.toContain('CIVILIAN_REPORTER');
        expect(options).toContain('REGIONAL_ENCODER');
        expect(options).toContain('NATIONAL_VALIDATOR');
        expect(options).toContain('NATIONAL_ANALYST');
        expect(options).toContain('SYSTEM_ADMIN');
    });

    it('edit modal region dropdown shows region names from fetchRegions', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        const editButtons = governanceSection().getAllByText('Edit');
        fireEvent.click(editButtons[0]);

        await waitFor(() => {
            expect(screen.getByText('Edit User — encoder_juan')).toBeInTheDocument();
        });

        // Find the region select by its label
        const regionLabel = screen.getByText('Assigned Region');
        const regionSelect = regionLabel.parentElement!.querySelector('select') as HTMLSelectElement;
        expect(regionSelect).not.toBeNull();
        expect(regionSelect.value).toBe('1');

        const options = Array.from(regionSelect.options).map((o) => ({ value: o.value, text: o.textContent }));
        expect(options).toContainEqual({ value: '', text: '— No region —' });
        expect(options).toContainEqual({ value: '1', text: 'NCR' });
        expect(options).toContainEqual({ value: '2', text: 'Region IV-A' });
        expect(options).toContainEqual({ value: '3', text: 'Region VII' });
    });

    it('edit modal closes when Cancel is clicked', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(governanceSection().getByText('encoder_juan')).toBeInTheDocument();
        });

        const editButtons = governanceSection().getAllByText('Edit');
        fireEvent.click(editButtons[0]);

        await waitFor(() => {
            expect(screen.getByText('Edit User — encoder_juan')).toBeInTheDocument();
        });

        const cancelButtons = screen.getAllByText('Cancel');
        // The modal Cancel button is the one in the edit modal (not create)
        fireEvent.click(cancelButtons[cancelButtons.length - 1]);

        await waitFor(() => {
            expect(screen.queryByText('Edit User — encoder_juan')).not.toBeInTheDocument();
        });
    });
});

describe('Active Sessions filter and pagination (#347)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchAdminUsers.mockResolvedValue(mockUsers.slice(0, 4));
        mockFetchRegions.mockResolvedValue(mockRegions);
        mockFetchActiveSessions.mockResolvedValue(mockSessions);
        mockUpdateAdminUser.mockResolvedValue({});
    });

    afterEach(() => {
        cleanup();
    });

    it('active sessions section has username filter input', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(sessionsSection().getByText('Active Sessions')).toBeInTheDocument();
        });

        expect(sessionsSection().getByLabelText('Filter sessions by username')).toBeInTheDocument();
    });

    it('username filter narrows active sessions', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(sessionsSection().getByText('session_user_1')).toBeInTheDocument();
            expect(sessionsSection().getByText('session_user_2')).toBeInTheDocument();
        });

        const filterInput = sessionsSection().getByLabelText('Filter sessions by username');
        await userEvent.type(filterInput, 'session_user_2');

        await waitFor(() => {
            expect(sessionsSection().queryByText('session_user_1')).not.toBeInTheDocument();
            expect(sessionsSection().getByText('session_user_2')).toBeInTheDocument();
        });
    });

    it('active sessions shows pagination info', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(sessionsSection().getByText('Active Sessions')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(sessionsSection().getByText(/Showing.*of.*sessions/)).toBeInTheDocument();
        });
    });

    it('sessions are visible in Active Sessions section after governance column removal', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(sessionsSection().getByText('Active Sessions')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(sessionsSection().getByText('session_user_1')).toBeInTheDocument();
            expect(sessionsSection().getByText('192.168.1.1')).toBeInTheDocument();
        });
    });
});
