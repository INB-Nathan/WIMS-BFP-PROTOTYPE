import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PublicThemeProvider } from '../PublicThemeProvider';

describe('PublicThemeProvider', () => {
  it('does NOT render the header (banner) when showHeader is false', () => {
    render(
      <PublicThemeProvider showHeader={false}>
        <div>body</div>
      </PublicThemeProvider>,
    );

    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders the header (banner) by default when showHeader is true', () => {
    render(
      <PublicThemeProvider>
        <div>body</div>
      </PublicThemeProvider>,
    );

    expect(screen.queryByRole('banner')).not.toBeNull();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});
