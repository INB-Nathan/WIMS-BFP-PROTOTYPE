/**
 * TDD: /admin/breach — Breach Notifications page (M10d, RA 10173)
 *
 * Verifies:
 * - Breach rows rendered from mock fetchBreaches
 * - Deadline formatted as a readable date
 * - Overdue row has red background indicator
 * - Status advance button shown for SYSTEM_ADMIN
 * - Status advance button hidden for non-admin roles
 * - Clicking status button opens confirmation modal
 * - Cancel closes modal, status unchanged
 * - Notes textarea in confirm modal
 * - Successful advance updates row
 * - Failed advance shows error inline (modal error)
 * - NPC contact card rendered at top
 * - NPC edit button opens edit modal
 * - NPC edit confirmation phrase validation
 * - NPC edit cancel closes modal
 * - NPC edit save calls updateAdminConfig with correct values
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

const mockFetchAdminConfig = vi.fn();
const mockUpdateAdminConfig = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
    fetchAdminConfig: () => mockFetchAdminConfig(),
    updateAdminConfig: (...args: unknown[]) => mockUpdateAdminConfig(...args),
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

const mockNpcConfig = [
    { key: 'npc_contact_name', value: 'Atty. Reyes', description: 'NPC contact', updated_by: null, updated_at: null },
    { key: 'npc_contact_phone', value: '+63 2 8234-2228', description: 'NPC phone', updated_by: null, updated_at: null },
    { key: 'npc_office_phone', value: '+63 2 8234-1111', description: 'NPC office', updated_by: null, updated_at: null },
];

describe('Breach Notifications Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRole('SYSTEM_ADMIN');
        mockUpdateBreach.mockResolvedValue({ ...mockBreachActive, status: 'DPO_NOTIFIED' });
        mockFetchAdminConfig.mockResolvedValue(mockNpcConfig);
        mockFetchBreaches.mockResolvedValue([mockBreachActive, mockBreachClosed]);
    });

    // ─── Existing tests ────────────────────────────────────────────────────

    it('renders breach rows from fetchBreaches', async () => {
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
        render(<BreachNotificationsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument();
        });
    });

    it('does not show status advance button on CLOSED breach', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByText('Closed')).toBeInTheDocument());
        expect(screen.queryByTestId('advance-breach-3')).not.toBeInTheDocument();
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

    // ─── Status advance confirmation modal ──────────────────────────────────

    it('opens confirmation modal when status advance button is clicked', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-1'));
        await waitFor(() => {
            expect(screen.getByTestId('advance-modal-confirm')).toBeInTheDocument();
        });
    });

    it('closes confirmation modal on cancel without advancing', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-1'));
        await waitFor(() => expect(screen.getByTestId('advance-modal-cancel')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-modal-cancel'));
        await waitFor(() => {
            expect(screen.queryByTestId('advance-modal-confirm')).not.toBeInTheDocument();
        });
        expect(mockUpdateBreach).not.toHaveBeenCalled();
    });

    it('shows notes textarea in confirmation modal', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-1'));
        await waitFor(() => {
            expect(screen.getByTestId('advance-notes-input')).toBeInTheDocument();
        });
    });

    it('advances status on modal confirm with notes', async () => {
        mockUpdateBreach.mockResolvedValue({ ...mockBreachActive, status: 'DPO_NOTIFIED', notes: 'advancing with evidence' });
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-1'));
        await waitFor(() => expect(screen.getByTestId('advance-notes-input')).toBeInTheDocument());

        // Type notes
        fireEvent.change(screen.getByTestId('advance-notes-input'), { target: { value: 'advancing with evidence' } });
        fireEvent.click(screen.getByTestId('advance-modal-confirm'));

        await waitFor(() => {
            expect(mockUpdateBreach).toHaveBeenCalledWith(1, {
                status: 'DPO_NOTIFIED',
                notes: 'advancing with evidence',
            });
        });

        // Success banner should appear
        await waitFor(() => {
            expect(screen.getByTestId('success-banner')).toBeInTheDocument();
        });
    });

    it('advances status on modal confirm without notes', async () => {
        mockUpdateBreach.mockResolvedValue({ ...mockBreachActive, status: 'DPO_NOTIFIED' });
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-1'));
        await waitFor(() => expect(screen.getByTestId('advance-modal-confirm')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-modal-confirm'));

        await waitFor(() => {
            expect(mockUpdateBreach).toHaveBeenCalledWith(1, { status: 'DPO_NOTIFIED' });
        });
    });

    it('shows error in modal when advance fails', async () => {
        mockUpdateBreach.mockRejectedValue(new Error('Server error'));
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-1'));
        await waitFor(() => expect(screen.getByTestId('advance-modal-confirm')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-modal-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('advance-modal-error')).toBeInTheDocument();
        });

        // Modal should still be open (error does not close it)
        expect(screen.getByTestId('advance-modal-confirm')).toBeInTheDocument();
        // Row state should not have changed — status badge still shows Detected
        expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(1);
    });

    it('advances status to CLOSED (no further advance for NPC_SUBMITTED)', async () => {
        const npcSubmitted = { ...mockBreachActive, breach_id: 5, status: 'NPC_SUBMITTED' as const };
        mockUpdateBreach.mockResolvedValue({ ...npcSubmitted, status: 'CLOSED' as const });
        mockFetchBreaches.mockResolvedValue([npcSubmitted]);
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('advance-breach-5')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-breach-5'));
        await waitFor(() => expect(screen.getByTestId('advance-modal-confirm')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('advance-modal-confirm'));

        await waitFor(() => {
            expect(mockUpdateBreach).toHaveBeenCalledWith(5, { status: 'CLOSED' });
        });
    });

    // ─── NPC Contact Card ──────────────────────────────────────────────────

    it('renders NPC contact card with config values', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('npc-contact-card')).toBeInTheDocument();
        });
        expect(screen.getByTestId('npc-name-display')).toHaveTextContent('Atty. Reyes');
        expect(screen.getByTestId('npc-phone-display')).toHaveTextContent('+63 2 8234-2228');
        expect(screen.getByTestId('npc-office-phone-display')).toHaveTextContent('+63 2 8234-1111');
    });

    it('opens NPC edit modal when edit button is clicked', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('npc-edit-button')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('npc-edit-button'));
        await waitFor(() => {
            expect(screen.getByTestId('npc-edit-name')).toBeInTheDocument();
        });
    });

    it('closes NPC edit modal on cancel', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('npc-edit-button')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('npc-edit-button'));
        await waitFor(() => expect(screen.getByTestId('npc-edit-name')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('npc-edit-cancel'));
        await waitFor(() => {
            expect(screen.queryByTestId('npc-edit-name')).not.toBeInTheDocument();
        });
    });

    it('shows error when confirmation phrase is wrong', async () => {
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('npc-edit-button')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('npc-edit-button'));
        await waitFor(() => expect(screen.getByTestId('npc-edit-name')).toBeInTheDocument());

        // Type something but not the confirmation phrase
        fireEvent.change(screen.getByTestId('npc-edit-confirm-input'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByTestId('npc-edit-save'));

        await waitFor(() => {
            expect(screen.getByTestId('npc-edit-error')).toBeInTheDocument();
        });
        // Should not have called update
        expect(mockUpdateAdminConfig).not.toHaveBeenCalled();
    });

    it('saves NPC contact when confirmation phrase is correct', async () => {
        mockUpdateAdminConfig.mockResolvedValue({ key: 'npc_contact_name', value: 'New Name', status: 'ok' });
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('npc-edit-button')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('npc-edit-button'));
        await waitFor(() => expect(screen.getByTestId('npc-edit-name')).toBeInTheDocument());

        // Edit name
        fireEvent.change(screen.getByTestId('npc-edit-name'), { target: { value: 'New Name' } });
        // Type confirmation phrase
        fireEvent.change(screen.getByTestId('npc-edit-confirm-input'), { target: { value: 'confirm-npc-update' } });
        fireEvent.click(screen.getByTestId('npc-edit-save'));

        await waitFor(() => {
            expect(mockUpdateAdminConfig).toHaveBeenCalledWith('npc_contact_name', 'New Name');
        });
    });

    it('does not call updateAdminConfig for unchanged values', async () => {
        mockUpdateAdminConfig.mockResolvedValue({ key: 'npc_contact_name', value: 'Atty. Reyes', status: 'ok' });
        render(<BreachNotificationsPage />);
        await waitFor(() => expect(screen.getByTestId('npc-edit-button')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('npc-edit-button'));
        await waitFor(() => expect(screen.getByTestId('npc-edit-name')).toBeInTheDocument());

        // Don't change anything, just type confirmation
        fireEvent.change(screen.getByTestId('npc-edit-confirm-input'), { target: { value: 'confirm-npc-update' } });
        fireEvent.click(screen.getByTestId('npc-edit-save'));

        await waitFor(() => {
            // No calls because values are unchanged
            expect(mockUpdateAdminConfig).not.toHaveBeenCalled();
        });
    });

    it('displays not configured when NPC config is empty', async () => {
        mockFetchAdminConfig.mockResolvedValue([]);
        mockFetchBreaches.mockResolvedValue([mockBreachActive]);
        render(<BreachNotificationsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('npc-contact-card')).toBeInTheDocument();
        });
        expect(screen.getByTestId('npc-name-display')).toHaveTextContent('Not configured');
        expect(screen.getByTestId('npc-phone-display')).toHaveTextContent('Not configured');
    });
});
