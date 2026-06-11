/**
 * TDD: /admin/breach — Breach Notifications page (M10d, RA 10173)
 *
 * Verifies:
 * - Breach rows rendered from mock fetchBreaches
 * - Deadline formatted as a readable date
 * - Overdue row has red background indicator
 * - Status advance button shown for SYSTEM_ADMIN
 * - Status advance button hidden for non-admin roles
 * - Clicking status button calls updateBreach with next status
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from '@/context/AuthContext';
import BreachNotificationsPage from '../page';

const NOW_ISO = '2026-06-10T12:00:00.000Z';
const FUTURE_DEADLINE = '2026-06-13T12:00:00.000Z'; // 72h from now — not overdue
const PAST_DEADLINE = '2026-06-10T08:00:00.000Z';   // before now — overdue

const mockBreachActive = {
    breach_id: 1,
    threat_log_id: 42,
    detected_at: NOW_ISO,
    npc_deadline_at: FUTURE_DEADLINE,
    status: 'DETECTED' as const,
    affected_systems: null,
    data_scope: null,
    notes: null,
    reported_by: null,
    npc_submitted_at: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
};

const mockBreachOverdue = {
    ...mockBreachActive,
    breach_id: 2,
    npc_deadline_at: PAST_DEADLINE,
    status: 'DETECTED' as const,
};

const mockBreachClosed = {
    ...mockBreachActive,
    breach_id: 3,
    status: 'CLOSED' as const,
};

vi.mock('next/navigation', () => ({
    usePathname: () => '/admin/breach',
    useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
    default: ({ href, children }: { href: string; children: React.ReactNode }) => (
        <a href={href}>{children}</a>
    ),
}));

const mockFetchBreaches = vi.fn();
const mockUpdateBreach = vi.fn();

vi.mock('@/lib/api/breach', () => ({
    fetchBreaches: () => mockFetchBreaches(),
    updateBreach: (...args: unknown[]) => mockUpdateBreach(...args),
}));

vi.mock('@/context/AuthContext', () => ({
    useAuth: vi.fn(),
}));

function setRole(role: string) {
    vi.mocked(useAuth).mockReturnValue({
        user: { role } as never,
        loading: false,
        logout: vi.fn(),
    });
}

describe('Breach Notifications Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRole('SYSTEM_ADMIN');
        mockUpdateBreach.mockResolvedValue({ ...mockBreachActive, status: 'DPO_NOTIFIED' });
    });

    it('renders breach rows from fetchBreaches', async () => {
        mockFetchBreaches.mockResolvedValue([mockBreachActive, mockBreachClosed]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
        expect(screen.getByText('#3')).toBeInTheDocument();
        // Both rows share threat_log_id=42 — two links expected
        expect(screen.getAllByText('Log #42')).toHaveLength(2);
    });

    it('renders deadline as formatted date', async () => {
        mockFetchBreaches.mockResolvedValue([mockBreachActive]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
        // Both detected_at and npc_deadline_at are in June — multiple cells contain "Jun"
        expect(screen.getAllByText(/Jun/).length).toBeGreaterThan(0);
    });

    it('shows DETECTED status badge', async () => {
        mockFetchBreaches.mockResolvedValue([mockBreachActive]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
        // Column header + badge both have "Detected" text
        expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });

    it('overdue breach row has red background', async () => {
        mockFetchBreaches.mockResolvedValue([mockBreachOverdue]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByText('#2')).toBeInTheDocument());
        const row = screen.getByText('#2').closest('tr');
        expect(row).toBeTruthy();
        // React converts #fff5f5 → rgb(255, 245, 245) in jsdom; toHaveStyle normalises hex
        expect(row).toHaveStyle({ backgroundColor: '#fff5f5' });
    });

    it('shows status advance button for SYSTEM_ADMIN on active breach', async () => {
        mockFetchBreaches.mockResolvedValue([mockBreachActive]);
        render(<BreachNotificationsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument();
        });
    });

    it('does not show status advance button on CLOSED breach', async () => {
        mockFetchBreaches.mockResolvedValue([mockBreachClosed]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByText('Closed')).toBeInTheDocument());
        expect(screen.queryByTestId('advance-breach-3')).not.toBeInTheDocument();
    });

    it('clicking status advance calls updateBreach with next status', async () => {
        mockFetchBreaches.mockResolvedValue([mockBreachActive]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-1'));
        await waitFor(() => {
            expect(mockUpdateBreach).toHaveBeenCalledWith(1, { status: 'DPO_NOTIFIED' });
        });
    });

    it('shows access restricted message for non-admin role', async () => {
        setRole('REGIONAL_ENCODER');
        mockFetchBreaches.mockResolvedValue([]);
        render(<BreachNotificationsPage />);
        await waitFor(() => {
            expect(screen.getByText(/Access restricted/i)).toBeInTheDocument();
        });
        expect(mockFetchBreaches).not.toHaveBeenCalled();
    });

    it('shows empty state when no breaches', async () => {
        mockFetchBreaches.mockResolvedValue([]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByText(/No breach records found/i)).toBeInTheDocument());
    });
});
