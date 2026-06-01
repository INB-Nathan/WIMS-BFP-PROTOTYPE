/**
 * Profile page tests — email editing, warning text, All Regions display.
 * Issues #28, #86.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProfilePage from '../page';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/context/AuthContext';

const mockFetchMyProfile = vi.fn();
const mockUpdateMyProfile = vi.fn();
const mockChangeMyPassword = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchMyProfile: () => mockFetchMyProfile(),
  updateMyProfile: (p: object) => mockUpdateMyProfile(p),
  changeMyPassword: (p: object) => mockChangeMyPassword(p),
}));

/**
 * Helper: configure useAuth mock for a NATIONAL_ANALYST user.
 */
function mockAnalystUser(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'user-1',
      email: 'analyst@bfp.gov.ph',
      preferred_username: 'analyst@bfp.gov.ph',
      username: 'analyst@bfp.gov.ph',
      role: 'NATIONAL_ANALYST',
      assignedRegionId: null,
      ...overrides,
    } as any,
    loading: false,
    loggingOut: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  });
}

/**
 * Helper: configure API mocks for a clean analyst profile response.
 */
function mockProfileResponse(overrides: Record<string, unknown> = {}) {
  mockFetchMyProfile.mockResolvedValue({
    first_name: 'Jane',
    last_name: 'Analyst',
    email: 'analyst@bfp.gov.ph',
    contact_number: '09171234567',
    ...overrides,
  });
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalystUser();
    mockProfileResponse();
  });

  // ---------------------------------------------------------------------------
  // Email input
  // ---------------------------------------------------------------------------
  describe('email editing', () => {
    it('renders the email input field', async () => {
      render(<ProfilePage />);

      await waitFor(() => {
        const el = document.getElementById('profile-email');
        expect(el).toBeInTheDocument();
        expect(el).toHaveAttribute('type', 'email');
      });
    });

    it('shows the current email in the display label', async () => {
      render(<ProfilePage />);

      await waitFor(() => {
        const emailInput = document.getElementById('profile-email');
        expect(emailInput).toBeInTheDocument();
        // The placeholder shows the fetched email
        expect(emailInput).toHaveAttribute('placeholder', 'analyst@bfp.gov.ph');
      });
    });

    it('shows warning about email changing login identity', async () => {
      render(<ProfilePage />);

      await waitFor(() => {
        expect(
          screen.getByText(/changing your email may update your login identity/i),
        ).toBeInTheDocument();
      });
    });

    it('displays fallback when profile has no email', async () => {
      mockProfileResponse({ email: undefined });

      render(<ProfilePage />);

      await waitFor(() => {
        // Should fall back to the user context email
        const emailInput = screen.getByPlaceholderText(/analyst@bfp/i);
        expect(emailInput).toBeInTheDocument();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // All Regions display for NATIONAL_ANALYST
  // ---------------------------------------------------------------------------
  describe('region display', () => {
    it('shows "All Regions" for NATIONAL_ANALYST', async () => {
      render(<ProfilePage />);

      await waitFor(() => {
        expect(screen.getByText('All Regions')).toBeInTheDocument();
      });
    });

    it('shows "National" for SYSTEM_ADMIN', async () => {
      mockAnalystUser({ role: 'SYSTEM_ADMIN', username: 'admin', email: 'admin@bfp.gov.ph' });

      render(<ProfilePage />);

      await waitFor(() => {
        expect(screen.getByText('National')).toBeInTheDocument();
      });
    });

    it('shows region ID for REGIONAL_ENCODER', async () => {
      mockAnalystUser({
        role: 'REGIONAL_ENCODER',
        username: 'encoder_ncr',
        email: 'encoder_ncr@bfp.gov.ph',
        assignedRegionId: 13,
      });

      render(<ProfilePage />);

      await waitFor(() => {
        expect(screen.getByText('13')).toBeInTheDocument();
      });
    });

    it('shows "—" for user with no assigned region', async () => {
      mockAnalystUser({
        role: 'NATIONAL_VALIDATOR',
        username: 'validator',
        email: 'validator@bfp.gov.ph',
        assignedRegionId: null,
      });

      render(<ProfilePage />);

      await waitFor(() => {
        expect(screen.getByText('—')).toBeInTheDocument();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Profile save
  // ---------------------------------------------------------------------------
  describe('profile save', () => {
    it('calls updateMyProfile with email when provided', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();

      render(<ProfilePage />);

      await waitFor(() => {
        expect(screen.getByText(/all regions/i)).toBeInTheDocument();
      });

      const emailInput = document.getElementById('profile-email') as HTMLInputElement;
      await user.clear(emailInput);
      await user.type(emailInput, 'new.email@bfp.gov.ph');

      const saveBtn = screen.getByText(/save changes/i);
      await user.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdateMyProfile).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'new.email@bfp.gov.ph' }),
        );
      });
    });
  });
});
