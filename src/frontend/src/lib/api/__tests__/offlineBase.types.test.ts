/**
 * Sync-guard tests for the offlineBase type-alias consolidation (issue #7).
 *
 * The five identity type aliases (OfflineAdminResult, OfflineAnalyticsResult,
 * OfflineReferenceResult, OfflineValidatorResult, OfflineValidatorQueueResult)
 * were deleted in favour of the single OfflineResult<T> from offlineBase.
 * This file pins the contract: the aliases must not be re-introduced, and
 * the wrapper files must use OfflineResult<T> directly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = (rel: string) =>
  readFileSync(join(process.cwd(), 'src', 'lib', 'api', rel), 'utf8');

describe('offlineBase type-alias consolidation (issue #7)', () => {
  const FORBIDDEN_ALIASES = [
    'OfflineAdminResult',
    'OfflineAnalyticsResult',
    'OfflineReferenceResult',
    'OfflineValidatorResult',
    'OfflineValidatorQueueResult',
  ];

  for (const rel of ['offlineAdmin.ts', 'offlineAnalytics.ts', 'offlineReference.ts', 'offlineValidator.ts']) {
    for (const alias of FORBIDDEN_ALIASES) {
      it(`${rel} does not export \`${alias}\` identity alias`, () => {
        const src = SRC(rel);
        // The forbidden form is an identity alias declaration:
        //   export type X<T> = OfflineResult<T>;
        // Also forbid the import form (re-introducing via barrel).
        const aliasDecl = new RegExp(`export\\s+type\\s+${alias}\\s*<\\w*>\\s*=\\s*OfflineResult<`);
        const aliasImport = new RegExp(`import\\s+type\\s*\\{[^}]*\\b${alias}\\b[^}]*\\}`);
        expect(src, `forbidden identity alias \`${alias}\` in ${rel}`).not.toMatch(aliasDecl);
        expect(src, `forbidden import of \`${alias}\` in ${rel}`).not.toMatch(aliasImport);
      });
    }
  }

  it('barrel re-exports do not re-introduce the deleted aliases', () => {
    for (const rel of ['admin.ts', 'analytics.ts', 'validator.ts']) {
      const src = SRC(rel);
      for (const alias of FORBIDDEN_ALIASES) {
        const reExport = new RegExp(`export\\s+type\\s*\\{[^}]*\\b${alias}\\b[^}]*\\}`);
        expect(
          src,
          `barrel ${rel} must not re-export \`${alias}\``,
        ).not.toMatch(reExport);
      }
    }
  });
});

/**
 * Wrapper shape contract (issue #9).
 *
 * The 23 offline-aware wrappers (11 admin + 9 analytics + 3 reference) are
 * deliberately 1-liners that delegate to the unified offlineAware /
 * offlineAwareReference orchestrator. The shared helper is already
 * extracted — this test pins the contract so a future refactor does not
 * re-introduce inline try/catch/finally/eviction logic in the wrappers.
 */

describe('offlineAware wrapper shape (issue #9)', () => {
  const WRAPPER_FILES = [
    'offlineAdmin.ts',
    'offlineAnalytics.ts',
    'offlineReference.ts',
  ];

  for (const rel of WRAPPER_FILES) {
    it(`${rel} has at least 3 wrappers and delegates to the shared orchestrator`, () => {
      const src = SRC(rel);
      // Count wrappers by the `*OfflineAware` function-name suffix. Allow
      // both `export function` and `export async function` declarations.
      const wrapperCount = (src.match(/export\s+(?:async\s+)?function\s+\w+OfflineAware\b/g) ?? []).length;
      expect(wrapperCount, `expected multiple *OfflineAware wrappers in ${rel}`).toBeGreaterThanOrEqual(3);
      // Verify the shared orchestrator is imported (the shared helper is
      // already extracted; a future refactor must not inline its logic
      // back into the wrappers).
      expect(src, `${rel} must import the shared offlineAware helper`).toMatch(
        /import\s*\{[^}]*\b(offlineAware|offlineAwareReference)\b[^}]*\}\s*from\s*['"]\.\/offlineBase['"]/,
      );
    });

    it(`${rel} file has no inline try/catch/finally (orchestrator owns the flow)`, () => {
      const src = SRC(rel);
      // Whole-file guard: none of the wrapper files should contain a
      // try/catch/finally block. The orchestrator handles the entire
      // control flow; wrappers are 1-line delegations.
      // (We allow `try` in comments by anchoring to a statement-shape `try`.)
      expect(src, `${rel} must not contain inline try blocks`).not.toMatch(/^\s*try\s*\{/m);
      expect(src, `${rel} must not contain inline catch`).not.toMatch(/^\s*\}\s*catch\b/m);
      expect(src, `${rel} must not contain inline finally`).not.toMatch(/^\s*\}\s*finally\s*\{/m);
    });
  }
});
