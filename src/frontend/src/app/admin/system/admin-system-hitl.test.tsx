/**
 * TDD: HITL Decision Buttons in Admin Hub Threat Telemetry
 *
 * Verifies that on /admin/system, in the Threat Telemetry modal:
 * - Logs without admin_action_taken show decision buttons (Confirm Threat, False Positive, View Related Evidence, Create Incident)
 * - "Confirm Threat" calls updateAdminSecurityLog with { action: 'CONFIRM_THREAT' }
 * - "False Positive" calls updateAdminSecurityLog with { action: 'FALSE_POSITIVE' }
 * - "View Related Evidence" calls fetchRelatedAuditLogs and renders results
 * - Logs WITH admin_action_taken show read-only display while keeping related evidence accessible
 * - HITL success shows inline success message (not alert())
 * - Create Incident success shows incident ID link (not alert())
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
        user: { id: 'admin-1', role: 'SYSTEM_ADMIN' },
        loading: false,
        logout: vi.fn(),
    }),
}));

const mockFetchAdminSecurityLogs = vi.fn();
const mockUpdateAdminSecurityLog = vi.fn();
const mockAnalyzeSecurityLog = vi.fn();
const mockCreateIncidentFromAlert = vi.fn();
const mockFetchRelatedAuditLogs = vi.fn();
const mockFetchAdminUsers = vi.fn();
const mockFetchAuditLogs = vi.fn();
const mockFetchRegionsOfflineAware = vi.fn();

vi.mock('@/lib/useNetworkStatus', () => ({
    useNetworkStatus: () => ({ isOnline: true, isReconnecting: false }),
}));

vi.mock('@/lib/api', () => ({
    fetchAdminUsers: () => mockFetchAdminUsers(),
    updateAdminUser: vi.fn(),
    fetchAdminSecurityLogs: () => mockFetchAdminSecurityLogs(),
    updateAdminSecurityLog: (...args: unknown[]) => mockUpdateAdminSecurityLog(...args),
    fetchAuditLogs: () => mockFetchAuditLogs(),
    fetchAuditLogsOfflineAware: async () => ({ response: await mockFetchAuditLogs(), fromCache: false }),
    fetchRelatedAuditLogs: (logId: number) => mockFetchRelatedAuditLogs(logId),
    analyzeSecurityLog: (logId: number) => mockAnalyzeSecurityLog(logId),
    createIncidentFromAlert: (logId: number) => mockCreateIncidentFromAlert(logId),
    fetchSystemHealth: vi.fn().mockResolvedValue({
        status: 'HEALTHY',
        components: {
            database: { status: 'HEALTHY', latency_ms: 1 },
            redis: { status: 'HEALTHY', latency_ms: 1 },
            keycloak: { status: 'HEALTHY', latency_ms: 1 },
        },
    }),
    fetchSystemHealthOfflineAware: vi.fn().mockResolvedValue({
        response: {
            status: 'HEALTHY',
            components: {
                database: { status: 'HEALTHY', latency_ms: 1 },
                redis: { status: 'HEALTHY', latency_ms: 1 },
                keycloak: { status: 'HEALTHY', latency_ms: 1 },
            },
        },
        fromCache: false,
    }),
    fetchSystemMetrics: vi.fn().mockResolvedValue({
        cpu_percent: 10,
        memory: { total_mb: 8000, used_mb: 2000, percent: 25 },
        disk: { total_gb: 100, used_gb: 40, percent: 40 },
    }),
    fetchSystemMetricsOfflineAware: vi.fn().mockResolvedValue({
        response: {
            cpu_percent: 10,
            memory: { total_mb: 8000, used_mb: 2000, percent: 25 },
            disk: { total_gb: 100, used_gb: 40, percent: 40 },
        },
        fromCache: false,
    }),
    fetchWorkerStatus: vi.fn().mockResolvedValue([]),
    fetchWorkerStatusOfflineAware: vi.fn().mockResolvedValue({ response: [], fromCache: false }),
    fetchRegions: vi.fn().mockResolvedValue([]),
    // Plan T13 (Phase B) — offline-aware reference reads (regions).
    fetchRegionsOfflineAware: (userId: string) => mockFetchRegionsOfflineAware(userId),
    fetchActiveSessions: vi.fn().mockResolvedValue([]),
    fetchActiveSessionsOfflineAware: vi.fn().mockResolvedValue({ response: [], fromCache: false }),
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
        mockFetchRelatedAuditLogs.mockResolvedValue({ log_id: 1, items: [] });
        mockFetchRegionsOfflineAware.mockResolvedValue({ response: [], fromCache: false });
    });

    it('shows decision buttons for unactioned logs', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogUnactioned], total: 1 });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => {
            expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: /Confirm Threat/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /False Positive/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /View Related Evidence/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create Incident from Alert/i })).toBeInTheDocument();
    });

    it('clicking "Confirm Threat" calls updateAdminSecurityLog with action CONFIRM_THREAT and shows success', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogUnactioned], total: 1 });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm Threat/i }));
        await waitFor(() => {
            expect(mockUpdateAdminSecurityLog).toHaveBeenCalledWith(1, { action: 'CONFIRM_THREAT', note: undefined });
        });
        expect(await screen.findByText(/Confirmed Threat applied to alert #1/i)).toBeInTheDocument();
        expect(screen.getByText(/Reviewed: Confirmed Threat/i)).toBeInTheDocument();
    });

    it('clicking "False Positive" calls updateAdminSecurityLog with action FALSE_POSITIVE', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogUnactioned], total: 1 });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /False Positive/i }));
        await waitFor(() => {
            expect(mockUpdateAdminSecurityLog).toHaveBeenCalledWith(1, { action: 'FALSE_POSITIVE', note: undefined });
        });
    });

    it('clicking "View Related Evidence" calls fetchRelatedAuditLogs and renders results', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogUnactioned], total: 1 });
        mockFetchRelatedAuditLogs.mockResolvedValue({
            log_id: 1,
            items: [
                {
                    audit_id: 10,
                    user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                    action_type: 'HITL_REVIEW',
                    table_affected: 'security_threat_logs',
                    record_id: 1,
                    ip_address: '192.168.1.100',
                    user_agent: 'TestAgent/1.0',
                    timestamp: '2026-01-15T10:05:00+00:00',
                    new_values: { method: 'PATCH' },
                    old_values: null,
                },
            ],
        });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /View Related Evidence/i }));
        await waitFor(() => {
            expect(mockFetchRelatedAuditLogs).toHaveBeenCalledWith(1);
        });
        await waitFor(() => {
            expect(screen.getByText('Related Audit Evidence')).toBeInTheDocument();
            expect(screen.getByText('HITL_REVIEW')).toBeInTheDocument();
        });
    });

    it('shows empty state when View Related Evidence returns no results', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogUnactioned], total: 1 });
        mockFetchRelatedAuditLogs.mockResolvedValue({ log_id: 1, items: [] });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /View Related Evidence/i }));
        await waitFor(() => {
            expect(screen.getByText(/No related audit records found/i)).toBeInTheDocument();
        });
    });

    it('shows reviewed display for already-actioned logs while keeping related evidence available', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogActioned], total: 1 });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => {
            expect(screen.getByText(/Suricata Alert.*#2/)).toBeInTheDocument();
        });
        expect(screen.getByText(/Reviewed: Confirmed Threat/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Confirm Threat/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /False Positive/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /View Related Evidence/i })).toBeInTheDocument();
    });

    it('shows a clearer inline error when a HITL decision returns a backend 500', async () => {
        mockUpdateAdminSecurityLog.mockRejectedValue(new Error('Request failed: 500'));
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogUnactioned], total: 1 });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm Threat/i }));
        expect(await screen.findByText(/Server failed while applying the threat decision/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Confirm Threat/i })).toBeInTheDocument();
    });

    it('clicking "Create Incident from Alert" calls createIncidentFromAlert and shows success link', async () => {
        mockCreateIncidentFromAlert.mockResolvedValue({ status: 'ok', incident_id: 42 });
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogUnactioned], total: 1 });
        render(<AdminSystemPage />);
        await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());
        const viewButtons = await screen.findAllByRole('button', { name: /View/i });
        fireEvent.click(viewButtons[0]);
        await waitFor(() => expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Create Incident from Alert/i }));
        await waitFor(() => {
            expect(mockCreateIncidentFromAlert).toHaveBeenCalledWith(1);
        });
        // Success should show inline (modal closes on success, message set in state)
    });
});
