# Implementation Plan: Suricata Alert Detail Redesign

**Based on:** `docs/superpowers/specs/2026-06-28-suricata-alert-redesign.md`
**Working branch:** `redesign/suricata-alert-view` (worktree at `../pr-worktrees/pr-suricata-alert-redesign`)
**Target:** All changes in the worktree branch

## Execution Order

1. SQL migration (`76_add_xai_confidence_breakdown.sql`)
2. Backend: `ai_service.py` — emit `xai_confidence_breakdown` + `sources`
3. Backend: `security.py` GET — include `xai_confidence_breakdown` in response
4. Frontend: `xaiNarrativeNormalizer.ts` — enhanced `ParsedNarrative` + regex patterns
5. Frontend: `SuricataAlertModal.tsx` — new extracted component (the bulk of the work)
6. Frontend: `page.tsx` — integrate the extracted modal component
7. Frontend: `xaiNarrativeNormalizer.test.ts` — tests for new fields
8. Backend: HITL / AI analysis test updates

---

## Phase 1: Database Migration

### File: `src/postgres-init/76_add_xai_confidence_breakdown.sql` (NEW)

```sql
ALTER TABLE wims.security_threat_logs
ADD COLUMN xai_confidence_breakdown JSONB DEFAULT NULL;

COMMENT ON COLUMN wims.security_threat_logs.xai_confidence_breakdown
IS 'Per-category AI confidence: {anomaly_detection, classification, overall}';
```

---

## Phase 2: Backend — AI Service Enhancement

### File: `src/backend/services/ai_service.py`

**Changes to `analyze_threat_log`:**

1. **Add `request: Request` parameter** to the function signature and pass it from the route handler. This enables client disconnection detection when the user clicks Cancel:

In `ai_service.py`, update the function signature:
```python
from fastapi import Request

async def analyze_threat_log(log_id: int, db: Session, request: Request | None = None) -> dict:
```

In `security.py`, update the route handler to pass `request`:
```python
@router.post("/security-logs/{log_id}/analyze")
async def analyze_security_log(
    log_id: int,
    request: Request,  # injected by FastAPI
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    return await analyze_threat_log(log_id, db, request)
```

Add a disconnection check before the Ollama call and after the response returns:
```python
# Before Ollama call
if request is not None and await request.is_disconnected():
    logger.info("Client disconnected before AI analysis of log %d", log_id)
    raise HTTPException(status_code=499, detail="Client disconnected")

# ... Ollama call ...

# After response parsed, before DB write
if request is not None and await request.is_disconnected():
    logger.info("Client disconnected during AI analysis of log %d, skipping DB write", log_id)
    raise HTTPException(status_code=499, detail="Client disconnected")
```

2. **Update the prompt** (line ~75): Add `confidence_breakdown` object and `sources` array to the output schema:

```python
prompt = (
    f"Analyze this Suricata IDS alert: severity={json.dumps(severity_level)}, "
    f'SID={suricata_sid}, signature="{suricata_signature}", '
    f"classification={classification}, payload={json.dumps(raw_payload)}. "
    "Output strictly JSON with keys: "
    "'anomaly_description' (string), "
    "'log_evidence' (string), "
    "'risk_assessment' (string), "
    "'recommended_action' (string), "
    "'confidence' (float 0.0-1.0), "
    "'confidence_breakdown' (object with keys 'anomaly_detection', 'classification', 'overall', each float 0.0-1.0), "
    "'sources' (array of strings indicating which data sources were used)."
)
```

3. **After parsing the response** (after `parsed = json.loads(response_text)`), extract breakdown:
```python
confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0.0))))

# Extract confidence breakdown
raw_breakdown = parsed.get("confidence_breakdown", {})
confidence_breakdown = {}
for key in ("anomaly_detection", "classification", "overall"):
    val = raw_breakdown.get(key, confidence)
    try:
        confidence_breakdown[key] = max(0.0, min(1.0, float(val)))
    except (TypeError, ValueError):
        confidence_breakdown[key] = confidence

# Extract sources
sources = parsed.get("sources", ["Suricata EVE log", "Ollama"])
if not isinstance(sources, list):
    sources = ["Suricata EVE log", "Ollama"]
```

