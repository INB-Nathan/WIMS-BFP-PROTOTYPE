/**
 * API client tests — Zero-Trust Civilian Report + National Analyst Analytics.
 *
 * Civilian Report: unauthenticated endpoint, no Keycloak token.
 * Analytics: wrapper URLs resolve to /api/analytics/..., query params serialized correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiFetch,
  submitCivilianReport,
  fetchHeatmapData,
  fetchTrendData,
  fetchComparativeData,
  commitAforImport,
  fetchRegionalIncidents,
  fetchRegionalIncident,
  fetchAdminSecurityLogs,
} from './api';
import { fetchHeatmapData as fetchHeatmapDataFromSlice } from './api/analytics';
import { submitCivilianReport as submitCivilianReportFromSlice } from './api/civilian';
import { fetchRegionalIncidents as fetchRegionalIncidentsFromSlice } from './api/regional';
import {
  buildRegionalIncidentsQueryString,
  clampRegionalPageSize,
  offsetFromPage,
  totalRegionalPages,
} from './regional-incidents';
import { refreshToken } from './auth-refresh';

vi.mock('./auth-refresh', () => ({
  refreshToken: vi.fn(),
}));

describe('apiFetch content-type handling', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
      text: () => Promise.resolve(JSON.stringify({ status: 'ok' })),
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(refreshToken).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets application/json when body is JSON string', async () => {
    await apiFetch('/regional/afor/commit', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
    });

    const [, options] = fetchSpy.mock.calls[0];
    const headers = new Headers(options?.headers as HeadersInit | undefined);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('does not force application/json when body is FormData', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['x'], { type: 'text/plain' }), 'test.txt');

    await apiFetch('/regional/afor/import', {
      method: 'POST',
      body: fd,
    });

    const [, options] = fetchSpy.mock.calls[0];
    const headers = new Headers(options?.headers as HeadersInit | undefined);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('does not retry a 401 request when refreshToken returns ok=false', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: false, reason: 'auth' });
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'expired' }),
      text: () => Promise.resolve(JSON.stringify({ detail: 'expired' })),
    });

    await expect(
      apiFetch('/regional/incidents', { skipAuthRedirect: true }),
    ).rejects.toThrow(/session expired/i);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('domain API slices', () => {
  it('keep compatibility exports aligned with domain slice exports', () => {
    expect(fetchHeatmapDataFromSlice).toBe(fetchHeatmapData);
    expect(submitCivilianReportFromSlice).toBe(submitCivilianReport);
    expect(fetchRegionalIncidentsFromSlice).toBe(fetchRegionalIncidents);
  });
});

describe('fetchAdminSecurityLogs response parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses paginated admin envelope {items: [...], total} ', async () => {
    const responseBody = {
      items: [{ log_id: 101, severity_level: 'HIGH' }],
      total: 1,
      limit: 20,
      offset: 0,
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchAdminSecurityLogs();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ log_id: 101, severity_level: 'HIGH' });
    expect(result.total).toBe(1);
  });

  it('keeps backward compatibility for {data: [...]} responses', async () => {
    const responseBody = { data: [{ log_id: 7 }] };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchAdminSecurityLogs();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ log_id: 7 });
  });
});

describe('submitCivilianReport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const civilianReportResponse = {
    report_id: 1,
    latitude: 14.5995,
    longitude: 120.9842,
    description: 'Fire in building',
    trust_score: 0,
    status: 'PENDING',
    created_at: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(civilianReportResponse),
      text: () => Promise.resolve(JSON.stringify(civilianReportResponse)),
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

describe('regional incidents query & pagination helpers', () => {
  it('buildRegionalIncidentsQueryString sets limit, offset, category, status with correct keys', () => {
    expect(
      buildRegionalIncidentsQueryString({
        limit: 25,
        offset: 50,
        category: 'STRUCTURAL',
        status: 'VERIFIED',
      })
    ).toBe('limit=25&offset=50&category=STRUCTURAL&status=VERIFIED');
  });

  it('buildRegionalIncidentsQueryString omits undefined and empty filters', () => {
    expect(buildRegionalIncidentsQueryString({ limit: 10, offset: 0 })).toBe('limit=10&offset=0');
    expect(buildRegionalIncidentsQueryString({ limit: 10, offset: 0, category: '', status: '  ' })).toBe(
      'limit=10&offset=0'
    );
    expect(buildRegionalIncidentsQueryString({ category: '  VEHICULAR  ' })).toBe('category=VEHICULAR');
  });

  it('offsetFromPage uses clamped page size', () => {
    expect(offsetFromPage(0, 10)).toBe(0);
    expect(offsetFromPage(2, 10)).toBe(20);
    expect(offsetFromPage(1, 25)).toBe(25);
    expect(offsetFromPage(3, 50)).toBe(150);
  });

  it('offsetFromPage clamps negative page index to 0', () => {
    expect(offsetFromPage(-1, 10)).toBe(0);
  });

  it('clampRegionalPageSize allows only 10, 25, 50 (fallback 10)', () => {
    expect(clampRegionalPageSize(25)).toBe(25);
    expect(clampRegionalPageSize(50)).toBe(50);
    expect(clampRegionalPageSize(10)).toBe(10);
    expect(clampRegionalPageSize(99)).toBe(10);
    expect(clampRegionalPageSize(NaN)).toBe(10);
  });

  it('totalRegionalPages returns at least 1; ceil(total/pageSize)', () => {
    expect(totalRegionalPages(0, 10)).toBe(1);
    expect(totalRegionalPages(1, 10)).toBe(1);
    expect(totalRegionalPages(100, 25)).toBe(4);
    expect(totalRegionalPages(101, 25)).toBe(5);
  });
});

describe('fetchRegionalIncidents / fetchRegionalIncident', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const regionalIncidentsResponse = {
    items: [],
    total: 0,
    limit: 10,
    offset: 0,
  };

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(regionalIncidentsResponse),
      text: () => Promise.resolve(JSON.stringify(regionalIncidentsResponse)),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /regional/incidents with pagination and filters in query string', async () => {
    await fetchRegionalIncidents({
      limit: 25,
      offset: 10,
      category: 'NON_STRUCTURAL',
      status: 'PENDING',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0];
    const u = new URL(url, 'http://localhost');
    expect(u.pathname).toMatch(/\/regional\/incidents$/);
    expect(u.searchParams.get('limit')).toBe('25');
    expect(u.searchParams.get('offset')).toBe('10');
    expect(u.searchParams.get('category')).toBe('NON_STRUCTURAL');
    expect(u.searchParams.get('status')).toBe('PENDING');
  });

  it('GET /regional/incidents omits empty filters', async () => {
    await fetchRegionalIncidents({ limit: 10, offset: 0, category: '', status: undefined });

    const [url] = fetchSpy.mock.calls[0];
    const u = new URL(url, 'http://localhost');
    expect(u.searchParams.has('category')).toBe(false);
    expect(u.searchParams.has('status')).toBe(false);
  });

  it('GET /regional/incidents/{id}', async () => {
    const incidentResponse = {
      incident_id: 7,
      verification_status: 'DRAFT',
      created_at: '2025-01-01T00:00:00Z',
      region_id: 1,
      nonsensitive: { alarm_level: 'First Alarm' },
      sensitive: { caller_name: 'A' },
    };
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(incidentResponse),
      text: () => Promise.resolve(JSON.stringify(incidentResponse)),
    });

    const row = await fetchRegionalIncident(7);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/regional\/incidents\/7(?:\?|$)/);
    expect(row.incident_id).toBe(7);
    expect(row.nonsensitive.alarm_level).toBe('First Alarm');
  });
});

describe('commitAforImport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const commitResponse = {
    status: 'ok',
    batch_id: 1,
    incident_ids: [42],
    total_committed: 1,
  };

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(commitResponse),
      text: () => Promise.resolve(JSON.stringify(commitResponse)),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs /regional/afor/commit with latitude, longitude, and form_kind', async () => {
    await commitAforImport([{ _form_kind: 'WILDLAND_AFOR', wildland: {} }], 'WILDLAND_AFOR', {
      latitude: 14.5547,
      longitude: 121.0244,
      wildlandRowSource: 'MANUAL',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options?.body as string) ?? '{}');
    expect(body.form_kind).toBe('WILDLAND_AFOR');
    expect(body.latitude).toBe(14.5547);
    expect(body.longitude).toBe(121.0244);
    expect(body.wildland_row_source).toBe('MANUAL');
  });
});

describe('Analytics API wrappers', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('{}'),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('fetchHeatmapData', () => {
    it('calls GET /api/analytics/heatmap and resolves to correct URL', async () => {
      const responseBody = { type: 'FeatureCollection', features: [] };
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseBody),
        text: () => Promise.resolve(JSON.stringify(responseBody)),
      });

      await fetchHeatmapData({});

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/api\/analytics\/heatmap/);
    });

    it('serializes query params: start_date, end_date, region_id, alarm_level, incident_type', async () => {
      const responseBody = { type: 'FeatureCollection', features: [] };
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseBody),
        text: () => Promise.resolve(JSON.stringify(responseBody)),
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
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(sample), text: () => Promise.resolve(JSON.stringify(sample)) });

      const result = await fetchHeatmapData({});
      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toHaveLength(1);
      expect(result.features[0].properties?.incident_id).toBe(1);
      expect(result.features[0].properties?.general_category).toBe('STRUCTURAL');
    });

    it('surfaces 403 error with detail', async () => {
      const errDetail = { detail: 'NATIONAL_ANALYST or SYSTEM_ADMIN required' };
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve(errDetail),
        text: () => Promise.resolve(JSON.stringify(errDetail)),
      });

      await expect(fetchHeatmapData({})).rejects.toThrow(/403|NATIONAL_ANALYST|required/i);
    });

    it('surfaces 500 error', async () => {
      const errDetail = { detail: 'Internal server error' };
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve(errDetail),
        text: () => Promise.resolve(JSON.stringify(errDetail)),
      });

      await expect(fetchHeatmapData({})).rejects.toThrow();
    });
  });

  describe('fetchTrendData', () => {
    it('calls GET /api/analytics/trends and resolves to correct URL', async () => {
      const responseBody = { data: [] };
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseBody),
        text: () => Promise.resolve(JSON.stringify(responseBody)),
      });

      await fetchTrendData({});

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/api\/analytics\/trends/);
    });

    it('serializes query params including interval and alarm_level', async () => {
      const responseBody = { data: [] };
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseBody),
        text: () => Promise.resolve(JSON.stringify(responseBody)),
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
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(sample), text: () => Promise.resolve(JSON.stringify(sample)) });

      const result = await fetchTrendData({});
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ bucket: '2024-01-01T00:00:00', count: 5 });
      expect(result.data[1].bucket).toBeNull();
      expect(result.data[1].count).toBe(2);
    });
  });

  describe('fetchComparativeData', () => {
    it('calls GET /api/analytics/comparative and resolves to correct URL', async () => {
      const responseBody = {
        range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
        range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
        variance_percent: 20,
      };
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseBody),
        text: () => Promise.resolve(JSON.stringify(responseBody)),
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
      const responseBody = {
        range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
        range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
        variance_percent: 20,
      };
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseBody),
        text: () => Promise.resolve(JSON.stringify(responseBody)),
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
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(sample), text: () => Promise.resolve(JSON.stringify(sample)) });

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
