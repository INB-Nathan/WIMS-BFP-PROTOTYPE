/**
 * TDD: HITL Decision Buttons in Admin Hub Threat Telemetry
 *
 * Verifies that on /admin/system, in the Threat Telemetry modal:
 * - Logs without admin_action_taken show 3 decision buttons
 * - "Confirm Threat" calls updateAdminSecurityLog with { action: 'CONFIRM_THREAT' }
 * - "False Positive" calls updateAdminSecurityLog with { action: 'FALSE_POSITIVE' }
 * - "Request More Info" reveals a note input + confirm button
 * - Clicking confirm on Request More Info calls updateAdminSecurityLog with { action: 'REQUEST_MORE_INFO', note: ... }
 * - Logs WITH admin_action_taken show read-only display (no buttons)
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminSystemPage from './page';

const mockLogUnactioned = {
    log_id: 1,
    timestamp: '2025-03-14T10:00:00Z',
    source_ip: '192.168.1.1',
    destination_ip: '10.0.0.1',
    suricata_sid: 2000001,
    severity_level: 'HIGH',
    raw_payload: 'test payload',
    xai_narrative: 'Suspicious outbound connection.',
    xai_confidence: 0.85,
    admin_action_taken: null,
    resolved_at: null,
    reviewed_by: null,
    hitl_decision: null,
};

const mockLogActioned = {
    ...mockLogUnactioned,
    log_id: 2,
    admin_action_taken: 'Confirmed Threat',
    resolved_at: '2025-03-14T12:00:00Z',
    reviewed_by: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    hitl_decision: { action: 'CONFIRM_THREAT', reviewed_by: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', reviewed_at: '2025-03-14T12:00:00Z', note: null },
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
const mockUpdateAdminSecurityLog = vi.fn();
const mockAnalyzeSecurityLog = vi.fn();
const mockCreateIncidentFromAlert = vi.fn();
const mockFetchAdminUsers = vi.fn();
const mockFetchAuditLogs = vi.fn();

vi.mock('@/lib/api', () => ({
    fetchAdminUsers: () => mockFetchAdminUsers(),
    updateAdminUser: vi.fn(),
    fetchAdminSecurityLogs: () => mockFetchAdminSecurityLogs(),
    updateAdminSecurityLog: (...args: unknown[]) => mockUpdateAdminSecurityLog(...args),
    fetchAuditLogs: () => mockFetchAuditLogs(),
    analyzeSecurityLog: (logId: number) => mockAnalyzeSecurityLog(logId),
    createIncidentFromAlert: (logId: number) => mockCreateIncidentFromAlert(logId),
    // Stubs required by AdminSystemPage mount (added in PR #125, now in master)
    fetchSystemHealth: vi.fn().mockResolvedValue({
        status: 'HEALTHY',
        components: {
            database: { status: 'HEALTHY', latency_ms: 1 },
            redis: { status: 'HEALTHY', latency_ms: 1 },
            keycloak: { status: 'HEALTHY', latency_ms: 1 },
        },
    }),
    fetchSystemMetrics: vi.fn().mockResolvedValue({
        cpu_percent: 10,
        memory: { total_mb: 8000, used_mb: 2000, percent: 25 },
        disk: { total_gb: 100, used_gb: 40, percent: 40 },
    }),
    fetchWorkerStatus: vi.fn().mockResolvedValue([]),
    fetchRegions: vi.fn().mockResolvedValue([]),
    fetchActiveSessions: vi.fn().mockResolvedValue([]),
    fetchUserSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    terminateUserSessions: vi.fn(),
    revokeUserSessions: vi.fn(),
}));

describe('Admin System — HITL Decision Buttons in Threat Telemetry Modal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchAdminUsers.mockResolvedValue([]);
        mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
        mockUpdateAdminSecurityLog.mockResolvedValue({ status: 'ok', log_id: 1 });
        mockCreateIncidentFromAlert.mockResolvedValue({ status: 'ok', incident_id: 42 });
    });

    it('shows three decision buttons for unactioned logs', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogUnactioned]);
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => {
            expect(screen.getByText('Suricata Alert #1')).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: /Confirm Threat/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /False Positive/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Request More Info/i })).toBeInTheDocument();
    });

    it('clicking "Confirm Threat" calls updateAdminSecurityLog with action CONFIRM_THREAT', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogUnactioned]);
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText('Suricata Alert #1')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm Threat/i }));
        await waitFor(() => {
            expect(mockUpdateAdminSecurityLog).toHaveBeenCalledWith(1, { action: 'CONFIRM_THREAT', note: undefined });
        });
    });

    it('clicking "False Positive" calls updateAdminSecurityLog with action FALSE_POSITIVE', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogUnactioned]);
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText('Suricata Alert #1')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /False Positive/i }));
        await waitFor(() => {
            expect(mockUpdateAdminSecurityLog).toHaveBeenCalledWith(1, { action: 'FALSE_POSITIVE', note: undefined });
        });
    });

    it('clicking "Request More Info" reveals a note input and confirm button', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogUnactioned]);
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText('Suricata Alert #1')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Request More Info/i }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Confirm/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
        });
    });

    it('confirming Request More Info with a note calls updateAdminSecurityLog with note', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogUnactioned]);
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText('Suricata Alert #1')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Request More Info/i }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm/i })).toBeInTheDocument());
        const noteTextarea = screen.getByRole('textbox');
        fireEvent.change(noteTextarea, { target: { value: 'Check source IP and port' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
        await waitFor(() => {
            expect(mockUpdateAdminSecurityLog).toHaveBeenCalledWith(1, { action: 'REQUEST_MORE_INFO', note: 'Check source IP and port' });
        });
    });

    it('shows read-only display for already-actioned logs (no buttons)', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogActioned]);
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => {
            expect(screen.getByText('Suricata Alert #2')).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: /Confirm Threat/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /False Positive/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Request More Info/i })).not.toBeInTheDocument();
    });

    it('clicking "Create Incident from Alert" calls createIncidentFromAlert with log_id', async () => {
        mockCreateIncidentFromAlert.mockResolvedValue({ status: 'ok', incident_id: 42 });
        mockFetchAdminSecurityLogs.mockResolvedValue([mockLogUnactioned]);
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = screen.getAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText('Suricata Alert #1')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Create Incident from Alert/i }));
        await waitFor(() => {
            expect(mockCreateIncidentFromAlert).toHaveBeenCalledWith(1);
        });
    });
});
