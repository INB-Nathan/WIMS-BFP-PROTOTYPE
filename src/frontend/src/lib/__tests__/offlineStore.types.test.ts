/**
 * Sync-guard tests for offlineStore type-level cleanups (issues #16, #17).
 *
 * Issue #16: CachedReadRecord and CachedReferenceRecord are now derived
 * from a single generic CachedRecord<TPayload>. The encrypted field is
 * renamed to `data` for consistency with the public CachedResponse.
 *
 * Issue #17: LegacyOfflineOpType is now `Extract<OfflineOpType, ...>`
 * instead of a parallel string union.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(
  join(process.cwd(), 'src', 'lib', 'offlineStore.ts'),
  'utf8',
);

describe('offlineStore type-level cleanups (issues 16, 17)', () => {
  it('CachedRecord<TPayload> is the single generic record shape (issue #16)', () => {
    expect(SRC).toMatch(/interface\s+CachedRecord\s*<\s*TPayload\s*>/);
    // CachedReadRecord and CachedReferenceRecord are derived from CachedRecord.
    expect(SRC).toMatch(/type\s+CachedReadRecord\s*=\s*CachedRecord\s*</);
    expect(SRC).toMatch(/type\s+CachedReferenceRecord\s*=\s*CachedRecord\s*</);
  });

  it('LegacyOfflineOpType is expressed via Extract<> of OfflineOpType (issue #17)', () => {
    expect(SRC).toMatch(
      /export\s+type\s+LegacyOfflineOpType\s*=\s*Extract\s*<\s*OfflineOpType\s*,\s*['"]create['"]\s*\|\s*['"]verify['"]\s*\|\s*['"]archive_action['"]\s*>/,
    );
  });

  it('CachedReadRecord.encrypted field is gone (renamed to data)', () => {
    // The old interface had its own `encrypted` field. After the cleanup,
    // CachedReadRecord is CachedRecord<EncryptedPayload> which uses `data`.
    // No code should still reference the old `encrypted` field on a
    // CachedReadRecord (the OfflineOp still has its own `encrypted` field
    // — that is unrelated).
    expect(SRC).not.toMatch(/CachedReadRecord\s*=\s*\{[\s\S]*?encrypted:/);
  });
});
