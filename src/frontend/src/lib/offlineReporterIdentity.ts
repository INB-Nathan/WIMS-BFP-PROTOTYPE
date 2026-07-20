import {
  decryptPayloadWithAad,
  encryptPayloadWithAad,
  type EncryptedPayload,
} from './offlineStore';

export const OFFLINE_REPORTER_IDENTITY_VERSION = 1 as const;

export interface ReporterIdentitySnapshot {
  reporter_name: string;
  reporter_phone?: string;
}

export interface OfflineReporterIdentityEnvelope {
  version: typeof OFFLINE_REPORTER_IDENTITY_VERSION;
  clientReportId: string;
  encrypted: EncryptedPayload;
}

function aad(clientReportId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `civilian-report-client:${clientReportId}:reporter-identity:v1`,
  );
}

export async function encryptOfflineReporterIdentity(
  clientReportId: string,
  identity: ReporterIdentitySnapshot,
): Promise<OfflineReporterIdentityEnvelope> {
  if (!clientReportId.trim() || !identity.reporter_name.trim()) {
    throw new Error('Reporter identity requires a report client id and name.');
  }
  return {
    version: OFFLINE_REPORTER_IDENTITY_VERSION,
    clientReportId,
    encrypted: await encryptPayloadWithAad(identity, aad(clientReportId)),
  };
}

export async function decryptOfflineReporterIdentity(
  envelope: OfflineReporterIdentityEnvelope,
): Promise<ReporterIdentitySnapshot> {
  if (envelope.version !== OFFLINE_REPORTER_IDENTITY_VERSION) {
    throw new Error('Unsupported reporter identity envelope version.');
  }
  return decryptPayloadWithAad<ReporterIdentitySnapshot>(
    envelope.encrypted,
    aad(envelope.clientReportId),
  );
}
