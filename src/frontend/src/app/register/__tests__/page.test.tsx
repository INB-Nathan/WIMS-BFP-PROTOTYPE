import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next/navigation
const mockRouterPush = vi.fn();

// Enable Turnstile in test environment
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next/image + next/link
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock the registration API
const mockRegisterCivilian = vi.fn().mockResolvedValue({
  status: 'ok',
  message: 'Verification email sent to juan@example.com',
  email: 'juan@example.com',
});
vi.mock('@/lib/api/civilian', () => ({
  registerCivilian: (...args: unknown[]) => mockRegisterCivilian(...args),
}));

// Mock Turnstile as a button that emits a token when clicked, so the test can
// simulate solving the CAPTCHA.
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" data-testid="turnstile" onClick={() => onSuccess('mock-turnstile-token')}>
      Verify
    </button>
  ),
}));

const VALID = {
  email: 'juan@example.com',
  firstName: 'Juan',
  lastName: 'Dela Cruz',
  password: 'TestPassword123!',
  confirmPassword: 'TestPassword123!',
  contact: '09171234567',
};

describe('RegisterPage — field validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterCivilian.mockResolvedValue({
      status: 'ok',
      message: 'Verification email sent to juan@example.com',
      email: 'juan@example.com',
    });
  });

  it('shows validation errors and blocks submit for invalid fields', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    await user.type(screen.getByTestId('email'), 'not-an-email');
    await user.type(screen.getByTestId('password'), 'short');
    await user.type(screen.getByTestId('contact_number'), '12345');

    fireEvent.click(screen.getByTestId('register-submit'));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(
      screen.getByText(/Password does not meet all requirements/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enter a valid Philippine mobile number starting with 09/i),
    ).toBeInTheDocument();
    // No API call should have been made
    expect(mockRegisterCivilian).not.toHaveBeenCalled();
  });

  it('shows dynamic password requirements as user types', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    // Type a password that fails some checks
    const pwInput = screen.getByTestId('password');
    await user.type(pwInput, 'abc');

    // Requirements panel should be visible
    expect(screen.getByTestId('password-requirements')).toBeInTheDocument();
    expect(screen.getByText('At least 12 characters')).toBeInTheDocument();
    expect(screen.getByText('One uppercase letter')).toBeInTheDocument();
    expect(screen.getByText('One lowercase letter')).toBeInTheDocument();
    expect(screen.getByText('One number')).toBeInTheDocument();
    expect(screen.getByText(/One special character/)).toBeInTheDocument();
  });

  it('hides password requirements when all checks are met', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    await user.type(screen.getByTestId('password'), VALID.password);

    expect(screen.queryByTestId('password-requirements')).not.toBeInTheDocument();
  });

  it('shows error when passwords do not match', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    await user.type(screen.getByTestId('email'), VALID.email);
    await user.type(screen.getByTestId('password'), VALID.password);
    await user.type(screen.getByTestId('confirm_password'), 'DifferentPassword1!');
    await user.type(screen.getByTestId('contact_number'), VALID.contact);
    fireEvent.click(screen.getByTestId('dpa_consent'));

    fireEvent.click(screen.getByTestId('register-submit'));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(mockRegisterCivilian).not.toHaveBeenCalled();
  });

  it('requires DPA consent before submitting', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    await user.type(screen.getByTestId('email'), VALID.email);
    await user.type(screen.getByTestId('password'), VALID.password);
    await user.type(screen.getByTestId('confirm_password'), VALID.confirmPassword);
    await user.type(screen.getByTestId('contact_number'), VALID.contact);

    fireEvent.click(screen.getByTestId('register-submit'));

    expect(await screen.findByText(/You must agree to the Data Privacy Act consent/i)).toBeInTheDocument();
    expect(mockRegisterCivilian).not.toHaveBeenCalled();
  });
});

describe('RegisterPage — successful submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterCivilian.mockResolvedValue({
      status: 'ok',
      message: 'Verification email sent to juan@example.com',
      email: 'juan@example.com',
    });
  });

  it('submits valid data and redirects to /verify-sent?email=juan%40example.com', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    // Solve the CAPTCHA first
    fireEvent.click(screen.getByTestId('turnstile'));

    await user.type(screen.getByTestId('email'), VALID.email);
    await user.type(screen.getByTestId('first_name'), VALID.firstName);
    await user.type(screen.getByTestId('last_name'), VALID.lastName);
    await user.type(screen.getByTestId('password'), VALID.password);
    await user.type(screen.getByTestId('confirm_password'), VALID.confirmPassword);
    await user.type(screen.getByTestId('contact_number'), VALID.contact);
    fireEvent.click(screen.getByTestId('dpa_consent'));

    fireEvent.click(screen.getByTestId('register-submit'));

    await waitFor(() => {
      expect(mockRegisterCivilian).toHaveBeenCalledTimes(1);
    });

    expect(mockRegisterCivilian).toHaveBeenCalledWith({
      email: VALID.email,
      first_name: VALID.firstName,
      last_name: VALID.lastName,
      password: VALID.password,
      contact_number: VALID.contact,
      dpa_consent: true,
      turnstile_token: 'mock-turnstile-token',
    });

    expect(mockRouterPush).toHaveBeenCalledWith('/verify-sent?email=juan%40example.com');
  });

  it('shows the server error message when registration fails', async () => {
    const user = userEvent.setup();
    mockRegisterCivilian.mockRejectedValue(new Error('An account with this email already exists'));
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    fireEvent.click(screen.getByTestId('turnstile'));
    await user.type(screen.getByTestId('email'), VALID.email);
    await user.type(screen.getByTestId('password'), VALID.password);
    await user.type(screen.getByTestId('confirm_password'), VALID.confirmPassword);
    await user.type(screen.getByTestId('contact_number'), VALID.contact);
    fireEvent.click(screen.getByTestId('dpa_consent'));

    fireEvent.click(screen.getByTestId('register-submit'));

    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
    // Turnstile token consumed — expired warning should appear for retry
    expect(screen.getByText(/Security check expired/)).toBeInTheDocument();
  });
});
