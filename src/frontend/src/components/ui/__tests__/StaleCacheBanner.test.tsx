import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StaleCacheBanner } from '../StaleCacheBanner';

describe('StaleCacheBanner', () => {
  it('renders nothing when cachedAt is undefined', () => {
    const { container } = render(
      <StaleCacheBanner freshness={{ cachedAt: undefined, isOnline: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders amber banner with cached time when cachedAt present', () => {
    render(
      <StaleCacheBanner
        freshness={{ cachedAt: 1_700_000_000_000, isOnline: false }}
      />,
    );
    expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
  });
});
