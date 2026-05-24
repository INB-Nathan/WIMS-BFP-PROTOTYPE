export {
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
  TerminalCitizenStatus,
  TriageClusterActivityEntry,
  TriageClusterEntry,
  TriageQueueResponse,
  TriageReportEntry,
  TriageSeverity,
} from './legacy';