4. **Include sources in narrative JSON:**
```python
narrative_data = {
    "anomaly_description": parsed.get("anomaly_description", ""),
    "log_evidence": parsed.get("log_evidence", ""),
    "risk_assessment": parsed.get("risk_assessment", ""),
    "recommended_action": parsed.get("recommended_action", ""),
    "sources": sources,
}
```

5. **Update the UPDATE SQL** (add `xai_confidence_breakdown`):
```python
db.execute(
    text("""
        UPDATE wims.security_threat_logs
        SET xai_narrative = :narrative,
            xai_confidence = :confidence,
            xai_confidence_breakdown = CAST(:breakdown AS jsonb)
        WHERE log_id = :log_id
    """),
    {
        "narrative": json.dumps(narrative_data),
        "confidence": confidence,
        "breakdown": json.dumps(confidence_breakdown),
        "log_id": log_id,
    },
)
```

6. **Update the return dict** to include `xai_confidence_breakdown`:
```python
return {
    # ... existing keys ...
    "xai_narrative": json.dumps(narrative_data),
    "xai_confidence": confidence,
    "xai_confidence_breakdown": confidence_breakdown,
    # ... remaining keys ...
}
```

### File: `src/backend/api/routes/admin/security.py`

**Changes to `get_security_logs`:**

1. Add `xai_confidence_breakdown` to the SELECT clause:
```python
rows = db.execute(
    text(f"""
        SELECT log_id, timestamp, source_ip, destination_ip, suricata_sid,
               severity_level, raw_payload, xai_narrative, xai_confidence,
               xai_confidence_breakdown,
               admin_action_taken, resolved_at, reviewed_by, hitl_decision,
               classification, suricata_signature, suricata_category
        FROM wims.security_threat_logs
        {where_sql}
        ORDER BY {order_by}
        LIMIT :limit OFFSET :offset
    """),
    params,
).fetchall()
```

2. Add to the response items dict (index shift — `xai_confidence_breakdown` is now at index 9):
```python
return {
    "items": [
        {
            # ... existing keys up to xai_confidence ...
            "xai_confidence": float(r[8]) if r[8] is not None else None,
            "xai_confidence_breakdown": r[9],  # NEW
            "admin_action_taken": r[10],
            "resolved_at": r[11].isoformat() if r[11] else None,
            # ... rest shifts by 1 ...
        }
        for r in rows
    ],
    # ...
}
```

---

## Phase 3: Frontend — Normalizer Enhancement

### File: `src/frontend/src/lib/xaiNarrativeNormalizer.ts`

1. **Extend `ParsedNarrative` interface:**
```typescript
export interface ParsedNarrative {
  raw: string | null;
  anomalyDescription: string | null;
  logEvidence: string | null;
  riskAssessment: string | null;
  recommendedAction: string | null;
  confidence: number | null;
  confidenceBreakdown: { anomalyDetection: number; classification: number; overall: number } | null;
  sources: string[] | null;
  isStructured: boolean;
}
```

2. **Add regex patterns to `extractPartialFields`:**
```typescript
const patterns: Array<[RegExp, keyof ParsedNarrative]> = [
  // ... existing patterns ...
  [/"sources"\s*:\s*\[([^\]]*)\]/i, 'sources'],
];

// New: Try extracting confidence_breakdown object
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
    result.confidenceBreakdown = {
      anomalyDetection: ad ?? 0,
      classification: cl ?? 0,
      overall: ov ?? 0,
    };
    found = true;
  }
}
```

