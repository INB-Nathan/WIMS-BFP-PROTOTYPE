'use client';

import { ReportWizard } from '@/components/report-wizard/Wizard';

// Issue #613 — Report Wizard + Receipt.
// The legacy 4-step flow (safety/context/category/details/review) is replaced
// by a 5-step wizard (Location, Photo, Category, Details, Review) plus a
// post-submit Receipt. All orchestration lives in ReportWizard; this page is
// a thin mount point.
export default function ReportPage() {
  return <ReportWizard />;
}
