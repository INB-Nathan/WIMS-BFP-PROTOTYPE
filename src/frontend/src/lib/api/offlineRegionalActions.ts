import { apiFetch, ApiRequestError } from './transport';
import { queueOfflineOp } from '../offlineStore';
import { getConnectivitySnapshot, markConnectivityOffline } from '../connectivity';
import { isNetworkError, isNavigatorOffline } from './offlineBase';

export interface OfflineQueueResult {
  queued: boolean;
  localId: string;
}

interface EncoderArchiveQueueContext {
  encoderId: string;
  regionId: number;
}

function shouldQueueImmediately(): boolean {
  const snapshot = getConnectivitySnapshot();
  return snapshot.state === 'offline' || isNavigatorOffline();
}

async function queueEncoderArchiveAction(
  incidentId: number,
  action: 'archive' | 'unarchive',
  context: EncoderArchiveQueueContext,
): Promise<OfflineQueueResult> {
  const localId = crypto.randomUUID();
  await queueOfflineOp({
    localId,
    operation: 'archive_action',
    serverId: incidentId,
    linkedLocalId: null,
    serverUpdatedAt: null,
    regionId: context.regionId,
    encoderId: context.encoderId,
    payload: { incident_id: incidentId, action, scope: 'encoder' },
    createdAt: Date.now(),
  });
  return { queued: true, localId };
}

export async function submitEncoderArchiveActionOfflineAware(
  incidentId: number,
  action: 'archive' | 'unarchive',
  context: EncoderArchiveQueueContext,
): Promise<OfflineQueueResult> {
  if (shouldQueueImmediately()) {
    return queueEncoderArchiveAction(incidentId, action, context);
  }

  const endpoint = action === 'archive'
    ? `/api/regional/incidents/${incidentId}/archive`
    : `/api/regional/incidents/${incidentId}/unarchive`;

  try {
    await apiFetch(endpoint, { method: 'PATCH' });
    return { queued: false, localId: '' };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409) {
      throw err;
    }
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return queueEncoderArchiveAction(incidentId, action, context);
    }
    throw err;
  }
}

export async function archiveEncoderIncidentOfflineAware(
  incidentId: number,
  context: EncoderArchiveQueueContext,
): Promise<OfflineQueueResult> {
  return submitEncoderArchiveActionOfflineAware(incidentId, 'archive', context);
}

export async function unarchiveEncoderIncidentOfflineAware(
  incidentId: number,
  context: EncoderArchiveQueueContext,
): Promise<OfflineQueueResult> {
  return submitEncoderArchiveActionOfflineAware(incidentId, 'unarchive', context);
}