3. **Extract sources array from match:**
```typescript
// After extracting breakdown, handle sources array
// NOTE: `result` is a `Partial<ParsedNarrative>` but `extractPartialFields` returns
// `Partial<ParsedNarrative> | null`. During the regex loop, `patterns` entries with
// `'sources'` key will store the raw match as a string. Cast through `unknown` to avoid
// TS compilation error (sources is typed `string[] | null`, not `string`).
const rawSources = (result as Record<string, unknown>).sources;
if (typeof rawSources === 'string') {
  try {
    result.sources = JSON.parse(rawSources) as string[];
  } catch {
    // Simple comma split fallback
    result.sources = rawSources.replace(/["'\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  }
}
```

4. **Update the JSON parse handler in `normalizeNarrative`:**
In both the direct JSON parse and fence-stripped parse blocks, add:
```typescript
confidenceBreakdown: parsed.confidence_breakdown
  ? {
      anomalyDetection: parsed.confidence_breakdown.anomaly_detection ?? null,
      classification: parsed.confidence_breakdown.classification ?? null,
      overall: parsed.confidence_breakdown.overall ?? null,
    }
  : null,
sources: Array.isArray(parsed.sources) ? parsed.sources : null,
```

5. **Update fallback:**
```typescript
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
```

---

## Phase 4: Frontend — New SuricataAlertModal Component

### File: `src/frontend/src/app/admin/system/components/SuricataAlertModal.tsx` (NEW)

This is the largest piece of work. The component encapsulates the entire modal.

**Props interface:**
```typescript
interface SuricataAlertModalProps {
  log: SecurityLog;    // from page.tsx's existing SecurityLog interface
  onClose: () => void;
  onDecisionComplete: (logId: number, updatedLog: Partial<SecurityLog>) => void;
  onAnalyze: (log: SecurityLog) => Promise<void>;  // passed down from page.tsx
  onCreateIncident: (log: SecurityLog) => Promise<void>;
  onViewRelatedEvidence: (log: SecurityLog) => Promise<AuditItem[]>;
}
```

**Internal state:**
```typescript
const [activeTab, setActiveTab] = useState<'overview' | 'ai-analysis' | 'raw-payload' | 'evidence' | 'history'>('overview');
const [analysisState, setAnalysisState] = useState<'idle' | 'fetching' | 'analyzing' | 'normalizing' | 'complete' | 'error'>('idle');
const [analysisElapsed, setAnalysisElapsed] = useState(0);
const [analysisError, setAnalysisError] = useState<string | null>(null);
const [isSubmitting, setIsSubmitting] = useState(false);
const [relatedEvidence, setRelatedEvidence] = useState<AuditItem[] | null>(null);
const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
const [relatedEvidenceCount, setRelatedEvidenceCount] = useState<number | null>(null);
```

**Component sections (render functions):**

1. `renderTabBar()` — 5 tab buttons with SVG icons
2. `renderAlertHeader()` — title, severity badge, timestamps, status
3. `renderAiAnalysisCard()` — two states (stepper / results)
4. `renderProgressStepper()` — 4-step stepper with connector line
5. `renderResultsCards()` — 2×2 grid + source annotation + confidence bars
6. `renderStatsCards()` — 3 cards row
7. `renderAlertFields()` — 4-column grid
8. `renderDecisionRow()` — 5 buttons
9. `renderReviewedBanner()` — green/amber banner
10. `renderRawPayloadTab()` — preformatted JSON
11. `renderEvidenceTab()` — related audit panel
12. `renderHistoryTab()` — hitl_decision snapshot

**Stepper timer logic:**
```typescript
useEffect(() => {
  if (analysisState === 'fetching' || analysisState === 'analyzing' || analysisState === 'normalizing') {
    setAnalysisElapsed(0);  // Reset on start
    const start = Date.now();
    const interval = setInterval(() => {
      setAnalysisElapsed((Date.now() - start) / 1000);
    }, 200);
    return () => clearInterval(interval);
  }
  // Reset timer when transitioning to error, idle, or complete
  if (analysisState === 'error' || analysisState === 'idle') {
    setAnalysisElapsed(0);
  }
}, [analysisState]);
```

