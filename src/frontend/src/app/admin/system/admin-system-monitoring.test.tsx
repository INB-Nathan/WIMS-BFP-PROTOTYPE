/**
 * TDD: M9a System Monitoring panels (CPU/RAM/disk + Celery workers)
 *
 * Verifies that on /admin/system:
 * 1. Initial mount fetches health + system metrics + worker status via loadMonitoring()
 * 2. 60s auto-refresh calls loadMonitoring() again
 * 3. Interval is cleaned up on unmount
 * 4. Partial failure (one endpoint rejects) does not crash; other panels still render
 * 5. CPU%, memory MB, disk GB, and worker rows are all displayed when data is present
 */
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdminSystemPage from './page';

const mockHealth = {
    status: 'HEALTHY',
    components: {
        database: { status: 'HEALTHY', latency_ms: 5 },
        redis: { status: 'HEALTHY', latency_ms: 2 },
        keycloak: { status: 'HEALTHY', latency_ms: 12 },
    },
};

const mockSystemMetrics = {
    cpu_percent: 42,
    memory: { total_mb: 8192, used_mb: 3500, percent: 42.7 },
    disk: { total_gb: 100, used_gb: 45, percent: 45 },
};

const mockWorkers = [
    {
        worker_id: 'worker1@celery-host-1',
        hostname: 'celery-host-1',
        last_seen: '2025-03-14T10:00:00Z',
        active_tasks: 3,
        status: 'UP',
    },
    {
        worker_id: 'worker2@celery-host-2',
        hostname: 'celery-host-2',
        last_seen: '2025-03-14T09:59:00Z',
        active_tasks: 0,
        status: 'UP',
    },
];

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

const mockFetchSystemHealth = vi.fn();
const mockFetchSystemMetrics = vi.fn();
const mockFetchWorkerStatus = vi.fn();
const mockFetchAdminUsers = vi.fn();
const mockFetchAuditLogs = vi.fn();
const mockFetchAdminSecurityLogs = vi.fn();
const mockFetchRegions = vi.fn();
const mockFetchActiveSessions = vi.fn();

const networkStatusState = { isOnline: true, isReconnecting: false };

const connectivityState = {
    state: 'online' as const,
    isOnline: true,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: Date.now(),
};

vi.mock('@/lib/useNetworkStatus', () => ({
    useNetworkStatus: () => networkStatusState,
}));

vi.mock('@/lib/connectivity', () => ({
    getConnectivitySnapshot: () => ({ ...connectivityState }),
    subscribeConnectivity: (cb: () => void) => {
        // Store the callback for test-driven emit
        (globalThis as Record<string, unknown>).__connectivityCb = cb;
        return () => {
            delete (globalThis as Record<string, unknown>).__connectivityCb;
        };
    },
    probeConnectivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api', () => ({
    fetchSystemHealth: () => mockFetchSystemHealth(),
    fetchSystemHealthOfflineAware: async () => ({ response: await mockFetchSystemHealth(), fromCache: false }),
    fetchSystemMetrics: () => mockFetchSystemMetrics(),
    fetchSystemMetricsOfflineAware: async () => ({ response: await mockFetchSystemMetrics(), fromCache: false }),
    fetchWorkerStatus: () => mockFetchWorkerStatus(),
    fetchWorkerStatusOfflineAware: async () => ({ response: await mockFetchWorkerStatus(), fromCache: false }),
    fetchAdminUsers: () => mockFetchAdminUsers(),
    updateAdminUser: vi.fn(),
    fetchAdminSecurityLogs: () => mockFetchAdminSecurityLogs(),
    updateAdminSecurityLog: vi.fn(),
    fetchAuditLogs: () => mockFetchAuditLogs(),
    fetchAuditLogsOfflineAware: async () => ({ response: await mockFetchAuditLogs(), fromCache: false }),
    analyzeSecurityLog: vi.fn(),
    fetchRegions: () => mockFetchRegions(),
    fetchUserSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    terminateUserSessions: vi.fn(),
    KeycloakSession: {},
    fetchActiveSessions: () => mockFetchActiveSessions(),
    fetchActiveSessionsOfflineAware: async () => ({ response: await mockFetchActiveSessions(), fromCache: false }),
    revokeUserSessions: vi.fn(),
}));

