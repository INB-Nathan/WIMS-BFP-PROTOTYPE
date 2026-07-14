import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockSearchParams = { get: (key: string) => (key === 'registered' ? 'true' : null) };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, login: vi.fn() }),
}));

describe('LoginPage — registration success banner', () => {
  it('shows the green banner when ?registered=true', async () => {
    mockSearchParams.get = (key: string) => (key === 'registered' ? 'true' : null);
    const { default: LoginPage } = await import('../login/page');
    render(<LoginPage />);

    expect(
      screen.getByText('Account created! Sign in to continue.'),
    ).toBeInTheDocument();
  });

  it('hides the banner when ?registered is absent', async () => {
    mockSearchParams.get = () => null;
    const { default: LoginPage } = await import('../login/page');
    render(<LoginPage />);

    expect(
      screen.queryByText('Account created! Sign in to continue.'),
    ).not.toBeInTheDocument();
  });

  it('hides the banner when ?registered=false', async () => {
    mockSearchParams.get = (key: string) => (key === 'registered' ? 'false' : null);
    const { default: LoginPage } = await import('../login/page');
    render(<LoginPage />);

    expect(
      screen.queryByText('Account created! Sign in to continue.'),
    ).not.toBeInTheDocument();
  });
});