**Tab reset on log change:**
```typescript
useEffect(() => {
  setActiveTab('overview');
  setAnalysisState('idle');
  setRelatedEvidence(null);
  setRelatedEvidenceCount(null);
}, [log.log_id]);
```

**Related evidence eager fetch on mount:**
```typescript
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const evidence = await onViewRelatedEvidence(log);
      if (!cancelled) {
        setRelatedEvidence(evidence);
        setRelatedEvidenceCount(evidence.length);
      }
    } catch {
      if (!cancelled) {
        setRelatedEvidence(null);
        setRelatedEvidenceCount(null);
      }
    }
  })();
  return () => { cancelled = true; };
}, [log.log_id]);
```

**AbortController for Cancel button:**
- Store a ref to the AbortController: `const abortRef = useRef<AbortController | null>(null);`
- On cancel: `abortRef.current?.abort(); setAnalysisState('idle'); setAnalysisElapsed(0);`
- Pass the signal to the fetch in the analyze handler

**Modal sizing:** `max-w-4xl md:max-w-[95vw]` with responsive grid collapse at `<lg` breakpoint.

---

## Phase 5: Frontend — page.tsx Integration

### File: `src/frontend/src/app/admin/system/page.tsx`

1. **Import the new component** at top of file:
```typescript
import { SuricataAlertModal } from './components/SuricataAlertModal';
```

2. **Replace the existing modal inline code** (~lines 2350–2600) with:
```tsx
{selectedLog && (
  <SuricataAlertModal
    log={selectedLog}
    onClose={() => {
      setSelectedLog(null);
      setHitlMessage(null);
      setCreateIncidentResult(null);
      setRelatedEvidence(null);
      setRelatedEvidenceError(null);
    }}
    onDecisionComplete={(logId, updatedLog) => {
      // Refresh the log in the list
      setLogs(prev => prev.map(l =>
        l.log_id === logId ? { ...l, ...updatedLog } : l
      ));
      setSelectedLog(prev => prev ? { ...prev, ...updatedLog } : null);
    }}
    onAnalyze={handleAnalyze}
    onCreateIncident={handleCreateIncident}
    onViewRelatedEvidence={handleViewRelatedEvidence}
  />
)}
```

