import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public report routing', () => {
  it('does not link to removed legacy tracking query routes', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');

    expect(source).not.toContain('/report/tracking');
    expect(source).not.toContain('/tracking?id=');
    expect(source).toContain('tracking_url');
  });
});
