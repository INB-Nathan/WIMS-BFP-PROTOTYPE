import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiRequestError } from '../errors';
import { publicApiFetch } from '../public-transport';

describe('publicApiFetch error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ApiRequestError with .status and .retryAfter on a 429', async () => {
    const mockResponse = new Response(
      JSON.stringify({ detail: 'Too many reports from this network. Try again in 60 minutes.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
      },
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    try {
      await publicApiFetch('/civilian/reports', { method: 'POST', body: '{}' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(429);
      expect((err as ApiRequestError).retryAfter).toBe(3600);
      expect((err as ApiRequestError).message).toContain('Too many reports');
    }
  });

  it('throws ApiRequestError with .status on a 500 (no Retry-After)', async () => {
    const mockResponse = new Response(
      JSON.stringify({ detail: 'Failed to create report' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    try {
      await publicApiFetch('/civilian/reports', { method: 'POST', body: '{}' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(500);
      expect((err as ApiRequestError).retryAfter).toBeUndefined();
    }
  });
});
