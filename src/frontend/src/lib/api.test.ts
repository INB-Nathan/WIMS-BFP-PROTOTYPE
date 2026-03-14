/**
 * API client tests — Zero-Trust Civilian Report.
 *
 * Ensures submitCivilianReport() calls the correct unauthenticated endpoint
 * without trying to attach the Keycloak token.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { submitCivilianReport } from './api';

describe('submitCivilianReport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          report_id: 1,
          latitude: 14.5995,
          longitude: 120.9842,
          description: 'Fire in building',
          trust_score: 0,
          status: 'PENDING',
          created_at: '2025-01-01T00:00:00Z',
        }),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls POST /civilian/reports (unauthenticated endpoint)', async () => {
    await submitCivilianReport({
      latitude: 14.5995,
      longitude: 120.9842,
      description: 'Fire in building',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/civilian\/reports$/);
    expect(options?.method).toBe('POST');
  });

  it('does NOT attach Authorization header or Keycloak token', async () => {
    await submitCivilianReport({
      latitude: 14.5995,
      longitude: 120.9842,
      description: 'Smoke visible',
    });

    const [, options] = fetchSpy.mock.calls[0];
    const headers = (options?.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
    expect(Object.keys(headers).some((k) => k.toLowerCase().includes('bearer'))).toBe(false);
  });

  it('uses credentials: omit to avoid sending auth cookies', async () => {
    await submitCivilianReport({
      latitude: 14.5995,
      longitude: 120.9842,
      description: 'Emergency',
    });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.credentials).toBe('omit');
  });
});
