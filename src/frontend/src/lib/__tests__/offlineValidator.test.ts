/**
 * offlineValidator reproduction test — GH #269 Validator Dashboard Offline Wiring
 *
 * Verifies that submitVerificationOfflineAware() queues a 'verify' op
 * via queueIncident when the connectivity state is 'offline', bypassing
 * the network entirely. The queued payload is structured so the existing
 * syncEngine processVerify dispatch can replay it on reconnect.
 *
 * This test MUST fail on the unmodified base commit because the
 * submitVerificationOfflineAware function does not exist yet.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock connectivity ──────────────────────────────────────────────
const connectivityMocks = vi.hoisted(() => ({
  connectivitySnapshot: {
    state: 'offline' as const,
    isOnline: false,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null as number | null,
  },
  markConnectivityOffline: vi.fn(),
}));

vi.mock('../connectivity', () => ({
  getConnectivitySnapshot: () => connectivityMocks.connectivitySnapshot,
  markConnectivityOffline: connectivityMocks.markConnectivityOffline,
}));

// ── Mock offlineStore ──────────────────────────────────────────────
const offlineStoreMocks = vi.hoisted(() => ({
  queueIncident: vi.fn(),
}));

vi.mock('../offlineStore', () => ({
  queueIncident: offlineStoreMocks.queueIncident,
}));

// ── Tests ──────────────────────────────────────────────────────────
describe('submitVerificationOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectivityMocks.connectivitySnapshot.state = 'offline';
    connectivityMocks.connectivitySnapshot.isOnline = false;
    offlineStoreMocks.queueIncident.mockResolvedValue(undefined);
  });

  it('queues a verify op with localId and full payload when offline', async () => {
    // Dynamic import from the barrel — validator.ts will re-export from
    // offlineValidator.ts once implemented. Currently fails on import.
    const { submitVerificationOfflineAware } = await import('../api/validator');

    const result = await submitVerificationOfflineAware(
      42,           // incident_id
      'accept',     // action
      'Looks good', // notes
    );

    // Must queue via offlineStore, not attempt a network request.
    expect(offlineStoreMocks.queueIncident).toHaveBeenCalledTimes(1);

    const [payload, options] = offlineStoreMocks.queueIncident.mock.calls[0];

    // Payload must contain the verification data the sync engine will replay.
    expect(payload).toEqual({
      incident_id: 42,
      action: 'accept',
      notes: 'Looks good',
    });

    // Metadata must mark this as a verify op so syncEngine dispatches
    // to processVerify (PATCH /regional/incidents/{id}/verification).
    expect(options.opType).toBe('verify');

    // Must generate a localId for server-side idempotency (sent as client_id).
    expect(typeof options.localId).toBe('string');
    expect(options.localId!.length).toBeGreaterThan(0);

    // Must return queue acknowledgement so the page can show a toast
    // indicating the verification is queued for sync.
    expect(result).toHaveProperty('queued', true);
    expect(result).toHaveProperty('localId', options.localId);
  });
});

// ── Archive / Unarchive offline queuing ──────────────────────────

describe('archiveIncidentOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectivityMocks.connectivitySnapshot.state = 'offline';
    connectivityMocks.connectivitySnapshot.isOnline = false;
    offlineStoreMocks.queueIncident.mockResolvedValue(undefined);
  });

  it('queues an archive_action op with incident_id and action=archive when offline', async () => {
    const { archiveIncidentOfflineAware } = await import('../api/validator');

    const result = await archiveIncidentOfflineAware(99);

    expect(offlineStoreMocks.queueIncident).toHaveBeenCalledTimes(1);

    const [payload, options] = offlineStoreMocks.queueIncident.mock.calls[0];

    expect(payload).toEqual({
      incident_id: 99,
      action: 'archive',
    });

    expect(options.opType).toBe('archive_action');
    expect(typeof options.localId).toBe('string');
    expect(options.localId!.length).toBeGreaterThan(0);

    expect(result).toHaveProperty('queued', true);
    expect(result).toHaveProperty('localId', options.localId);
  });
});

describe('unarchiveIncidentOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectivityMocks.connectivitySnapshot.state = 'offline';
    connectivityMocks.connectivitySnapshot.isOnline = false;
    offlineStoreMocks.queueIncident.mockResolvedValue(undefined);
  });

  it('queues an archive_action op with incident_id and action=unarchive when offline', async () => {
    const { unarchiveIncidentOfflineAware } = await import('../api/validator');

    const result = await unarchiveIncidentOfflineAware(101);

    expect(offlineStoreMocks.queueIncident).toHaveBeenCalledTimes(1);

    const [payload, options] = offlineStoreMocks.queueIncident.mock.calls[0];

    expect(payload).toEqual({
      incident_id: 101,
      action: 'unarchive',
    });

    expect(options.opType).toBe('archive_action');
    expect(typeof options.localId).toBe('string');
    expect(options.localId!.length).toBeGreaterThan(0);

    expect(result).toHaveProperty('queued', true);
    expect(result).toHaveProperty('localId', options.localId);
  });
});
