export {
  appendCivilianReport,
  fetchCivilianDuplicateSuggestions,
  fetchMyReports,
  fetchReportStatus,
  fetchReportTimeline,
  registerNotification,
  submitCivilianReport,
  submitCivilianReportV2,
} from './legacy';

export type {
  CivilianCategory,
  CivilianDuplicateSuggestion,
  CivilianReportTimelineItem,
  CivilianReportTrackingResponse,
  CivilianReportV2Payload,
  CivilianReportV2Response,
  MyReportItem,
  MyReportResponse,
  ReportingContext,
  SafetyStatus,
} from './legacy';
