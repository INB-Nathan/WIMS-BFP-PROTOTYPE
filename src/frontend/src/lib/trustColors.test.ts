import { describe, expect, it } from 'vitest';
import { formatTrustPercent } from './trustColors';

describe('formatTrustPercent', () => {
  it('formats fractional trust scores as percentages', () => {
    expect(formatTrustPercent(0.8)).toBe('80%');
  });

  it('does not multiply already-percent trust scores', () => {
    expect(formatTrustPercent(80)).toBe('80%');
  });
});
