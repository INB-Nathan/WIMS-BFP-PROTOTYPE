import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from './page';

describe('PrivacyPage', () => {
  it('uses the shared public-surface theme tokens', () => {
    const { container } = render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: 'Data Privacy and Retention Policy' })).toBeInTheDocument();
    expect(container.querySelector('.ps-has-mesh')).toBeInTheDocument();
    expect(container.querySelector('.ps-card')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/--content-bg|--card-bg|--bfp-|--border-color/);
  });
});
