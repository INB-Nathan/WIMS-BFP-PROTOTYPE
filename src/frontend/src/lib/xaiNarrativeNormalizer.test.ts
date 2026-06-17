/**
 * Unit tests for xaiNarrativeNormalizer (#351)
 *
 * Covers: valid JSON, JSON-in-markdown-fences, partial/malformed JSON,
 * plain text, empty/null input, confidence extraction.
 */

import { describe, it, expect } from 'vitest';
import { normalizeNarrative } from './xaiNarrativeNormalizer';

describe('normalizeNarrative', () => {
  // ── Valid JSON ────────────────────────────────────────────────────────────

  it('parses well-formed JSON with all known fields', () => {
    const input = JSON.stringify({
      anomaly_description: 'Suspicious outbound connection detected.',
      log_evidence: 'Source IP 10.0.0.1 contacted known C2 at 203.0.113.42',
      risk_assessment: 'HIGH — potential data exfiltration in progress.',
      recommended_action: 'Block source IP and investigate affected host.',
      confidence: 0.88,
    });

    const result = normalizeNarrative(input);

    expect(result.isStructured).toBe(true);
    expect(result.anomalyDescription).toBe('Suspicious outbound connection detected.');
    expect(result.logEvidence).toBe('Source IP 10.0.0.1 contacted known C2 at 203.0.113.42');
    expect(result.riskAssessment).toBe('HIGH — potential data exfiltration in progress.');
    expect(result.recommendedAction).toBe('Block source IP and investigate affected host.');
    expect(result.confidence).toBe(0.88);
    expect(result.raw).toBe(input);
  });

  it('handles xai_confidence as confidence field', () => {
    const input = JSON.stringify({
      anomaly_description: 'test',
      log_evidence: 'test',
      risk_assessment: 'test',
      recommended_action: 'test',
      xai_confidence: 0.75,
    });

    const result = normalizeNarrative(input);
    expect(result.confidence).toBe(0.75);
  });

  it('prefers xai_confidence over confidence when both present', () => {
    const input = JSON.stringify({
      confidence: 0.5,
      xai_confidence: 0.92,
    });
    const result = normalizeNarrative(input);
    expect(result.confidence).toBe(0.92);
  });

  it('returns null for missing fields', () => {
    const input = JSON.stringify({ anomaly_description: 'only this' });
    const result = normalizeNarrative(input);
    expect(result.anomalyDescription).toBe('only this');
    expect(result.logEvidence).toBeNull();
    expect(result.riskAssessment).toBeNull();
    expect(result.recommendedAction).toBeNull();
    expect(result.confidence).toBeNull();
  });

  // ── JSON in markdown fences ───────────────────────────────────────────────

  it('strips ```json fences and parses the inner JSON', () => {
    const input = '```json\n{"anomaly_description":"Test anomaly","confidence":0.9}\n```';

    const result = normalizeNarrative(input);
    expect(result.isStructured).toBe(true);
    expect(result.anomalyDescription).toBe('Test anomaly');
    expect(result.confidence).toBe(0.9);
  });

  it('strips bare ``` fences without language specifier', () => {
    const input = '```\n{"anomaly_description":"Bare fence test"}\n```';

    const result = normalizeNarrative(input);
    expect(result.isStructured).toBe(true);
    expect(result.anomalyDescription).toBe('Bare fence test');
  });

  it('handles fenced JSON with surrounding whitespace', () => {
    const input = '  ```json\n  {"anomaly_description":"Padded","log_evidence":"yes"}\n  ```  ';

    const result = normalizeNarrative(input);
    expect(result.isStructured).toBe(true);
    expect(result.anomalyDescription).toBe('Padded');
    expect(result.logEvidence).toBe('yes');
  });

  // ── Partial / malformed JSON ──────────────────────────────────────────────

  it('extracts partial fields from truncated JSON via regex fallback', () => {
    const input = '{"anomaly_description":"Partial threat","risk_assessment":"HIGH ris';

    const result = normalizeNarrative(input);
    // Both fields are extracted because regex makes closing quote optional for partial JSON
    expect(result.isStructured).toBe(false);
    expect(result.raw).toBe(input);
    expect(result.anomalyDescription).toBe('Partial threat');
    expect(result.riskAssessment).toBe('HIGH ris');
  });

  it('falls back to raw text for non-JSON plain text', () => {
    const input = 'Suspicious outbound connection detected. Recommend blocking.';

    const result = normalizeNarrative(input);
    expect(result.isStructured).toBe(false);
    expect(result.raw).toBe(input);
    expect(result.anomalyDescription).toBeNull();
    expect(result.logEvidence).toBeNull();
    expect(result.riskAssessment).toBeNull();
    expect(result.recommendedAction).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it('handles truncated JSON mid-field', () => {
    const input = '{"anomaly_description":"Partial threat","risk_assessment":"HIGH ris';

    const result = normalizeNarrative(input);
    expect(result.isStructured).toBe(false);
    expect(result.anomalyDescription).toBe('Partial threat');
    // risk_assessment should be null because the string isn\'t properly closed
    // (our regex requires a closing quote)
    expect(result.raw).toBe(input);
  });

  // ── Empty / null input ────────────────────────────────────────────────────

  it('returns isStructured false for null input', () => {
    const result = normalizeNarrative(null);
    expect(result.isStructured).toBe(false);
    expect(result.raw).toBeNull();
    expect(result.anomalyDescription).toBeNull();
  });

  it('returns isStructured false for empty string', () => {
    const result = normalizeNarrative('');
    expect(result.isStructured).toBe(false);
    expect(result.raw).toBe('');
  });

  it('returns isStructured false for whitespace-only string', () => {
    const result = normalizeNarrative('   \n  ');
    expect(result.isStructured).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles nested JSON structures gracefully (returns flat fields)', () => {
    const input = JSON.stringify({
      anomaly_description: 'Nested',
      log_evidence: { key: 'value' }, // not a string
    });
    const result = normalizeNarrative(input);
    expect(result.isStructured).toBe(true);
    expect(result.anomalyDescription).toBe('Nested');
    expect(result.logEvidence).toBeNull(); // not a string, so null
  });

  it('handles JSON array input as fallback', () => {
    const result = normalizeNarrative('[1, 2, 3]');
    expect(result.isStructured).toBe(false);
  });

  it('handles escaped quotes within JSON string values', () => {
    // Craft raw JSON with escaped quotes — JSON.parse unescapes \" → "
    const input = '{"anomaly_description":"Contains \\"quoted\\" text"}';
    const result = normalizeNarrative(input);
    expect(result.isStructured).toBe(true);
    expect(result.anomalyDescription).toBe('Contains "quoted" text');
  });
});
