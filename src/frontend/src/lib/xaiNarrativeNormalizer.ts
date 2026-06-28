/**
 * Shared XAI Narrative Normalizer (#351)
 *
 * Tolerant parser for AI-generated structured output stored in `xai_narrative`.
 * Handles:
 *   - Well-formed JSON objects
 *   - JSON inside markdown fences (```json ... ```)
 *   - Partial/malformed JSON (best-effort field extraction)
 *   - Plain text (falls back to raw)
 *   - Empty/null input
 */

export interface ParsedNarrative {
  /** The original raw string (unchanged). */
  raw: string | null;
  /** Parsed anomaly_description field, if found. */
  anomalyDescription: string | null;
  /** Parsed log_evidence field, if found. */
  logEvidence: string | null;
  /** Parsed risk_assessment field, if found. */
  riskAssessment: string | null;
  /** Parsed recommended_action field, if found. */
  recommendedAction: string | null;
  /** Parsed confidence value (from `confidence` or `xai_confidence` field), if present. */
  confidence: number | null;
  /** Parsed confidence_breakdown object, if found. */
  confidenceBreakdown: { anomalyDetection: number; classification: number; overall: number } | null;
  /** Parsed sources array, if found. */
  sources: string[] | null;
  /** True when we successfully parsed a complete JSON object. */
  isStructured: boolean;
}

/**
 * Best-effort extraction of known fields from a partial JSON string using
 * simple regexes. Returns only fields that can be reliably extracted.
 */
