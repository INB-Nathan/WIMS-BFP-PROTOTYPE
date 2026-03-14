/**
 * TDD: Analyze with AI in Admin Hub Threat Telemetry
 *
 * Verifies that on /admin/system, in the Threat Telemetry table:
 * - Logs with xai_narrative === null show an "Analyze with AI" button
 * - Clicking it shows loading state, calls the API, and displays xai_narrative and xai_confidence in the modal
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminSystemPage from './page';

const mockLogWithoutNarrative = {
    log_id: 1,
    timestamp: '2025-03-14T10:00:00Z',
    source_ip: '192.168.1.1',
    destination_ip: '10.0.0.1',
    suricata_sid: 2000001,
    severity_level: 'HIGH',
    raw_payload: 'test payload',
    xai_narrative: null,
    xai_confidence: null,
    admin_action_taken: null,
    resolved_at: null,
    reviewed_by: null,
};

const mockLogWithNarrative = {
    ...mockLogWithoutNarrative,
    log_id: 2,
    xai_narrative: 'Suspicious outbound connection detected.',
    xai_confidence: 0.85,
};

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

const mockFetchAdminSecurityLogs = vi.fn();
const mockAnalyzeSecurityLog = vi.fn();
const mockFetchAdminUsers = vi.fn();
const mockFetchAuditLogs = vi.fn();

vi.mock('@/lib/api', () => ({
    fetchAdminUsers: () => mockFetchAdminUsers(),
    updateAdminUser: vi.fn(),
    fetchAdminSecurityLogs: () => mockFetchAdminSecurityLogs(),
    updateAdminSecurityLog: vi.fn(),
    fetchAuditLogs: () => mockFetchAuditLogs(),
    analyzeSecurityLog: (logId: number) => mockAnalyzeSecurityLog(logId),
}));

describe('Admin System — Analyze with AI in Threat Telemetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchAdminUsers.mockResolvedValue([]);
        mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
    });

    it('shows "Analyze with AI" button for logs with xai_narrative === null', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogWithoutNarrative, mockLogWithNarrative]);

        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
        });

        // Log 1 has xai_narrative null → should show Analyze with AI
        const analyzeButtons = screen.getAllByRole('button', { name: /Analyze with AI/i });
        expect(analyzeButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('clicking Analyze with AI shows loading state, calls API, and displays narrative and confidence in modal', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogWithoutNarrative]);
        mockAnalyzeSecurityLog.mockImplementation(
            () =>
                new Promise((resolve) =>
                    setTimeout(
                        () =>
                            resolve({
                                log_id: 1,
                                xai_narrative: 'AI-generated narrative for test.',
                                xai_confidence: 0.92,
                            }),
                        50
                    )
                )
        );

        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
        });

        // Click View to open modal
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Suricata Alert #1/)).toBeInTheDocument();
        });

        // In modal: click Analyze with AI (use getAllByRole since both table row and modal have the button)
        const analyzeButtons = screen.getAllByRole('button', { name: /Analyze with AI/i });
        const modalAnalyzeBtn = analyzeButtons[analyzeButtons.length - 1]; // Modal button is last
        fireEvent.click(modalAnalyzeBtn);

        // Loading state (both table and modal show Analyzing…)
        await waitFor(() => {
            const analyzingButtons = screen.getAllByRole('button', { name: /Analyzing…/i });
            expect(analyzingButtons.length).toBeGreaterThanOrEqual(1);
        });

        // API called
        expect(mockAnalyzeSecurityLog).toHaveBeenCalledWith(1);

        // After response: narrative and confidence displayed
        await waitFor(() => {
            expect(screen.getByText('AI-generated narrative for test.')).toBeInTheDocument();
        });
        await waitFor(() => {
            expect(screen.getByText(/Confidence: 92\.0%/)).toBeInTheDocument(); // confidence 0.92 → 92%
        });
    });
});
