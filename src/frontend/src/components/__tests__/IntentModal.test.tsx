import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { IntentModal } from '../IntentModal';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Cookie mock — uses a shared store with proper getter/setter
const cookieStore = new Map<string, string>();

function setupCookieStore() {
  cookieStore.clear();
  Object.defineProperty(document, 'cookie', {
    get: () =>
      Array.from(cookieStore.entries())
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('; '),
    set: (val: string) => {
      const match = val.match(/^([^=]+)=([^;]*)/);
      if (match) {
        cookieStore.set(match[1], match[2]);
      }
    },
    configurable: true,
  });
}

function clearCookieStore() {
  cookieStore.clear();
  Object.defineProperty(document, 'cookie', {
    get: () => '',
    set: () => undefined,
    configurable: true,
  });
}

describe('IntentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCookieStore();
  });

  afterEach(() => {
    clearCookieStore();
  });

  it('renders the modal on initial visit (no bypass cookie)', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Report a Fire/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /View Active Fires/i })).toBeInTheDocument();
  });

  it('does not render the modal when bypass cookie is set', async () => {
    cookieStore.set('wims_browse_bypass', '1');
    render(<IntentModal />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Report a Fire/i })).not.toBeInTheDocument();
    });
  });

  it('sets the bypass cookie and hides modal when View Active Fires is clicked', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /View Active Fires/i })).toBeInTheDocument();
    });

    const browseBtn = screen.getByRole('button', { name: /View Active Fires/i });

    await act(async () => {
      fireEvent.click(browseBtn);
    });

    // Modal should be hidden
    expect(screen.queryByRole('button', { name: /Report a Fire/i })).not.toBeInTheDocument();

    // Cookie should be set
    expect(cookieStore.get('wims_browse_bypass')).toBe('1');
  });

  it('navigates to /report when Report a Fire is clicked', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Report a Fire/i })).toBeInTheDocument();
    });

    const reportBtn = screen.getByRole('button', { name: /Report a Fire/i });

    await act(async () => {
      fireEvent.click(reportBtn);
    });

    expect(mockPush).toHaveBeenCalledWith('/report');
  });

  it('does not have a dismiss/close button', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Report a Fire/i })).toBeInTheDocument();
    });

    // No "X", "Close", "Dismiss", or similar text/button
    expect(screen.queryByRole('button', { name: /close|dismiss|✕|×/i })).not.toBeInTheDocument();
  });

  it('renders the "No account needed" microcopy', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      const matches = screen.getAllByText(/No account needed/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders immediately with no bypass cookie (lazy initializer)', () => {
    render(<IntentModal />);
    expect(screen.getByRole('button', { name: /Report a Fire/i })).toBeInTheDocument();
  });

  it('re-shows the modal when cookie value is "0" (stale/expired)', () => {
    cookieStore.set('wims_browse_bypass', '0');
    render(<IntentModal />);
    expect(screen.getByRole('button', { name: /Report a Fire/i })).toBeInTheDocument();
  });

  it('re-shows the modal when cookie value is empty string (cleared)', () => {
    cookieStore.set('wims_browse_bypass', '');
    render(<IntentModal />);
    expect(screen.getByRole('button', { name: /Report a Fire/i })).toBeInTheDocument();
  });

  it('renders descriptive hints for each choice', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      expect(screen.getByText(/Start an emergency fire report/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/See verified BFP incidents and safety information/i)).toBeInTheDocument();
  });

  it('renders the WIMS-BFP subtitle description', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      expect(screen.getByText(/Wildfire Incident Management System/i)).toBeInTheDocument();
    });
  });

  it('renders the overlay as a dialog with aria-modal', async () => {
    render(<IntentModal />);

    await waitFor(() => {
      const overlay = document.querySelector('.intent-overlay');
      expect(overlay).toBeInTheDocument();
      expect(overlay!.getAttribute('role')).toBe('dialog');
      expect(overlay!.getAttribute('aria-modal')).toBe('true');
    });
  });
});
