import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('VerifySentPage', () => {
  it('renders the check-your-email instructions with the email', async () => {
    mockSearchParams.set('email', 'juan@example.com');
    const { default: VerifySentPage } = await import('../page');
    render(<VerifySentPage />);

    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(
      screen.getByText(/We sent a verification code to the address below/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('verify-sent-email')).toHaveTextContent('juan@example.com');
  });

  it('links to the manual code entry page with the encoded email', async () => {
    mockSearchParams.set('email', 'juan@example.com');
    const { default: VerifySentPage } = await import('../page');
    render(<VerifySentPage />);

    const link = await screen.findByTestId('verify-sent-enter-code');
    expect(link).toHaveAttribute('href', '/verify?email=juan%40example.com');
  });

  it('shows the spam-folder note', async () => {
    mockSearchParams.set('email', 'juan@example.com');
    const { default: VerifySentPage } = await import('../page');
    render(<VerifySentPage />);

    expect(
      await screen.findByText(/Can't find the email\? Check your spam folder/i),
    ).toBeInTheDocument();
  });

  it('falls back gracefully when email is missing', async () => {
    mockSearchParams.delete('email');
    const { default: VerifySentPage } = await import('../page');
    render(<VerifySentPage />);

    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(
      screen.getByText(/We sent a verification code to your email\./i),
    ).toBeInTheDocument();
    const link = screen.getByTestId('verify-sent-enter-code');
    expect(link).toHaveAttribute('href', '/verify');
  });
});
