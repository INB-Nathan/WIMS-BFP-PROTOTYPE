import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

/**
 * UI Quantification — Design Determinism Enforcer
 *
 * This static-analysis test scans `page.tsx` for "vibe-styling" violations:
 *   1. Raw hex codes            (#fff, #1a2b3c)
 *   2. Tailwind arbitrary values (h-[calc(...)], bg-[#...], w-[200px])
 *   3. Hardcoded palette steps  (bg-red-900, text-gray-50, text-white, bg-black)
 *
 * All styling MUST flow through semantic design tokens (e.g., bg-theme-brand-dark).
 * Any match → test FAILS → RED State confirmed.
 */

const TARGET_FILE = 'page.tsx';

function readComponent(): string {
  const filePath = path.join(__dirname, TARGET_FILE);
  return fs.readFileSync(filePath, 'utf-8');
}

describe('UI Quantification — Design Determinism', () => {
  const source = readComponent();

  // ── Violation 1: Raw Hex Codes ──────────────────────────────────────
  it('must contain zero raw hex color codes (#xxx / #xxxxxx)', () => {
    // Matches #fff, #f0f0f0, #1a2b3c  — 3-to-8 hex digits after #
    const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/g;

    const matches = source.match(HEX_REGEX) || [];

    expect(
      matches.length,
      `Found ${matches.length} raw hex code(s): ${matches.join(', ')}\n` +
        'Replace with semantic design tokens (e.g., bg-theme-brand-dark).',
    ).toBe(0);
  });

  // ── Violation 2: Tailwind Arbitrary Values ──────────────────────────
  it('must contain zero Tailwind arbitrary-value brackets ([...])', () => {
    // Matches patterns like h-[calc(100vh-8rem)], bg-[#1e293b], w-[200px]
    const ARBITRARY_REGEX = /\b[a-z][a-z0-9-]*-\[[^\]]+\]/g;

    const matches = source.match(ARBITRARY_REGEX) || [];

    expect(
      matches.length,
      `Found ${matches.length} arbitrary Tailwind value(s): ${matches.join(', ')}\n` +
        'Extract to tailwind.config theme tokens or CSS custom properties.',
    ).toBe(0);
  });

  // ── Violation 3: Hardcoded Palette Steps ────────────────────────────
  it('must contain zero hardcoded Tailwind color palette classes', () => {
    // Utility prefixes that accept color values
    const PREFIXES =
      '(bg|text|border|from|via|to|ring|ring-offset|shadow|fill|stroke|outline|divide|accent|caret|decoration|placeholder)';

    // Tailwind's built-in color palette names INCLUDING white & black
    const PALETTES =
      '(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|transparent)';

    // Optionally followed by a numeric shade step (e.g., -50, -900)
    const PALETTE_REGEX = new RegExp(
      `\\b${PREFIXES}-${PALETTES}(-\\d{1,3})?\\b`,
      'g',
    );

    const matches = source.match(PALETTE_REGEX) || [];

    // Deduplicate for cleaner error output
    const unique = [...new Set(matches)];

    expect(
      unique.length,
      `Found ${unique.length} hardcoded palette class(es): ${unique.join(', ')}\n` +
        'Migrate to semantic tokens defined in tailwind.config (e.g., text-theme-brand-light).',
    ).toBe(0);
  });

  // ── Aggregate Summary (catch-all) ──────────────────────────────────
  it('aggregate: component must be 100% design-deterministic', () => {
    const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
    const ARBITRARY_REGEX = /\b[a-z][a-z0-9-]*-\[[^\]]+\]/g;
    const PALETTE_REGEX =
      /\b(bg|text|border|from|via|to|ring|ring-offset|shadow|fill|stroke|outline|divide|accent|caret|decoration|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|transparent)(-\d{1,3})?\b/g;

    const hex = source.match(HEX_REGEX) || [];
    const arb = source.match(ARBITRARY_REGEX) || [];
    const pal = source.match(PALETTE_REGEX) || [];

    const total = hex.length + arb.length + pal.length;
    const allViolations = [...new Set([...hex, ...arb, ...pal])];

    expect(
      total,
      `\n╔══════════════════════════════════════════════════════════╗\n` +
        `║  DESIGN DETERMINISM VIOLATION REPORT                    ║\n` +
        `╠══════════════════════════════════════════════════════════╣\n` +
        `║  Hex codes       : ${hex.length}                                      \n` +
        `║  Arbitrary values: ${arb.length}                                      \n` +
        `║  Palette steps   : ${pal.length}                                      \n` +
        `║  TOTAL           : ${total}                                      \n` +
        `╠══════════════════════════════════════════════════════════╣\n` +
        `║  Violations: ${allViolations.join(', ')}\n` +
        `╚══════════════════════════════════════════════════════════╝\n`,
    ).toBe(0);
  });
});
