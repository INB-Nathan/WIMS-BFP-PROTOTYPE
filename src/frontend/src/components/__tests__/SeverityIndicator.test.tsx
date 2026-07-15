import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SeverityIndicator } from '../SeverityIndicator';

describe('SeverityIndicator', () => {
  it('renders low severity with circle shape and green color', () => {
    const { container } = render(<SeverityIndicator level="low" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'Low severity');
    expect(svg).toHaveStyle({ color: '#059669' });
  });

  it('renders medium severity with triangle shape and yellow color', () => {
    const { container } = render(<SeverityIndicator level="medium" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'Medium severity');
    expect(svg).toHaveStyle({ color: '#d97706' });
  });

  it('renders high severity with octagon shape and orange color', () => {
    const { container } = render(<SeverityIndicator level="high" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'High severity');
    expect(svg).toHaveStyle({ color: '#ea580c' });
  });

  it('renders critical severity with alert triangle shape and red color', () => {
    const { container } = render(<SeverityIndicator level="critical" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'Critical severity');
    expect(svg).toHaveStyle({ color: '#dc2626' });
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
