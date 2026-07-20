/**
 * offlineCivilian tests — Pattern C (vi.hoisted + vi.mock).
 *
 * Verifies the offline-aware wrappers around submit/append/followup.
 *
 * The wrappers follow the validator-style Pattern B from the handoff:
 *   - on shouldServeOffline() → queue locally and return queued=true
 *   - on network error (TypeError) → mark connectivity offline, queue, return queued=true
 *   - on 4xx (including 422) → re-throw, do NOT queue
 *   - on success → return { queued: false, ... }
 *
 * Public-side API surface intentionally omits `appendCivilianReport`-style
 * generic fetches — it explicitly exposes the three operations the civilian
 * flow actually performs (submit, append, followup) so the page.tsx wiring
 * stays shallow.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock connectivity ──────────────────────────────────────────────
const connectivityMocks = vi.hoisted(() => ({
  connectivitySnapshot: {
    state: 'online' as 'online' | 'offline' | 'checking' | 'reconnecting',
    isOnline: true,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null as number | null,
  },
  markConnectivityOffline: vi.fn(),
}));

vi.mock('../../connectivity', () => ({
  getConnectivitySnapshot: () => connectivityMocks.connectivitySnapshot,
  markConnectivityOffline: connectivityMocks.markConnectivityOffline,
}));

// ── Mock offlineStore ──────────────────────────────────────────────
const offlineStoreMocks = vi.hoisted(() => ({
  queuePublicOfflineOp: vi.fn(),
}));

vi.mock('../../offlineStore', () => ({
  queuePublicOfflineOp: offlineStoreMocks.queuePublicOfflineOp,
}));

const reporterIdentityMocks = vi.hoisted(() => ({
  encryptOfflineReporterIdentity: vi.fn(),
}));

vi.mock('../../offlineReporterIdentity', () => ({
  encryptOfflineReporterIdentity: reporterIdentityMocks.encryptOfflineReporterIdentity,
}));

// ── Mock legacy API (the publicApiFetch surface used by civilian.ts) ─
const legacyMocks = vi.hoisted(() => ({
  submitCivilianReportV2: vi.fn(),
  appendCivilianReport: vi.fn(),
  submitFollowup: vi.fn(),
}));

vi.mock('../legacy', () => ({
  submitCivilianReportV2: legacyMocks.submitCivilianReportV2,
  appendCivilianReport: legacyMocks.appendCivilianReport,
  submitFollowup: legacyMocks.submitFollowup,
}));

// ── Tests ──────────────────────────────────────────────────────────

const DEVICE_ID = 'device-aaa';

function setConnectivity(state: 'online' | 'offline') {
  connectivityMocks.connectivitySnapshot.state = state;
  connectivityMocks.connectivitySnapshot.isOnline = state === 'online';
}

describe('submitCivilianReportOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectivity('online');
    offlineStoreMocks.queuePublicOfflineOp.mockResolvedValue(undefined);
    reporterIdentityMocks.encryptOfflineReporterIdentity.mockResolvedValue({
      version: 1,
      clientReportId: 'client-report-1',
      encrypted: { iv: [1], data: [2] },
    });
  });

  it('queues offline when connectivity is offline', async () => {
    setConnectivity('offline');
    const { submitCivilianReportOfflineAware } = await import('../offlineCivilian');

    const result = await submitCivilianReportOfflineAware(
      {
        latitude: 14.5,
        longitude: 121,
        category: 'STRUCTURAL',
        reporting_context: 'WITNESS',
        safety_status: 'I_AM_SAFE',
        device_id: DEVICE_ID,
        client_report_id: 'client-report-1',
        reporter_name: 'Juan Dela Cruz',
        reporter_phone: '09171234567',
      },
      DEVICE_ID
    );

    expect(offlineStoreMocks.queuePublicOfflineOp).toHaveBeenCalledTimes(1);
    const queuedOp = offlineStoreMocks.queuePublicOfflineOp.mock.calls[0][0];
    expect(queuedOp.operation).toBe('submit');
    expect(queuedOp.deviceId).toBe(DEVICE_ID);
    expect(queuedOp.payload.category).toBe('STRUCTURAL');
    expect(queuedOp.payload.reporter_name).toBeUndefined();
    expect(queuedOp.payload.reporter_phone).toBeUndefined();
    expect(queuedOp.reporterIdentity).toEqual(expect.objectContaining({ version: 1 }));
    expect(typeof queuedOp.localId).toBe('string');
    expect(queuedOp.localId.length).toBeGreaterThan(0);

    expect(result.queued).toBe(true);
    expect(result.localId).toBe(queuedOp.localId);
  });

  it('returns server response when online', async () => {
    legacyMocks.submitCivilianReportV2.mockResolvedValue({ report_id: 99, status: 'PENDING' });
    const { submitCivilianReportOfflineAware } = await import('../offlineCivilian');

    const result = await submitCivilianReportOfflineAware(
      { latitude: 14.5, longitude: 121, category: 'STRUCTURAL', reporting_context: 'WITNESS', safety_status: 'I_AM_SAFE', device_id: DEVICE_ID },
      DEVICE_ID
    );

    expect(legacyMocks.submitCivilianReportV2).toHaveBeenCalledTimes(1);
    expect(offlineStoreMocks.queuePublicOfflineOp).not.toHaveBeenCalled();
    expect(result.queued).toBe(false);
    expect(result.response).toEqual({ report_id: 99, status: 'PENDING' });
  });

  it('queues on network error and marks connectivity offline', async () => {
    legacyMocks.submitCivilianReportV2.mockRejectedValue(new TypeError('Failed to fetch'));
    const { submitCivilianReportOfflineAware } = await import('../offlineCivilian');

    const result = await submitCivilianReportOfflineAware(
      {
        latitude: 14.5,
        longitude: 121,
        category: 'STRUCTURAL',
        reporting_context: 'WITNESS',
        safety_status: 'I_AM_SAFE',
        device_id: DEVICE_ID,
        reporter_name: 'Juan Dela Cruz',
      },
      DEVICE_ID
    );

    expect(offlineStoreMocks.queuePublicOfflineOp).toHaveBeenCalledTimes(1);
    expect(connectivityMocks.markConnectivityOffline).toHaveBeenCalled();
    expect(result.queued).toBe(true);
  });

  it('re-throws 4xx errors (e.g. 422) without queueing', async () => {
    const err = new Error('Validation failed') as Error & { status?: number };
    err.status = 422;
    legacyMocks.submitCivilianReportV2.mockRejectedValue(err);
    const { submitCivilianReportOfflineAware } = await import('../offlineCivilian');

    await expect(
      submitCivilianReportOfflineAware(
        { latitude: 14.5, longitude: 121, category: 'STRUCTURAL', reporting_context: 'WITNESS', safety_status: 'I_AM_SAFE', device_id: DEVICE_ID },
        DEVICE_ID
      )
    ).rejects.toThrow('Validation failed');

    expect(offlineStoreMocks.queuePublicOfflineOp).not.toHaveBeenCalled();
    expect(connectivityMocks.markConnectivityOffline).not.toHaveBeenCalled();
  });
});

describe('appendCivilianReportOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectivity('online');
    offlineStoreMocks.queuePublicOfflineOp.mockResolvedValue(undefined);
  });

  it('queues with linkedLocalId when offline', async () => {
    setConnectivity('offline');
    const { appendCivilianReportOfflineAware } = await import('../offlineCivilian');

    const parentLocalId = 'parent-local-1';
    const result = await appendCivilianReportOfflineAware(
      {
        parentLocalId,
        latitude: 14.5,
        longitude: 121,
        description: 'fire is spreading',
        device_id: DEVICE_ID,
      },
      DEVICE_ID
    );

    expect(offlineStoreMocks.queuePublicOfflineOp).toHaveBeenCalledTimes(1);
    const queuedOp = offlineStoreMocks.queuePublicOfflineOp.mock.calls[0][0];
    expect(queuedOp.operation).toBe('append');
    expect(queuedOp.linkedLocalId).toBe(parentLocalId);
    expect(queuedOp.deviceId).toBe(DEVICE_ID);
    expect(queuedOp.payload.description).toBe('fire is spreading');

    expect(result.queued).toBe(true);
    expect(result.localId).toBe(queuedOp.localId);
  });

  it('returns server response when online', async () => {
    legacyMocks.appendCivilianReport.mockResolvedValue({ report_id: 42, status: 'PENDING' });
    const { appendCivilianReportOfflineAware } = await import('../offlineCivilian');

    const result = await appendCivilianReportOfflineAware(
      { parentLocalId: 'parent', latitude: 14.5, longitude: 121, description: 'x', device_id: DEVICE_ID, reportId: 42 },
      DEVICE_ID
    );

    expect(legacyMocks.appendCivilianReport).toHaveBeenCalledWith(42, expect.any(Object));
    expect(offlineStoreMocks.queuePublicOfflineOp).not.toHaveBeenCalled();
    expect(result.queued).toBe(false);
  });
});

describe('submitFollowupOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectivity('online');
    offlineStoreMocks.queuePublicOfflineOp.mockResolvedValue(undefined);
  });

  it('queues with linkedLocalId when offline', async () => {
    setConnectivity('offline');
    const { submitFollowupOfflineAware } = await import('../offlineCivilian');

    const parentLocalId = 'parent-1';
    const result = await submitFollowupOfflineAware(
      { parentLocalId, reportId: 42, followupText: 'smoke intensifying', device_id: DEVICE_ID },
      DEVICE_ID
    );

    expect(offlineStoreMocks.queuePublicOfflineOp).toHaveBeenCalledTimes(1);
    const queuedOp = offlineStoreMocks.queuePublicOfflineOp.mock.calls[0][0];
    expect(queuedOp.operation).toBe('followup');
    expect(queuedOp.linkedLocalId).toBe(parentLocalId);
    expect(queuedOp.deviceId).toBe(DEVICE_ID);
    expect(queuedOp.payload.followup_text).toBe('smoke intensifying');

    expect(result.queued).toBe(true);
  });

  it('returns server response when online', async () => {
    legacyMocks.submitFollowup.mockResolvedValue({ followup_id: 7, report_id: 42 });
    const { submitFollowupOfflineAware } = await import('../offlineCivilian');

    const result = await submitFollowupOfflineAware(
      { parentLocalId: 'parent', reportId: 42, followupText: 'x', device_id: DEVICE_ID },
      DEVICE_ID
    );

    expect(legacyMocks.submitFollowup).toHaveBeenCalledWith(42, 'x', DEVICE_ID);
    expect(result.queued).toBe(false);
  });
});

// ── Review gate ────────────────────────────────────────────────────

describe('checkReviewEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a "must connect" error when offline on the review step', async () => {
    setConnectivity('offline');
    const { checkReviewEligibility } = await import('../offlineCivilian');

    expect(() => checkReviewEligibility()).toThrow(/connect/i);
  });

  it('does not throw when online', async () => {
    setConnectivity('online');
    const { checkReviewEligibility } = await import('../offlineCivilian');

    expect(() => checkReviewEligibility()).not.toThrow();
  });
});
