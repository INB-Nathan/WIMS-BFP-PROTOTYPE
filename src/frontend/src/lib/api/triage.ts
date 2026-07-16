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
