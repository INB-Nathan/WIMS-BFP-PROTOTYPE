/**
 * Shared trust score color utilities for triage UI.
 *
 * Defines consistent color thresholds and Tailwind class mappings
 * used across TriageCanvasMapInner and TriageInvestigationBoard —
 * single source of truth to prevent the threshold-drift maintenance risk.
 */

export const TRUST_SCORE_HIGH = 70;
export const TRUST_SCORE_MEDIUM = 40;

export type TrustLevel = 'high' | 'medium' | 'low';

/**
 * Categorize a trust score (0–100) into a level.
 * - high: >= 70
 * - medium: 40–69
 * - low: < 40
 */
export function trustLevel(score: number): TrustLevel {
  if (score >= TRUST_SCORE_HIGH) return 'high';
  if (score >= TRUST_SCORE_MEDIUM) return 'medium';
  return 'low';
}

export function formatTrustPercent(score: number): string {
  const percent = score <= 1 ? score * 100 : score;
  return `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
}

/**
 * Tailwind color classes per trust level.
 * - bg: background class
 * - text: text color class
 * - dot: small dot indicator class (for badges)
 * - inline: inline text color class (for ranked queue, map popups)
 */
export const TRUST_COLORS: Record<TrustLevel, {
  bg: string;
  text: string;
  dot: string;
  inline: string;
}> = {
  high: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    dot: 'bg-emerald-500',
    inline: 'text-emerald-700',
  },
  medium: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    inline: 'text-amber-700',
  },
  low: {
    bg: 'bg-red-100',
    text: 'text-red-800',
    dot: 'bg-red-500',
    inline: 'text-red-700',
  },
};
