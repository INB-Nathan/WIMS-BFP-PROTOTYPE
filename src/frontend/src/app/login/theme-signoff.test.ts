import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

/**
 * Task 2 — Final Design System & Resilience Sign-off
 *
 * Forensic sweep covering:
 *   1. Semantic Purity   — zero hardcoded palette classes in page.tsx
 *   2. Fallback Bridge   — calc(100vh - var(--spacing-32, 8rem)) present in globals.css
 *   3. Shadow Vibe Check — LayoutShell uses bg-theme-surface-subtle, zero hex in @utility
 *   4. Resilience        — every var() in globals.css has a comma-separated fallback
 */

// ── File readers ──────────────────────────────────────────────────────

function readLogin(): string {
  return fs.readFileSync(
    path.resolve(__dirname, 'page.tsx'),
    'utf-8',
  );
}

function readGlobalsCss(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '..', 'globals.css'),
    'utf-8',
  );
}

function readLayoutShell(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'components', 'LayoutShell.tsx'),
    'utf-8',
  );
}

// ── 1. Semantic Purity (page.tsx) ─────────────────────────────────────

describe('Audit 1 — Semantic Purity (page.tsx)', () => {
  const source = readLogin();

  it('must contain zero hardcoded Tailwind palette classes', () => {
    const PALETTE_REGEX =
      /\b(bg|text|border|from|via|to|ring|ring-offset|shadow|fill|stroke|outline|divide|accent|caret|decoration|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|transparent)(-\d{1,3})?\b/g;

    const matches = source.match(PALETTE_REGEX) || [];
    const unique = [...new Set(matches)];

    expect(
      unique.length,
      `Hardcoded palette classes still present: ${unique.join(', ')}`,
    ).toBe(0);
  });

  it('must contain zero raw hex codes', () => {
    const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
    const matches = source.match(HEX_REGEX) || [];

    expect(
      matches.length,
      `Raw hex codes still present: ${matches.join(', ')}`,
    ).toBe(0);
  });
});

// ── 2. Fallback Bridge (globals.css) ──────────────────────────────────

describe('Audit 2 — Fallback Bridge (globals.css)', () => {
  const css = readGlobalsCss();

  it('must contain the exact auth-container calc with fallback', () => {
    const EXACT_CALC = 'calc(100vh - var(--spacing-32, 8rem))';
    expect(
      css.includes(EXACT_CALC),
      `Expected exact expression: ${EXACT_CALC}\nNot found in globals.css`,
    ).toBe(true);
  });
});

// ── 3. Shadow Vibe Check (LayoutShell.tsx + @utility) ─────────────────

describe('Audit 3 — Shadow Vibe Check', () => {
  it('LayoutShell.tsx must use bg-theme-surface-subtle', () => {
    const shell = readLayoutShell();
    expect(
      shell.includes('bg-theme-surface-subtle'),
      'LayoutShell.tsx is missing bg-theme-surface-subtle',
    ).toBe(true);
  });

  it('LayoutShell.tsx must contain zero hex codes', () => {
    const shell = readLayoutShell();
    const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
    const matches = shell.match(HEX_REGEX) || [];

    expect(
      matches.length,
      `Hex codes found in LayoutShell.tsx: ${matches.join(', ')}`,
    ).toBe(0);
  });

  it('@utility directives in globals.css must contain zero raw hex codes', () => {
    const css = readGlobalsCss();

    // Extract all @utility blocks
    const utilityBlockRegex = /@utility\s+[\w-]+\s*\{[^}]*\}/g;
    const utilityBlocks = css.match(utilityBlockRegex) || [];

    const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
    const hexInUtilities: string[] = [];

    for (const block of utilityBlocks) {
      const hexMatches = block.match(HEX_REGEX) || [];
      hexInUtilities.push(...hexMatches);
    }

    expect(
      hexInUtilities.length,
      `Hex codes found inside @utility directives: ${hexInUtilities.join(', ')}`,
    ).toBe(0);
  });
});

// ── 4. Resilience — var() fallback enforcement ────────────────────────

describe('Audit 4 — Resilience: var() fallback enforcement (globals.css)', () => {
  it('every var() call must have a comma-separated fallback', () => {
    const css = readGlobalsCss();

    // Match all var(...) calls. We need to handle nested var() too.
    // var(--name)          → NO fallback (FAIL)
    // var(--name, value)   → HAS fallback (PASS)
    const violations: { expression: string; line: number }[] = [];

    const lines = css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;
      const lineVarRegex = /var\(([^)]+)\)/g;

      while ((match = lineVarRegex.exec(line)) !== null) {
        const inner = match[1].trim();
        // A fallback is present if there's a comma after the custom property name
        if (!inner.includes(',')) {
          violations.push({
            expression: match[0],
            line: i + 1,
          });
        }
      }
    }

    const report = violations
      .map((v) => `  L${v.line}: ${v.expression}`)
      .join('\n');

    expect(
      violations.length,
      `Found ${violations.length} var() call(s) WITHOUT a fallback:\n${report}\n` +
        'Every var() must include a comma-separated fallback for resilience.',
    ).toBe(0);
  });
});
