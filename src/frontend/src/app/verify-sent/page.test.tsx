import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('email=znarfkrik8%40gmail.com'),
}));

import VerifySentPage from './page';

describe('VerifySentPage', () => {
  it('renders the formal verification confirmation and preserves the email in the next step', () => {
    render(<VerifySentPage />);

    expect(screen.getByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByTestId('verify-sent-email')).toHaveTextContent('znarfkrik8@gmail.com');
    expect(screen.getByTestId('verify-sent-enter-code')).toHaveAttribute(
      'href',
      '/verify?email=znarfkrik8%40gmail.com',
    );
  });
});
