/**
 * TDD: /admin/system search wiring for security and audit logs.
 *
 * Covers search submit buttons, trimmed q values, and clear behavior.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import AdminSystemPage from './page';

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
const mockFetchAdminSecurityLogs = vi.fn();
const mockFetchAuditLogs = vi.fn();

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isReconnecting: false }),
}));

vi.mock('@/lib/api', () => ({
  fetchAdminUsers: () => mockFetchAdminUsers(),
  updateAdminUser: vi.fn(),
  fetchAdminSecurityLogs: (...args: unknown[]) => mockFetchAdminSecurityLogs(...args),
  updateAdminSecurityLog: vi.fn(),
  fetchAuditLogs: (...args: unknown[]) => mockFetchAuditLogs(...args),
  fetchAuditLogsOfflineAware: async (...args: unknown[]) => ({ response: await mockFetchAuditLogs(...args), fromCache: false }),
  analyzeSecurityLog: vi.fn(),
  createIncidentFromAlert: vi.fn(),
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
  fetchActiveSessions: vi.fn().mockResolvedValue([]),
  fetchActiveSessionsOfflineAware: vi.fn().mockResolvedValue({ response: [], fromCache: false }),
  fetchUserSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  terminateUserSessions: vi.fn(),
  revokeUserSessions: vi.fn(),
}));

describe('Admin System search wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAdminUsers.mockResolvedValue([]);
    mockFetchAdminSecurityLogs.mockResolvedValue({ items: [], total: 0 });
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('exposes accessible labels for the icon-only search buttons', async () => {
    render(<AdminSystemPage />);

    await waitFor(() => {
      expect(screen.getByText('Threat Telemetry')).toBeInTheDocument();
      expect(screen.getByText('System Audit')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Search security logs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search audit logs' })).toBeInTheDocument();
  });

  it('submits trimmed security q values', async () => {
    const user = userEvent.setup();
    render(<AdminSystemPage />);

    await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());

    const input = screen.getAllByPlaceholderText('Search logs (narrative, IP, severity…)')[0];
    await user.clear(input);
    await user.type(input, '  smoke  ');
    await user.click(screen.getByRole('button', { name: 'Search security logs' }));

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenLastCalledWith({ limit: 20, offset: 0, q: 'smoke' });
    });
  });

  it('submits trimmed audit q values with pagination', async () => {
    const user = userEvent.setup();
    render(<AdminSystemPage />);

    await waitFor(() => expect(screen.getByText('System Audit')).toBeInTheDocument());

    const input = screen.getAllByPlaceholderText('Search audit trail (action, table, user agent…)')[0];
    await user.clear(input);
    await user.type(input, '  login  ');
    await user.click(screen.getByRole('button', { name: 'Search audit logs' }));

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenLastCalledWith({ limit: 50, offset: 0, q: 'login' });
    });
  });

  it('clears security q and refetches unfiltered logs', async () => {
    const user = userEvent.setup();
    render(<AdminSystemPage />);

    await waitFor(() => expect(screen.getByText('Threat Telemetry')).toBeInTheDocument());

    const input = screen.getAllByPlaceholderText('Search logs (narrative, IP, severity…)')[0];
    await user.type(input, 'trace');
    await user.click(screen.getByRole('button', { name: 'Search security logs' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenLastCalledWith({ limit: 20, offset: 0 });
    });
  });

  it('clears audit q and refetches unfiltered logs', async () => {
    const user = userEvent.setup();
    render(<AdminSystemPage />);

    await waitFor(() => expect(screen.getByText('System Audit')).toBeInTheDocument());

    const input = screen.getAllByPlaceholderText('Search audit trail (action, table, user agent…)')[0];
    await user.type(input, 'action');
    await user.click(screen.getByRole('button', { name: 'Search audit logs' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });
    });
  });
});