3. **Move or keep existing handler functions** (`handleAnalyze`, `handleHitlDecision`, `handleCreateIncident`, `handleViewRelatedEvidence`) in `page.tsx`. They need minor modifications:
   - `handleAnalyze`: wrap with progress state updates (client calls the API, the modal's `analysisState` tracks progress stages)
   - `handleHitlDecision`: after success, call `onDecisionComplete` callback
   - `handleViewRelatedEvidence`: must return `AuditItem[]` (currently sets state, needs to also return)

---

## Phase 6: Frontend — Normalizer Tests

### File: `src/frontend/src/lib/xaiNarrativeNormalizer.test.ts`

Add test cases for:

1. **Full structured JSON** with `confidence_breakdown` and `sources`:
```typescript
const fullInput = JSON.stringify({
  anomaly_description: "Test anomaly",
  log_evidence: "Test evidence",
  risk_assessment: "Test risk",
  recommended_action: "Test action",
  confidence: 0.95,
  confidence_breakdown: { anomaly_detection: 0.97, classification: 0.94, overall: 0.96 },
  sources: ["Suricata EVE log", "Ollama", "Threat intel"],
});
const result = normalizeNarrative(fullInput);
expect(result.confidenceBreakdown).toEqual({
  anomalyDetection: 0.97,
  classification: 0.94,
  overall: 0.96,
});
expect(result.sources).toEqual(["Suricata EVE log", "Ollama", "Threat intel"]);
expect(result.isStructured).toBe(true);
```

2. **JSON with partial breakdown** (missing one key)
3. **JSON with empty sources array**
4. **Fenced JSON** (```json ... ```) with breakdown
5. **Partial/malformed JSON** with regex fallback for breakdown
6. **Plain text** (no breakdown, returns null)

---

## Phase 7: Test Updates

### File: `src/frontend/src/app/admin/system/admin-system-hitl.test.tsx`
### File: `src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx`

1. Update imports to reference `SuricataAlertModal` if tests directly import the modal
2. Add test for Request More Info button (non-terminal action)
3. Add test for `pointer-events: none` wrapper during submission
4. Add test for tab switching behavior
5. Add test for stepper progress display during analysis

### File: `src/backend/tests/test_security_monitoring.py`
### File: `src/backend/tests/integration/test_ai_ids_api.py`

1. Update mock Ollama responses to include `confidence_breakdown` and `sources`
2. Verify `xai_confidence_breakdown` is persisted and returned in GET response
3. Test that legacy records (null breakdown) don't break

---

## File Change Summary

| File | Action | Complexity |
|------|--------|------------|
| `src/postgres-init/76_add_xai_confidence_breakdown.sql` | **NEW** | Trivial (2 lines) |
| `src/backend/services/ai_service.py` | **EDIT** (~20 lines) | Medium — prompt + parsing + SQL |
| `src/backend/api/routes/admin/security.py` | **EDIT** (~5 lines) | Low — add column to SELECT + response |
| `src/frontend/src/lib/xaiNarrativeNormalizer.ts` | **EDIT** (~40 lines) | Medium — interface + regex + parse paths |
| `src/frontend/src/app/admin/system/components/SuricataAlertModal.tsx` | **NEW** (~500 lines) | **High** — bulk of the work |
| `src/frontend/src/app/admin/system/page.tsx` | **EDIT** (~50 lines) | Medium — import + replace inline modal |
| `src/frontend/src/lib/xaiNarrativeNormalizer.test.ts` | **EDIT** (~60 lines) | Medium — 6 new test cases |
| `src/frontend/src/app/admin/system/admin-system-hitl.test.tsx` | **EDIT** (~30 lines) | Medium — new button + tab tests |
| `src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx` | **EDIT** (~20 lines) | Low — stepper state tests |
| `src/backend/tests/test_security_monitoring.py` | **EDIT** (~15 lines) | Low — mock response updates |
| `src/backend/tests/integration/test_ai_ids_api.py` | **EDIT** (~15 lines) | Low — mock response updates |

---

## Edge Cases & Gotchas

1. **Legacy records with null `xai_confidence_breakdown`:** The frontend must handle null gracefully — show only the overall `xai_confidence` bar, hide breakdown bars.
2. **Fast analysis (<1s):** Minimum 500ms stepper display to prevent flicker.
3. **Analysis error:** Stepper shows red error state on the failed step + "Retry" button.
4. **Rapid log cycling:** Tab resets to overview, related evidence fetch uses cancellable flag to prevent stale overwrites.
5. **Empty sources array:** Show "Sources: none" or omit the annotation bar entirely.
6. **Ollama timeout (120s):** The stepper must still be updating at 120s. The elapsed timer continues. On timeout error, transition to error state.
7. **Responsive <1024px:** 4-column grid → 2 columns, stats cards stack vertically, modal width `max-w-[95vw]`.
8. **Modal Z-index:** Must be above the existing table and any other modals. Current z-index model uses `z-50` — verify no conflicts.
9. **Client disconnection during analysis:** If user clicks Cancel, `request.is_disconnected()` returns True after the Ollama response. The DB write is skipped — the `xai_narrative` and `xai_confidence` are NOT persisted, and the modal returns to "Analyze with AI" state.
10. **Integer confidence values:** The regex fallback now handles `1` and `0` (without decimal point) via `(0?\.\d+|\d+)`.
11. **Stateful databases (non-bootstrap):** The `074_` migration is only applied during cold bootstrap. Existing databases need the ALTER TABLE run manually.
