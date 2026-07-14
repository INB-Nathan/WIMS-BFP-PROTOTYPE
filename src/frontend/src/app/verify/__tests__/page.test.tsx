import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockRouterPush = vi.fn();
const mockVerify = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@/lib/api/civilian', () => ({
  verifyCivilianRegistration: (...args: unknown[]) => mockVerify(...args),
}));

describe('VerifyPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockRouterPush.mockReset();
    mockVerify.mockReset();
    mockSearchParams.delete('email');
    mockSearchParams.delete('code');
  });

  it('renders the verify form with title', async () => {
    const { default: VerifyPage } = await import('../page');
    render(<VerifyPage />);

    expect(await screen.findByText('Verify Your Email')).toBeInTheDocument();
    expect(screen.getByTestId('verify-email')).toBeInTheDocument();
    expect(screen.getByTestId('verify-code')).toBeInTheDocument();
    expect(screen.getByTestId('verify-submit')).toBeInTheDocument();
  });

  it('pre-fills email and code from URL and marks code read-only', async () => {
    mockSearchParams.set('email', 'juan@example.com');
    mockSearchParams.set('code', '123456');

    const { default: VerifyPage } = await import('../page');
    render(<VerifyPage />);

    const emailInput = await screen.findByTestId('verify-email');
    const codeInput = screen.getByTestId('verify-code');
    expect(emailInput).toHaveValue('juan@example.com');
    expect(codeInput).toHaveValue('123456');
    expect(codeInput).toHaveAttribute('readonly');
  });

  it('verifies a valid code and redirects to /login?verified=true', async () => {
    mockVerify.mockResolvedValue({ status: 'ok', message: 'Email verified. You can now log in.' });
    const { default: VerifyPage } = await import('../page');
    render(<VerifyPage />);

    const emailInput = await screen.findByTestId('verify-email');
    const codeInput = screen.getByTestId('verify-code');
    fireEvent.change(emailInput, { target: { value: 'juan@example.com' } });
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('verify-submit'));

    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));
    expect(mockVerify).toHaveBeenCalledWith({
      email: 'juan@example.com',
      code: '123456',
    });
    expect(mockRouterPush).toHaveBeenCalledWith('/login?verified=true');
    expect(screen.queryByTestId('verify-error')).not.toBeInTheDocument();
  });

  it('shows an error message for an invalid code', async () => {
    mockVerify.mockRejectedValue(new Error('Invalid verification code. Please check and try again.'));
    const { default: VerifyPage } = await import('../page');
    render(<VerifyPage />);

    const emailInput = await screen.findByTestId('verify-email');
    const codeInput = screen.getByTestId('verify-code');
    fireEvent.change(emailInput, { target: { value: 'juan@example.com' } });
    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('verify-submit'));

    expect(await screen.findByTestId('verify-error')).toHaveTextContent(
      'Invalid verification code. Please check and try again.',
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('requires email and code before submitting', async () => {
    const { default: VerifyPage } = await import('../page');
    render(<VerifyPage />);

    fireEvent.click(await screen.findByTestId('verify-submit'));

    expect(await screen.findByTestId('verify-error')).toHaveTextContent('Email is required.');
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