describe('M9a: System Monitoring — initial fetch and 60s auto-refresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockFetchAdminUsers.mockResolvedValue([]);
        mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
        mockFetchAdminSecurityLogs.mockResolvedValue([]);
        mockFetchRegions.mockResolvedValue([]);
        mockFetchActiveSessions.mockResolvedValue([]);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('initial monitoring fetch on mount — all three fetch fns called once', async () => {
        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        render(<AdminSystemPage />);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(mockFetchSystemHealth).toHaveBeenCalledTimes(1);
        expect(mockFetchSystemMetrics).toHaveBeenCalledTimes(1);
        expect(mockFetchWorkerStatus).toHaveBeenCalledTimes(1);
    });

    it('CPU%, memory MB, disk GB, and worker hostname appear in DOM after initial load', async () => {
        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        vi.useRealTimers();
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('42%')).toBeInTheDocument();
        });
        expect(screen.getByText('42.7%')).toBeInTheDocument();
        expect(screen.getByText('3500 / 8192 MB')).toBeInTheDocument();
        expect(screen.getByText('45%')).toBeInTheDocument();
        expect(screen.getByText('45 / 100 GB')).toBeInTheDocument();
        expect(screen.getByText('celery-host-1')).toBeInTheDocument();
    });

    it('60s auto-refresh calls each fetch fn twice (initial + one interval)', async () => {
        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        render(<AdminSystemPage />);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(mockFetchSystemHealth).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000);
        });

        expect(mockFetchSystemHealth).toHaveBeenCalledTimes(2);
        expect(mockFetchSystemMetrics).toHaveBeenCalledTimes(2);
        expect(mockFetchWorkerStatus).toHaveBeenCalledTimes(2);
    });

    it('interval cleanup on unmount — no fetch calls after unmount', async () => {
        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        const { unmount } = render(<AdminSystemPage />);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(mockFetchSystemHealth).toHaveBeenCalledTimes(1);

        unmount();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000);
        });

        expect(mockFetchSystemHealth).toHaveBeenCalledTimes(1);
        expect(mockFetchSystemMetrics).toHaveBeenCalledTimes(1);
        expect(mockFetchWorkerStatus).toHaveBeenCalledTimes(1);
    });

    it('partial failure: fetchSystemMetrics rejects, health and workers still render', async () => {
        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockRejectedValue(new Error('metrics error'));
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        vi.useRealTimers();
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('HEALTHY')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByText('celery-host-1')).toBeInTheDocument();
        });

        expect(screen.getByText('System metrics unavailable.')).toBeInTheDocument();
    });

    it('renders System Monitoring section heading after initial data load', async () => {
        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue([]);

        vi.useRealTimers();
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('System Monitoring')).toBeInTheDocument();
        });

        expect(screen.getByText('Celery Workers')).toBeInTheDocument();
        expect(screen.getByText('No active workers.')).toBeInTheDocument();
    });

    it('shows offline banner when useNetworkStatus reports offline', async () => {
        networkStatusState.isOnline = false;

        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        vi.useRealTimers();
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText(/You are offline/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/showing cached data/i)).toBeInTheDocument();

        // Restore
        networkStatusState.isOnline = true;
    });

    it('shows backend-unreachable banner when connectivity snapshot is offline but navigator is online (Q6)', async () => {
        // Navigator says online, but connectivity probe reports offline
        networkStatusState.isOnline = true;
        connectivityState.state = 'offline';
        connectivityState.isOnline = false;

        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        vi.useRealTimers();
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText(/Backend unreachable/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/showing cached data/i)).toBeInTheDocument();

        // The navigator-only banner should NOT appear (we want the connectivity one)
        expect(screen.queryByText(/You are offline/)).toBeNull();

        // Restore
        connectivityState.state = 'online';
        connectivityState.isOnline = true;
    });

    it('shows no offline banner when both navigator and connectivity report online', async () => {
        networkStatusState.isOnline = true;
        connectivityState.state = 'online';
        connectivityState.isOnline = true;

        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        vi.useRealTimers();
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('System Monitoring')).toBeInTheDocument();
        });

        expect(screen.queryByText(/You are offline/)).toBeNull();
        expect(screen.queryByText(/Backend unreachable/)).toBeNull();
    });

    it('banner updates reactively when connectivity snapshot changes to offline', async () => {
        // Start online
        networkStatusState.isOnline = true;
        connectivityState.state = 'online';
        connectivityState.isOnline = true;

        mockFetchSystemHealth.mockResolvedValue(mockHealth);
        mockFetchSystemMetrics.mockResolvedValue(mockSystemMetrics);
        mockFetchWorkerStatus.mockResolvedValue(mockWorkers);

        vi.useRealTimers();
        render(<AdminSystemPage />);

        await waitFor(() => {
            expect(screen.getByText('System Monitoring')).toBeInTheDocument();
        });

        // No banner yet
        expect(screen.queryByText(/Backend unreachable/)).toBeNull();

        // Simulate connectivity subscriber notification: flip to offline
        connectivityState.state = 'offline';
        connectivityState.isOnline = false;
        const cb = (globalThis as Record<string, unknown>).__connectivityCb as (() => void) | undefined;
        if (cb) cb();

        await waitFor(() => {
            expect(screen.getByText(/Backend unreachable/i)).toBeInTheDocument();
        });

        // Restore
        connectivityState.state = 'online';
        connectivityState.isOnline = true;
    });
});
