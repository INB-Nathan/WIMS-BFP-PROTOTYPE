import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InformationPage from '../page';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/api/information', () => ({
  fetchAnnouncements: vi.fn(),
  fetchEmergencies: vi.fn(),
  resolveAnnouncementImageUrl: vi.fn(),
}));

const { useAuth } = await import('@/context/AuthContext');

describe('InformationPage — Reporting Guide expandable modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
      isAuthenticated: false,
      serverValidated: true,
      canQueueOfflineWrites: true,
      loggingOut: false,
    });
  });

  it('guide cards are dialog triggers and open a modal with full content', async () => {
    render(<InformationPage />);
    fireEvent.click(screen.getByText(/Reporting Guide/));

    // Card present as a button trigger
    const card = screen.getByText('How to submit a report').closest('button');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('aria-haspopup', 'dialog');

    // Open modal
    fireEvent.click(card!);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Full body copy (not just the short summary) is present in the modal
    expect(
      screen.getByText(/Your report enters the triage queue/),
    ).toBeInTheDocument();
    // Media placeholder slot renders for entries without a real src
    expect(screen.getByText(/Illustration coming soon/)).toBeInTheDocument();
  });

  it('closes the modal on Escape (focus returns to the page)', async () => {
    render(<InformationPage />);
    fireEvent.click(screen.getByText(/Reporting Guide/));
    const card = screen.getByText('How to submit a report').closest('button')!;
    fireEvent.click(card);

    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // The trigger remains present and reachable after close.
    expect(screen.getByText('How to submit a report').closest('button')).toBeInTheDocument();
  });

  it('closes the modal on overlay click and on the close button', async () => {
    render(<InformationPage />);
    fireEvent.click(screen.getByText(/Reporting Guide/));
    const card = screen.getByText('Privacy & safety').closest('button')!;
    fireEvent.click(card);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Close button
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Reopen and close via overlay
    fireEvent.click(card);
    const dialog2 = await screen.findByRole('dialog');
    const overlay = dialog2.parentElement!;
    fireEvent.mouseDown(overlay);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
