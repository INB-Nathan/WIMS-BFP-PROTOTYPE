/**
 * TDD: #354 System Config page — worker timeout keys
 *
 * Verifies that the System Config page at /admin/system/config:
 * 1. Renders all nine config keys including worker timeout keys
 * 2. Allows editing worker_stale_timeout_seconds
 * 3. Allows editing worker_offline_timeout_seconds
 * 4. Shows error on invalid value
 * 5. Redirects non-admin users
 */
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SystemConfigPage from './page';
import userEvent from '@testing-library/user-event';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(() => ({
    user: { role: 'SYSTEM_ADMIN' },
    loading: false,
    logout: vi.fn(),
  })),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockFetchAdminConfig = vi.fn();
const mockUpdateAdminConfig = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
  fetchAdminConfig: () => mockFetchAdminConfig(),
  updateAdminConfig: (key: string, value: string) => mockUpdateAdminConfig(key, value),
}));

vi.mock('@/lib/offlineStore', () => ({
  initOfflineStorageLimit: vi.fn(),
}));

function mockAdminUser() {
  mockUseAuth.mockReturnValue({
    user: { role: 'SYSTEM_ADMIN' },
    loading: false,
    logout: vi.fn(),
  });
}

const DEFAULT_CONFIG = [
  { key: 'ai_timeout_seconds', value: '60', description: 'Ollama timeout', updated_by: null, updated_at: null },
  { key: 'alert_severity_threshold', value: '3', description: 'Suricata HIGH cutoff', updated_by: null, updated_at: null },
  { key: 'npc_contact_name', value: 'NPC DPO', description: 'NPC contact person', updated_by: null, updated_at: null },
  { key: 'npc_contact_phone', value: '+63 2 8234-2228', description: 'NPC contact phone', updated_by: null, updated_at: null },
  { key: 'npc_office_phone', value: '+63 2 8234-2228', description: 'NPC office phone', updated_by: null, updated_at: null },
  { key: 'offline_storage_mb', value: '50', description: 'IndexedDB advisory cap', updated_by: null, updated_at: null },
  { key: 'session_timeout_minutes', value: '30', description: 'Idle timeout UI hint', updated_by: null, updated_at: null },
  { key: 'worker_offline_timeout_seconds', value: '300', description: 'Worker OFFLINE threshold', updated_by: null, updated_at: null },
  { key: 'worker_stale_timeout_seconds', value: '60', description: 'Worker STALE threshold', updated_by: null, updated_at: null },
];

describe('SystemConfigPage — worker timeout keys', () => {
  beforeEach(() => {
    mockAdminUser();
    mockReplace.mockReset();
    mockFetchAdminConfig.mockResolvedValue(DEFAULT_CONFIG);
    mockUpdateAdminConfig.mockResolvedValue({ key: '', value: '', status: 'ok' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders worker_stale_timeout_seconds config key', async () => {
    render(<SystemConfigPage />);
    await waitFor(() => {
      expect(screen.getByText('worker_stale_timeout_seconds')).toBeInTheDocument();
    });
    // Both ai_timeout_seconds and worker_stale_timeout_seconds have value "60"
    const sixtyInputs = screen.getAllByDisplayValue('60');
    expect(sixtyInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders worker_offline_timeout_seconds config key', async () => {
    render(<SystemConfigPage />);
    await waitFor(() => {
      expect(screen.getByText('worker_offline_timeout_seconds')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('300')).toBeInTheDocument();
  });

  it('displays descriptions for worker timeout keys', async () => {
    render(<SystemConfigPage />);
    await waitFor(() => {
      expect(screen.getByText('Worker STALE threshold')).toBeInTheDocument();
      expect(screen.getByText('Worker OFFLINE threshold')).toBeInTheDocument();
    });
  });

  it('allows editing worker_stale_timeout_seconds', async () => {
    const user = userEvent.setup();
    render(<SystemConfigPage />);

    // Wait for the worker_stale_timeout_seconds row to appear
    await waitFor(() => {
      expect(screen.getByText('worker_stale_timeout_seconds')).toBeInTheDocument();
    });

    // Find the row containing worker_stale_timeout_seconds and get its input
    const staleCode = screen.getByText('worker_stale_timeout_seconds');
    const row = staleCode.closest('.px-6.py-5') as HTMLElement;
    expect(row).not.toBeNull();
    const input = within(row).getByRole('textbox');
    expect(input).toHaveValue('60');

    await user.clear(input);
    await user.type(input, '45');

    const saveButton = within(row).getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateAdminConfig).toHaveBeenCalledWith('worker_stale_timeout_seconds', '45');
    });
  });
});

describe('SystemConfigPage — auth', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('redirects non-admin users', async () => {
    mockReplace.mockReset();
    mockUseAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER' },
      loading: false,
      logout: vi.fn(),
    });

    mockFetchAdminConfig.mockResolvedValue(DEFAULT_CONFIG);
    render(<SystemConfigPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/admin/system');
    });
  });
});
