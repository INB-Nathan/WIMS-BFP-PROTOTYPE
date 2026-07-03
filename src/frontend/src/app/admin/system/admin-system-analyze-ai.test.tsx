/**
 * TDD: Analyze with AI in Admin Hub Threat Telemetry
 *
 * Verifies that on /admin/system, in the Threat Telemetry table:
 * - Logs with xai_narrative === null show an "Analyze with AI" button
 * - Clicking it shows loading state, calls the API, and displays xai_narrative and xai_confidence in the modal
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiRequestError } from '@/lib/api/transport';
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
const mockGenerateRecommendedAction = vi.fn();
const mockCheckAnalysisStatus = vi.fn();
const mockCheckRecommendedActionStatus = vi.fn();
const mockFetchAdminUsers = vi.fn();
const mockFetchAuditLogs = vi.fn();

vi.mock('@/lib/api/admin', () => ({
    analyzeSecurityLog: (logId: number) => mockAnalyzeSecurityLog(logId),
    checkAnalysisStatus: (logId: number) => mockCheckAnalysisStatus(logId),
    checkRecommendedActionStatus: (logId: number) => mockCheckRecommendedActionStatus(logId),
    generateRecommendedAction: (logId: number) => mockGenerateRecommendedAction(logId),
    updateAdminSecurityLog: vi.fn(),
    createIncidentFromAlert: vi.fn(),
    fetchRelatedAuditLogs: vi.fn().mockResolvedValue({ log_id: 0, items: [], related_alerts: [] }),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
    useNetworkStatus: () => ({ isOnline: true, isReconnecting: false }),
}));

vi.mock('@/lib/api', () => ({
    fetchAdminUsers: () => mockFetchAdminUsers(),
    updateAdminUser: vi.fn(),
    fetchAdminSecurityLogs: () => mockFetchAdminSecurityLogs(),
    updateAdminSecurityLog: vi.fn(),
    fetchAuditLogs: () => mockFetchAuditLogs(),
    fetchAuditLogsOfflineAware: async () => ({ response: await mockFetchAuditLogs(), fromCache: false }),
    analyzeSecurityLog: (logId: number) => mockAnalyzeSecurityLog(logId),
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
}));

describe('Admin System — Analyze with AI in Threat Telemetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchAdminUsers.mockResolvedValue([]);
        mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
        mockCheckAnalysisStatus.mockResolvedValue({ log_id: 1, status: 'idle' });
        mockCheckRecommendedActionStatus.mockResolvedValue({ log_id: 2, status: 'idle' });
        mockGenerateRecommendedAction.mockResolvedValue({
            log_id: 2,
            xai_narrative: JSON.stringify({
                anomaly_description: 'Suspicious outbound connection detected.',
                recommended_action: 'Block the source IP and inspect related logs.',
            }),
            xai_confidence: 0.85,
        });
    });

    it('shows "Analyze with AI" button for logs with xai_narrative === null', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogWithoutNarrative, mockLogWithNarrative], total: 2 });

        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
        });

        // Log 1 has xai_narrative null → should show Analyze with AI
        const analyzeButtons = await screen.findAllByRole('button', { name: /Analyze with AI/i });
        expect(analyzeButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('clicking Analyze with AI calls API and displays narrative and confidence in modal', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogWithoutNarrative], total: 1 });
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

        // Click View to open modal after the telemetry row finishes loading.
        const viewButtons = await screen.findAllByRole('button', { name: /^View$/i });
        fireEvent.click(viewButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument();
        });

        // In modal: click Analyze with AI
        const analyzeButtons = screen.getAllByRole('button', { name: /^Analyze with AI$/i });
        const modalAnalyzeBtn = analyzeButtons[analyzeButtons.length - 1];
        fireEvent.click(modalAnalyzeBtn);

        // Stepper should appear (stage indicators)
        await waitFor(() => {
            expect(screen.getByText('Fetching')).toBeInTheDocument();
        });

        // API called (500ms simulated stage delay before the real API call)
        await waitFor(() => {
            expect(mockAnalyzeSecurityLog).toHaveBeenCalledWith(1);
        });

        // After response: narrative displayed
        await waitFor(() => {
            expect(screen.getByText('AI-generated narrative for test.')).toBeInTheDocument();
        });
        // Confidence bar should be present (shows 92%)
        await waitFor(() => {
            expect(screen.getByText('92%')).toBeInTheDocument();
        });
    });

    // ── #419: no-analyze-on-load + manual-analyze-still-works ───────────────

    it('#419: does not call analyzeSecurityLog on initial render', async () => {
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
        });

        // Verify analyzeSecurityLog was NOT called on initial render
        expect(mockAnalyzeSecurityLog).not.toHaveBeenCalled();
    });

    it('Stage 2: shows "Generate Recommended Action" for structured narrative without action and generates on click', async () => {
        const narrativeJson = {
            anomaly_description: 'Suspicious outbound connection detected from internal host.',
            log_evidence: 'Source IP 10.0.0.5 made repeated connections to known C2 domains.',
            risk_assessment: 'Potential data exfiltration attempt requiring investigation.',
            confidence: 0.85,
            confidence_breakdown: {
                anomaly_detection: 0.87,
                classification: 0.83,
                overall: 0.85,
            },
            sources: ['Suricata EVE log'],
        };

        const stage2Log = {
            ...mockLogWithoutNarrative,
            log_id: 3,
            xai_narrative: JSON.stringify(narrativeJson),
            xai_confidence: 0.85,
        };

        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [stage2Log], total: 1 });

        // Override default mock to return updated narrative with recommended_action
        mockGenerateRecommendedAction.mockResolvedValue({
            log_id: 3,
            xai_narrative: JSON.stringify({
                ...narrativeJson,
                recommended_action: 'Block the source IP and inspect related logs.',
            }),
            xai_confidence: 0.85,
        });

        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
        });

        // Open the detail modal
        const viewButtons = await screen.findAllByRole('button', { name: /^View$/i });
        fireEvent.click(viewButtons[0]);

        // Wait for modal to render with the correct log ID
        await waitFor(() => {
            expect(screen.getByText(/Suricata Alert.*#3/)).toBeInTheDocument();
        });

        // Wait for Stage 2 section to appear
        await waitFor(() => {
            expect(screen.getByText('Stage 2: Recommended Action')).toBeInTheDocument();
        });

        // Click "Generate Recommended Action"
        const generateBtn = screen.getByRole('button', { name: /Generate Recommended Action/i });
        fireEvent.click(generateBtn);

        // Should show generating state
        await waitFor(() => {
            expect(screen.getByText('Generating Recommended Action…')).toBeInTheDocument();
        });

        // API was called with the correct log_id
        await waitFor(() => {
            expect(mockGenerateRecommendedAction).toHaveBeenCalledWith(3);
        });

        // After resolution: recommended action text appears in the UI
        await waitFor(() => {
            expect(screen.getByText('Block the source IP and inspect related logs.')).toBeInTheDocument();
        });

        // "Recommended Action" heading should now be visible
        expect(screen.getByText('Recommended Action')).toBeInTheDocument();

        // Stage 2 section should have disappeared (no longer needed)
        await waitFor(() => {
            expect(screen.queryByText('Stage 2: Recommended Action')).not.toBeInTheDocument();
        });
    });

    it('treats 409 AI inference conflict as background analysis in progress', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogWithoutNarrative], total: 1 });
        mockAnalyzeSecurityLog.mockRejectedValue(
            new ApiRequestError('AI inference is already running for log 1', 409)
        );

        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
        });

        const viewButtons = await screen.findAllByRole('button', { name: /^View$/i });
        fireEvent.click(viewButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument();
        });

        const analyzeButtons = screen.getAllByRole('button', { name: /^Analyze with AI$/i });
        fireEvent.click(analyzeButtons[analyzeButtons.length - 1]);

        await waitFor(() => {
            expect(mockAnalyzeSecurityLog).toHaveBeenCalledWith(1);
        });

        await waitFor(() => {
            expect(screen.getByText('AI Threat Analysis in Progress')).toBeInTheDocument();
            expect(screen.queryByText('AI inference is already running for log 1')).not.toBeInTheDocument();
        });
    });

    it('#419: manual Analyze click calls analyzeSecurityLog exactly once', async () => {
        mockFetchAdminSecurityLogs.mockResolvedValue({ items: [mockLogWithoutNarrative], total: 1 });
        mockAnalyzeSecurityLog.mockResolvedValue({
            log_id: 1,
            xai_narrative: 'AI-generated narrative for test.',
            xai_confidence: 0.92,
        });

        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
        });

        // Click View to open the detail modal
        const viewButtons = await screen.findAllByRole('button', { name: /^View$/i });
        fireEvent.click(viewButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Suricata Alert.*#1/)).toBeInTheDocument();
        });

        // Click Analyze with AI in the modal
        const analyzeButtons = screen.getAllByRole('button', { name: /^Analyze with AI$/i });
        const modalAnalyzeBtn = analyzeButtons[analyzeButtons.length - 1];
        fireEvent.click(modalAnalyzeBtn);

        // Verify analyzeSecurityLog was called exactly once
        await waitFor(() => {
            expect(mockAnalyzeSecurityLog).toHaveBeenCalledTimes(1);
        });
    });
});
