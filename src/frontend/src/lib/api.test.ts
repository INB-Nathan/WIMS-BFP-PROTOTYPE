/**
 * API client tests — Zero-Trust Civilian Report + National Analyst Analytics.
 *
 * Civilian Report: unauthenticated endpoint, no Keycloak token.
 * Analytics: wrapper URLs resolve to /api/analytics/..., query params serialized correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  submitCivilianReport,
  fetchHeatmapData,
  fetchTrendData,
  fetchComparativeData,
} from './api';

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

describe('Analytics API wrappers', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('fetchHeatmapData', () => {
    it('calls GET /api/analytics/heatmap and resolves to correct URL', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [],
          }),
      });

      await fetchHeatmapData({});

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/api\/analytics\/heatmap/);
    });

    it('serializes query params: start_date, end_date, region_id, alarm_level, incident_type', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ type: 'FeatureCollection', features: [] }),
      });

      await fetchHeatmapData({
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        region_id: 5,
        alarm_level: '1',
        incident_type: 'STRUCTURAL',
      });

      const [url] = fetchSpy.mock.calls[0];
      const u = new URL(url, 'http://localhost');
      expect(u.searchParams.get('start_date')).toBe('2024-01-01');
      expect(u.searchParams.get('end_date')).toBe('2024-01-31');
      expect(u.searchParams.get('region_id')).toBe('5');
      expect(u.searchParams.get('alarm_level')).toBe('1');
      expect(u.searchParams.get('incident_type')).toBe('STRUCTURAL');
    });

    it('returns GeoJSON FeatureCollection with feature properties', async () => {
      const sample = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [121, 14] },
            properties: {
              incident_id: 1,
              alarm_level: '2',
              general_category: 'STRUCTURAL',
              notification_dt: '2024-01-15T10:00:00',
            },
          },
        ],
      };
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(sample) });

      const result = await fetchHeatmapData({});
      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toHaveLength(1);
      expect(result.features[0].properties?.incident_id).toBe(1);
      expect(result.features[0].properties?.general_category).toBe('STRUCTURAL');
    });

    it('surfaces 403 error with detail', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({ detail: 'NATIONAL_ANALYST or SYSTEM_ADMIN required' }),
      });

      await expect(fetchHeatmapData({})).rejects.toThrow(/403|NATIONAL_ANALYST|required/i);
    });

    it('surfaces 500 error', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Internal server error' }),
      });

      await expect(fetchHeatmapData({})).rejects.toThrow();
    });
  });

  describe('fetchTrendData', () => {
    it('calls GET /api/analytics/trends and resolves to correct URL', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      await fetchTrendData({});

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/api\/analytics\/trends/);
    });

    it('serializes query params including interval and alarm_level', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      await fetchTrendData({
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        region_id: 3,
        incident_type: 'NON_STRUCTURAL',
        alarm_level: '2',
        interval: 'weekly',
      });

      const [url] = fetchSpy.mock.calls[0];
      const u = new URL(url, 'http://localhost');
      expect(u.searchParams.get('start_date')).toBe('2024-01-01');
      expect(u.searchParams.get('end_date')).toBe('2024-01-31');
      expect(u.searchParams.get('region_id')).toBe('3');
      expect(u.searchParams.get('incident_type')).toBe('NON_STRUCTURAL');
      expect(u.searchParams.get('alarm_level')).toBe('2');
      expect(u.searchParams.get('interval')).toBe('weekly');
    });

    it('returns trends data with bucket and count', async () => {
      const sample = {
        data: [
          { bucket: '2024-01-01T00:00:00', count: 5 },
          { bucket: null, count: 2 },
        ],
      };
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(sample) });

      const result = await fetchTrendData({});
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ bucket: '2024-01-01T00:00:00', count: 5 });
      expect(result.data[1].bucket).toBeNull();
      expect(result.data[1].count).toBe(2);
    });
  });

  describe('fetchComparativeData', () => {
    it('calls GET /api/analytics/comparative and resolves to correct URL', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
            range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
            variance_percent: 20,
          }),
      });

      await fetchComparativeData({
        range_a_start: '2024-01-01',
        range_a_end: '2024-01-31',
        range_b_start: '2024-02-01',
        range_b_end: '2024-02-29',
      });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/api\/analytics\/comparative/);
    });

    it('serializes range and filter params including alarm_level', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
            range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
            variance_percent: 20,
          }),
      });

      await fetchComparativeData({
        range_a_start: '2024-01-01',
        range_a_end: '2024-01-31',
        range_b_start: '2024-02-01',
        range_b_end: '2024-02-29',
        region_id: 7,
        incident_type: 'VEHICULAR',
        alarm_level: '3',
      });

      const [url] = fetchSpy.mock.calls[0];
      const u = new URL(url, 'http://localhost');
      expect(u.searchParams.get('range_a_start')).toBe('2024-01-01');
      expect(u.searchParams.get('range_a_end')).toBe('2024-01-31');
      expect(u.searchParams.get('range_b_start')).toBe('2024-02-01');
      expect(u.searchParams.get('range_b_end')).toBe('2024-02-29');
      expect(u.searchParams.get('region_id')).toBe('7');
      expect(u.searchParams.get('incident_type')).toBe('VEHICULAR');
      expect(u.searchParams.get('alarm_level')).toBe('3');
    });

    it('returns comparative response shape', async () => {
      const sample = {
        range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
        range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
        variance_percent: 20,
      };
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(sample) });

      const result = await fetchComparativeData({
        range_a_start: '2024-01-01',
        range_a_end: '2024-01-31',
        range_b_start: '2024-02-01',
        range_b_end: '2024-02-29',
      });
      expect(result.range_a).toEqual({ start: '2024-01-01', end: '2024-01-31', count: 10 });
      expect(result.range_b).toEqual({ start: '2024-02-01', end: '2024-02-29', count: 12 });
      expect(result.variance_percent).toBe(20);
    });
  });
});
