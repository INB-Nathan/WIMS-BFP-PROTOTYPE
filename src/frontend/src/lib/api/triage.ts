export {
  applyReportStatusUpdate,
  applyTriageTerminalAction,
  claimTriageCluster,
  correctTriageReport,
  fetchMergeCandidates,
  fetchTriageClusterActivity,
  fetchTriageQueue,
  mergeTriageClusters,
  splitTriageCluster,
} from './legacy';

export type {
  MergeCandidateEntry,
  StatusUpdateStage,
  TerminalCitizenStatus,
  TriageClusterActivityEntry,
  TriageClusterEntry,
  TriageQueueResponse,
  TriageReportEntry,
  TriageSeverity,
} from './legacy';

import { apiFetch, API_BASE } from './transport';
import type {
  ContactRevealResponse,
  TriageWorkspaceResponse,
} from '@/types/triage-workspace';

export function fetchTriageWorkspace(clusterId: number): Promise<TriageWorkspaceResponse> {
  return apiFetch<TriageWorkspaceResponse>(`/triage/clusters/${clusterId}/workspace`);
}

export async function fetchSanitizedPhotoContent(contentUrl: string): Promise<Blob> {
  const normalizedPath = contentUrl.startsWith('/api/') ? contentUrl.slice(4) : contentUrl;
  const url = normalizedPath.startsWith('http')
    ? normalizedPath
    : `${API_BASE.replace(/\/$/, '')}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error('Sanitized image unavailable.');
  return response.blob();
}

export function revealTriageReporterContact(reportId: number): Promise<ContactRevealResponse> {
  return apiFetch<ContactRevealResponse>(`/triage/reports/${reportId}/contact-reveal`, {
    method: 'POST',
  });
}

export type {
  ContactRevealResponse,
  ContributorCredibility,
  EvidenceLocation,
  TriageWorkspaceResponse,
  WorkspaceCluster,
  WorkspaceFollowup,
  WorkspacePhoto,
  WorkspaceReport,
  WorkspaceStatusUpdate,
} from '@/types/triage-workspace';
