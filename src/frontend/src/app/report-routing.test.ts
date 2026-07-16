import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public report routing', () => {
  it('does not link to removed legacy tracking query routes', () => {
    // The legacy 4-step flow rendered the tracking URL inline in
    // app/report/page.tsx. #613 replaced that page with a thin <ReportWizard />
    // mount; the token-gated tracking URL now lives in the Receipt component and
    // is fetched by the token-gated client in lib/api/tracking.ts. Assert both:
    // the page no longer uses the legacy query-route shape, and the wizard's
    // Receipt + tracking client still build the token-gated tracking URL
    // (no legacy /report/tracking link).
    const pageSource = readFileSync(join(process.cwd(), 'src/app/report/page.tsx'), 'utf8');
    const receiptSource = readFileSync(
      join(process.cwd(), 'src/components/report-wizard/Receipt.tsx'),
      'utf8',
    );
    const trackingSource = readFileSync(
      join(process.cwd(), 'src/lib/api/tracking.ts'),
      'utf8',
    );

    expect(pageSource).not.toContain('/report/tracking');
    expect(receiptSource).toContain('trackingUrl');
    expect(trackingSource).toContain('/civilian/reports/');
    expect(trackingSource).toContain('/track/');
  });
});
