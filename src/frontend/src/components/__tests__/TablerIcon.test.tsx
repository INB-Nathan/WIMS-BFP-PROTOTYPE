import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { IconStar, IconStarFilled } from '@tabler/icons-react';
import { TablerIconWrapper } from '../TablerIcon';

describe('TablerIconWrapper', () => {
  it('renders the passed icon as an SVG element', () => {
    const { container } = render(<TablerIconWrapper icon={IconStar} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('sets aria-label and role="img" when aria-label is provided', () => {
    const { container } = render(
      <TablerIconWrapper icon={IconStarFilled} aria-label="Star icon" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'Star icon');
    expect(svg).toHaveAttribute('role', 'img');
  });

  it('does not set role="img" when no aria-label is provided (aria-hidden path)', () => {
    const { container } = render(<TablerIconWrapper icon={IconStar} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).not.toHaveAttribute('role');
  });

  it('respects className prop', () => {
    const { container } = render(
      <TablerIconWrapper icon={IconStarFilled} className="custom-icon-class" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('custom-icon-class');
  });

  it('handles undefined/null Icon gracefully without throwing', () => {
    // Undefined icon
    const { container: containerUndefined } = render(
      <TablerIconWrapper icon={undefined as unknown as typeof IconStar} />,
    );
    expect(containerUndefined.querySelector('svg')).not.toBeInTheDocument();

    // Null icon
    const { container: containerNull } = render(
      <TablerIconWrapper icon={null as unknown as typeof IconStar} />,
    );
    expect(containerNull.querySelector('svg')).not.toBeInTheDocument();
  });
});
