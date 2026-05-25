'use client';

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CalmEmergencyBlock } from '@/app/CalmEmergencyBlock';

describe('CalmEmergencyBlock', () => {
  it('renders AlertTriangle icon', () => {
    render(<CalmEmergencyBlock />);
    expect(document.querySelector('svg')).toBeTruthy();
  });

  it('renders three bilingual lines', () => {
    render(<CalmEmergencyBlock />);
    const text = document.body.textContent ?? '';

    // Line 1
    expect(text).toContain('Call 911 now if anyone is in immediate danger');
    expect(text).toContain('Tumawag sa 911 kung may tao sa agarang panganib');

    // Line 2
    expect(text).toContain('Move away from smoke or fire');
    expect(text).toContain('Umatras mula sa usok o sunog');

    // Line 3
    expect(text).toContain('Do not get closer to take photos');
    expect(text).toContain('Huwag lumapit para kumuha ng litrato');
  });

  it('has no button, link, or form control', () => {
    render(<CalmEmergencyBlock />);
    expect(document.querySelector('button')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('input')).toBeNull();
  });
});