import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next/navigation
const mockRouterPush = vi.fn();
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
  message: 'Account created successfully. You can now log in.',
  user_id: 'abc-123',
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
  password: 'Password1',
  contact: '09171234567',
};

describe('RegisterPage — field validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterCivilian.mockResolvedValue({
      status: 'ok',
      message: 'Account created successfully. You can now log in.',
      user_id: 'abc-123',
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
      screen.getByText(/Password must be at least 8 characters and include an uppercase letter/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enter a valid Philippine mobile number starting with 09/i),
    ).toBeInTheDocument();
    // No API call should have been made
    expect(mockRegisterCivilian).not.toHaveBeenCalled();
  });

  it('requires DPA consent before submitting', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    await user.type(screen.getByTestId('email'), VALID.email);
    await user.type(screen.getByTestId('password'), VALID.password);
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
      message: 'Account created successfully. You can now log in.',
      user_id: 'abc-123',
    });
  });

  it('submits valid data and redirects to /login?registered=true', async () => {
    const user = userEvent.setup();
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    // Solve the CAPTCHA first
    fireEvent.click(screen.getByTestId('turnstile'));

    await user.type(screen.getByTestId('email'), VALID.email);
    await user.type(screen.getByTestId('first_name'), VALID.firstName);
    await user.type(screen.getByTestId('last_name'), VALID.lastName);
    await user.type(screen.getByTestId('password'), VALID.password);
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

    expect(mockRouterPush).toHaveBeenCalledWith('/login?registered=true');
  });

  it('shows the server error message when registration fails', async () => {
    const user = userEvent.setup();
    mockRegisterCivilian.mockRejectedValue(new Error('An account with this email already exists'));
    const { default: RegisterPage } = await import('../page');
    render(<RegisterPage />);

    fireEvent.click(screen.getByTestId('turnstile'));
    await user.type(screen.getByTestId('email'), VALID.email);
    await user.type(screen.getByTestId('password'), VALID.password);
    await user.type(screen.getByTestId('contact_number'), VALID.contact);
    fireEvent.click(screen.getByTestId('dpa_consent'));

    fireEvent.click(screen.getByTestId('register-submit'));

    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
