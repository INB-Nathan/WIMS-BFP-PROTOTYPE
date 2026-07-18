import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePublicEmergencies } from '../usePublicEmergencies';

vi.mock('../api/information', () => ({
  fetchEmergencies: vi.fn(),
}));

import { fetchEmergencies } from '../api/information';

describe('usePublicEmergencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchEmergencies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, title: 'A', severity: 'critical' },
      { id: 2, title: 'B', severity: 'moderate' },
    ]);
  });

  it('fetches once on mount and exposes the payload', async () => {
    const { result } = renderHook(() => usePublicEmergencies());

    expect(result.current.loading).toBe(true);
    expect(result.current.emergencies).toEqual([]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchEmergencies).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.emergencies).toHaveLength(2);
    expect(result.current.error).toBe(false);
  });

  it('sets error state when the fetch rejects and retry re-fetches', async () => {
    (fetchEmergencies as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const { result } = renderHook(() => usePublicEmergencies());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe(true);
    expect(result.current.emergencies).toEqual([]);

    (fetchEmergencies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 3, title: 'C', severity: 'high' },
    ]);
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    expect(fetchEmergencies).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(false);
    expect(result.current.emergencies).toHaveLength(1);
  });
});
