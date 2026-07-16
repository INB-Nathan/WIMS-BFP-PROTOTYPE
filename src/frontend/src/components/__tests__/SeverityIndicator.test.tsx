import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  IconCircleFilled,
  IconTriangleFilled,
  IconOctagonFilled,
  IconAlertTriangleFilled,
} from '@tabler/icons-react';
import { SeverityIndicator } from '../SeverityIndicator';

/**
 * Render a reference Tabler icon and return its SVG element's innerHTML
 * (path data, which is stable across renders).
 */
function referenceIconInnerHtml(
  Icon: React.ComponentType<{ size?: number; className?: string }>,
  size = 24,
): string {
  const { container } = render(<Icon size={size} />);
  const svg = container.querySelector('svg');
  return svg?.innerHTML ?? '';
}

describe('SeverityIndicator', () => {
  it('renders low severity with circle shape and green color', () => {
    const { container } = render(<SeverityIndicator level="low" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'Low severity');
    expect(svg).toHaveStyle({ color: '#059669' });
    // Verify correct icon identity (IconCircleFilled)
    expect(svg?.innerHTML).toBe(referenceIconInnerHtml(IconCircleFilled));
  });

  it('renders medium severity with triangle shape and yellow color', () => {
    const { container } = render(<SeverityIndicator level="medium" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'Medium severity');
    expect(svg).toHaveStyle({ color: '#d97706' });
    // Verify correct icon identity (IconTriangleFilled)
    expect(svg?.innerHTML).toBe(referenceIconInnerHtml(IconTriangleFilled));
  });

  it('renders high severity with octagon shape and orange color', () => {
    const { container } = render(<SeverityIndicator level="high" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'High severity');
    expect(svg).toHaveStyle({ color: '#ea580c' });
    // Verify correct icon identity (IconOctagonFilled)
    expect(svg?.innerHTML).toBe(referenceIconInnerHtml(IconOctagonFilled));
  });

  it('renders critical severity with alert triangle shape and red color', () => {
    const { container } = render(<SeverityIndicator level="critical" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'Critical severity');
    expect(svg).toHaveStyle({ color: '#dc2626' });
    // Verify correct icon identity (IconAlertTriangleFilled)
    expect(svg?.innerHTML).toBe(referenceIconInnerHtml(IconAlertTriangleFilled));
  });

  it('accepts custom size prop', () => {
    const { container } = render(<SeverityIndicator level="low" size={32} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('applies custom className', () => {
    const { container } = render(<SeverityIndicator level="low" className="custom-class" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('custom-class');
  });

  it('has role="img" for accessibility', () => {
    const { container } = render(<SeverityIndicator level="critical" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('role', 'img');
  });
});
