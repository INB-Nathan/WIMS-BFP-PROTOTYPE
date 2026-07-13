import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={String(props.alt ?? '')} />;
  },
}));

describe('ReportTrackerCompatibilityPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    mockSearchParams = new URLSearchParams();
  });

  it('shows the stored secure tracking link when available', async () => {
    localStorage.setItem(
      'wims_last_report',
      JSON.stringify({
        id: 42,
        category: 'STRUCTURAL',
        tracking_url: '/tracking/v2/42/token-abc',
      }),
    );

    const { default: Page } = await import('./page');
    render(<Page />);

    const link = await screen.findByRole('link', {
      name: /open my latest secure tracking link/i,
    });
    expect(link.getAttribute('href')).toBe('/tracking/v2/42/token-abc');
  });

  it('shows the fallback message when no secure tracking link is stored', async () => {
    const { default: Page } = await import('./page');
    render(<Page />);

    expect(
      await screen.findByText(/no stored secure tracking link was found on this device/i),
    ).toBeInTheDocument();
  });

  it('prefers the stored report-specific secure tracking link when report_id is present', async () => {
    mockSearchParams = new URLSearchParams('report_id=7');
    localStorage.setItem(
      'wims_tracking_links_by_report',
      JSON.stringify({
        '7': '/tracking/v2/7/token-seven',
        '42': '/tracking/v2/42/token-abc',
      }),
    );

    const { default: Page } = await import('./page');
    render(<Page />);

    const link = await screen.findByRole('link', {
      name: /open my latest secure tracking link/i,
    });
    expect(link.getAttribute('href')).toBe('/tracking/v2/7/token-seven');
  });
});
