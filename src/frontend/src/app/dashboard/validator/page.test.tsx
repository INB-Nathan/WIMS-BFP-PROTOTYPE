/**
 * Validator dashboard page tests — offline wiring: offline indicator,
 * queued pending badge, and cache banner.
 *
 * PR #272 T2: validator dashboard has offline wiring with no page-level tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ValidatorDashboardPage from './page';

// ── Router mock ──────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// ── User profile mock ────────────────────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ── Network status — default online, overridden per test ─────────────────
let networkStatusOverride = { isOnline: true, isReconnecting: false };
vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => networkStatusOverride,
}));

// ── Auto-sync mock ───────────────────────────────────────────────────────
const mockSyncNow = vi.fn();
const autoSyncOverride = { syncing: false, lastSyncedAt: null, pendingCount: 0, syncNow: mockSyncNow };
vi.mock('@/lib/useAutoSync', () => ({
  useAutoSync: () => autoSyncOverride,
}));

// ── Offline store mock (getPendingIncidents) ─────────────────────────────
let pendingIncidentsOverride: Array<{
  id: number;
  opType?: string;
  localId?: string;
  payload: Record<string, unknown>;
  createdAt: number;
  status: 'pending' | 'synced';
}> = [];
vi.mock('@/lib/offlineStore', () => ({
  getPendingIncidents: () => Promise.resolve(pendingIncidentsOverride),
}));

// ── API mocks ────────────────────────────────────────────────────────────
const mockFetchValidatorQueue = vi.fn();
const mockFetchValidatorStats = vi.fn();
const mockSubmitVerification = vi.fn();
const mockArchiveIncident = vi.fn();
const mockUnarchiveIncident = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  ApiRequestError: class extends Error {
    status: number;
    detail: unknown;
    constructor(message: string, status: number, detail?: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  },
  fetchValidatorStats: (...args: unknown[]) => mockFetchValidatorStats(...args),
  fetchValidatorQueueOfflineAware: (...args: unknown[]) => mockFetchValidatorQueue(...args),
  submitVerificationOfflineAware: (...args: unknown[]) => mockSubmitVerification(...args),
  archiveIncidentOfflineAware: (...args: unknown[]) => mockArchiveIncident(...args),
  unarchiveIncidentOfflineAware: (...args: unknown[]) => mockUnarchiveIncident(...args),
}));

// ── Stub-heavy child components (avoid deep rendering of modals/table) ───
vi.mock('@/components/validator/ActionModal', () => ({
  ActionModal: () => null,
}));
vi.mock('@/components/validator/ValidatorDuplicateModal', () => ({
  ValidatorDuplicateModal: () => null,
}));
vi.mock('@/components/validator/AcceptConfirmModal', () => ({
  AcceptConfirmModal: () => null,
}));
vi.mock('@/components/validator/BulkApproveConfirmModal', () => ({
  BulkApproveConfirmModal: () => null,
}));
vi.mock('@/components/validator/BulkDuplicateModal', () => ({
  BulkDuplicateModal: () => null,
}));
vi.mock('@/components/validator/IncidentTableRow', () => ({
  IncidentTableRow: () => null,
}));

// ── Helpers ──────────────────────────────────────────────────────────────
function validQueueResponse(overrides = {}) {
  return {
    response: {
      items: [],
      total: 0,
      limit: 10,
      offset: 0,
      ...overrides,
    },
    fromCache: false,
  };
}

function validStatsResponse() {
  return {
    total_verified: 150,
    pending_validation: 23,
    wildland_total: 42,
    by_category: [
      { category: 'STRUCTURAL', count: 80 },
      { category: 'NON_STRUCTURAL', count: 30 },
      { category: 'TRANSPORTATION', count: 40 },
    ],
    structures_affected: 10,
    households_affected: 12,
    families_affected: 8,
    individuals_affected: 35,
    vehicles_affected: 5,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────
describe('Validator dashboard page — offline wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: online, authenticated NATIONAL_VALIDATOR
    networkStatusOverride = { isOnline: true, isReconnecting: false };
    pendingIncidentsOverride = [];

    mockUseAuth.mockReturnValue({
      user: { id: 'validator-1', email: 'v@test.local', role: 'NATIONAL_VALIDATOR', assignedRegionId: null },
      isAuthenticated: true,
      loading: false,
      loggingOut: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    mockFetchValidatorQueue.mockResolvedValue(validQueueResponse());
    mockFetchValidatorStats.mockResolvedValue(validStatsResponse());
    mockSubmitVerification.mockResolvedValue({ queued: false, localId: '' });
    mockArchiveIncident.mockResolvedValue({ queued: false, localId: '' });
    mockUnarchiveIncident.mockResolvedValue({ queued: false, localId: '' });
  });

  // ── T2.1: Offline indicator ──────────────────────────────────────────
  it('renders offline indicator when network is offline', async () => {
    networkStatusOverride = { isOnline: false, isReconnecting: false };

    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeInTheDocument();
    });
  });

  // ── T2.2: No offline indicator when online ───────────────────────────
  it('does not render offline indicator when network is online', async () => {
    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
  });

  // ── T2.3: Queued pending badge with count ────────────────────────────
  it('renders queued pending badge when pending validator ops exist', async () => {
    pendingIncidentsOverride = [
      {
        id: 1,
        opType: 'verify',
        localId: 'local-1',
        payload: { incident_id: 101, action: 'accept' },
        createdAt: Date.now(),
        status: 'pending',
      },
      {
        id: 2,
        opType: 'archive_action',
        localId: 'local-2',
        payload: { incident_id: 102, action: 'archive' },
        createdAt: Date.now(),
        status: 'pending',
      },
    ];

    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      // The badge shows "2 queued" — the validator page counts both verify
      // and archive_action opTypes.
      expect(screen.getByText(/2\s+queued/)).toBeInTheDocument();
    });
  });

  // ── T2.4: No queued badge when zero pending ──────────────────────────
  it('does not render queued badge when there are zero pending ops', async () => {
    pendingIncidentsOverride = [];

    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    expect(screen.queryByText(/queued/)).not.toBeInTheDocument();
  });

  // ── T2.5: Queued badge excludes non-validator opTypes ───────────────
  it('queued count only includes verify and archive_action opTypes', async () => {
    // Two pending ops: one verify, one unrelated opType
    pendingIncidentsOverride = [
      {
        id: 1,
        opType: 'verify',
        localId: 'v1',
        payload: { incident_id: 1, action: 'accept' },
        createdAt: Date.now(),
        status: 'pending',
      },
      {
        id: 2,
        opType: 'create',
        localId: 'c1',
        payload: {},
        createdAt: Date.now(),
        status: 'pending',
      },
      {
        id: 3,
        opType: 'update',
        localId: 'u1',
        payload: {},
        createdAt: Date.now(),
        status: 'pending',
      },
    ];

    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      // Only the verify op counts — badge shows "1 queued"
      expect(screen.getByText(/1\s+queued/)).toBeInTheDocument();
    });
  });

  // ── T2.6: Cache banner when queue served from cache ──────────────────
  it('renders cache banner when queue is served from offline cache', async () => {
    networkStatusOverride = { isOnline: false, isReconnecting: false };
    mockFetchValidatorQueue.mockResolvedValue({
      response: { items: [], total: 0, limit: 10, offset: 0 },
      fromCache: true,
      cachedAt: Date.now() - 60_000,
    });

    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
    });
  });

  // ── T2.7: No cache banner when queue fetched live ────────────────────
  it('does not render cache banner when queue is fetched live', async () => {
    mockFetchValidatorQueue.mockResolvedValue({
      response: { items: [], total: 0, limit: 10, offset: 0 },
      fromCache: false,
    });

    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Showing cached data/i)).not.toBeInTheDocument();
  });

  // ── T2.8: Offline indicator + queued badge together ───────────────────
  it('renders both offline indicator and queued badge when offline with pending ops', async () => {
    networkStatusOverride = { isOnline: false, isReconnecting: false };
    pendingIncidentsOverride = [
      {
        id: 1,
        opType: 'verify',
        localId: 'v1',
        payload: { incident_id: 1, action: 'accept' },
        createdAt: Date.now(),
        status: 'pending',
      },
    ];

    render(<ValidatorDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/1\s+queued/)).toBeInTheDocument();
    });
  });
});