function extractPartialFields(text: string): Partial<ParsedNarrative> | null {
  const result: Partial<ParsedNarrative> = {};
  let found = false;

  const patterns: Array<[RegExp, keyof ParsedNarrative]> = [
    [/"anomaly_description"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/i, 'anomalyDescription'],
    [/"log_evidence"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/i, 'logEvidence'],
    [/"risk_assessment"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/i, 'riskAssessment'],
    [/"recommended_action"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/i, 'recommendedAction'],
    [/"sources"\s*:\s*\[([^\]]*)\]/i, 'sources'],
  ];

  for (const [pattern, targetKey] of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Unescape any escaped quotes within the string value
      (result as Record<string, string | null>)[targetKey] = match[1].replace(/\\"/g, '"');
      found = true;
    }
  }

  // Try extracting numeric confidence
  const confidenceMatch = text.match(/"xai_confidence"\s*:\s*(0?\.\d+)/i)
    ?? text.match(/"confidence"\s*:\s*(0?\.\d+)/i);
  if (confidenceMatch) {
    const val = parseFloat(confidenceMatch[1]);
    if (!isNaN(val)) {
      result.confidence = val;
      found = true;
    }
  }

  // Try extracting confidence_breakdown object
  const breakdownMatch = text.match(/"confidence_breakdown"\s*:\s*\{([^}]*)\}/i);
  if (breakdownMatch) {
    const inner = breakdownMatch[1];
    // Use (0?\.\d+|\d+) to capture both decimal (0.97) and integer (1, 0) confidence values
    const adMatch = inner.match(/"anomaly_detection"\s*:\s*(0?\.\d+|\d+)/i);
    const clMatch = inner.match(/"classification"\s*:\s*(0?\.\d+|\d+)/i);
    const ovMatch = inner.match(/"overall"\s*:\s*(0?\.\d+|\d+)/i);
    const ad = adMatch ? parseFloat(adMatch[1]) : null;
    const cl = clMatch ? parseFloat(clMatch[1]) : null;
    const ov = ovMatch ? parseFloat(ovMatch[1]) : null;
    if (ad !== null || cl !== null || ov !== null) {
      (result as Record<string, unknown>).confidenceBreakdown = {
        anomalyDetection: ad ?? 0,
        classification: cl ?? 0,
        overall: ov ?? 0,
      };
      found = true;
    }
  }

  // Convert raw sources string match to string[] via JSON parse or comma split
  // NOTE: cast through unknown to avoid TS error (sources is typed string[] | null)
  const rawSources = (result as Record<string, unknown>).sources;
  if (typeof rawSources === 'string') {
    try {
      result.sources = JSON.parse(`[${rawSources}]`) as string[];
    } catch {
      // Simple comma split fallback
      result.sources = rawSources.replace(/["'\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  return found ? result : null;
}

/**
 * Normalize a raw XAI narrative string into a structured `ParsedNarrative`.
 *
 * Strategy (in order):
 * 1. Empty/null → return fallback with `isStructured: false`
 * 2. Try parsing as pure JSON
 * 3. Try stripping markdown fenced code blocks (```json ... ```) and re-parse
 * 4. Try partial field extraction with regex
 * 5. Fall back to raw text
 *
 * @param raw - The raw narrative string (may be null).
 * @returns A `ParsedNarrative` with the best available structured data.
 */
export function normalizeNarrative(raw: string | null): ParsedNarrative {
  const fallback: ParsedNarrative = {
    raw,
    anomalyDescription: null,
    logEvidence: null,
    riskAssessment: null,
    recommendedAction: null,
    confidence: null,
    confidenceBreakdown: null,
    sources: null,
    isStructured: false,
  };

  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  let jsonStr = raw.trim();

  // ── 1. Try direct JSON parse ──────────────────────────────────────────────
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return {
        raw,
        anomalyDescription: typeof parsed.anomaly_description === 'string' ? parsed.anomaly_description : null,
        logEvidence: typeof parsed.log_evidence === 'string' ? parsed.log_evidence : null,
        riskAssessment: typeof parsed.risk_assessment === 'string' ? parsed.risk_assessment : null,
        recommendedAction: typeof parsed.recommended_action === 'string' ? parsed.recommended_action : null,
        confidence:
          typeof parsed.xai_confidence === 'number' ? parsed.xai_confidence :
          typeof parsed.confidence === 'number' ? parsed.confidence : null,
        confidenceBreakdown: parsed.confidence_breakdown
          ? {
              anomalyDetection: parsed.confidence_breakdown.anomaly_detection ?? null,
              classification: parsed.confidence_breakdown.classification ?? null,
              overall: parsed.confidence_breakdown.overall ?? null,
            }
          : null,
        sources: Array.isArray(parsed.sources) ? parsed.sources : null,
        isStructured: true,
      };
    }
  } catch {
    // continue to fence stripping
  }

  // ── 2. Try stripping markdown fences ──────────────────────────────────────
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      const parsed = JSON.parse(inner);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return {
          raw,
          anomalyDescription: typeof parsed.anomaly_description === 'string' ? parsed.anomaly_description : null,
          logEvidence: typeof parsed.log_evidence === 'string' ? parsed.log_evidence : null,
          riskAssessment: typeof parsed.risk_assessment === 'string' ? parsed.risk_assessment : null,
          recommendedAction: typeof parsed.recommended_action === 'string' ? parsed.recommended_action : null,
          confidence:
            typeof parsed.xai_confidence === 'number' ? parsed.xai_confidence :
            typeof parsed.confidence === 'number' ? parsed.confidence : null,
          confidenceBreakdown: parsed.confidence_breakdown
            ? {
                anomalyDetection: parsed.confidence_breakdown.anomaly_detection ?? null,
                classification: parsed.confidence_breakdown.classification ?? null,
                overall: parsed.confidence_breakdown.overall ?? null,
              }
            : null,
          sources: Array.isArray(parsed.sources) ? parsed.sources : null,
          isStructured: true,
        };
      }
    } catch {
      // attempt partial extraction from the fenced content
      jsonStr = inner;
    }
  }

  // ── 3. Partial extraction ─────────────────────────────────────────────────
  const partial = extractPartialFields(jsonStr);
  if (partial) {
    return {
      ...fallback,
      ...partial,
      isStructured: false,
      raw,
    };
  }

  // ── 4. Fallback: plain text ───────────────────────────────────────────────
  return fallback;
}
