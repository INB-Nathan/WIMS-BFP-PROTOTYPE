# Design Spec: Suricata Alert Detail Redesign

**Date:** 2026-06-28
**Status:** Draft

---

## Overview

The current Suricata alert detail modal ("Suricata Alert — #{log_id}") in `/admin/system` is a single-column, free-form layout with limited visual hierarchy. AI analysis is a single card with raw text, confidence is a one-line percentage, and threat decisions are two buttons (Confirm Threat / False Positive). Analysts lack:

- Real-time AI progress visibility (the "Analyze with AI" button jumps directly to results)
- Per-category confidence breakdown (only a single `xai_confidence` float)
- Source attribution for AI output (which systems contributed to the analysis)
- Quick-glance stats (confidence %, classification, related event count)
- A complete set of HITL actions (no Request More Info, no Create Incident in the decision row)
- Tab-based deep-dive for Raw Payload, Evidence, History

This spec redesigns the modal as a tabbed, layered detail view with a progress stepper, structured AI output cards, confidence breakdown bars, stats cards row, 4-column alert fields grid, and 5-button threat decision bar — matching modern SIEM alert UX patterns (Radiant Security, Elastic Security, OpenSOAR).

### Scope

| In Scope | Out of Scope |
|----------|-------------|
| Suricata alert detail modal redesign (tabbed layers) | Other admin hub modals (session detail, system metrics) |
| AI analysis progress stepper (4 stages with connector line) | AI analysis offline mode or retry without progress |
| Confidence breakdown bars (3 categories: anomaly, classification, overall) | Historical confidence trend chart |
| Source annotation for AI output | Cross-referencing multiple threat intel sources |
| Stats cards row (AI confidence, classification, related events) | Click-through stats drilldown |
| 8-field alert grid in 4 columns (src_ip, dst_ip, SID, signature, category, timestamp, protocol, port) | Editable alert fields |
| 5-button threat decision row (Confirm Threat, False Positive, Request More Info, View Related Evidence, Create Incident) | Bulk HITL decisions in the detail modal |
| Button loading states (spinner + dim) | Queue/retry for failed HITL operations |
| Reviewed state banner (green banner when resolved) | Review history timeline |
| Tab content: Overview (default), AI Analysis (structured output), Raw Payload (preformatted), Evidence (related audit logs), History (decision timeline) | Tab: Raw Payload diff viewer |
| Backend: `xai_confidence_breakdown` JSONB column, compute in `ai_service.py` | Dashboard-level confidence aggregation |
| Backend: Source annotation in the AI response schema | Real-time threat intel feed integration |
| Normalizer: `normalizeNarrative` enhanced for breakdown + source annotation | Server-side narrative normalization |
| Tests: HITL test updates for new buttons, AI analysis test for breakdown fields | E2E tests for stepper animation |

### Design Principles

- **Layered scanability**: Tabbed layout lets L1 triage stay on Overview, while L2/L3 analysts deep-dive into AI Analysis, Raw Payload, Evidence, and History.
- **Progress transparency**: The 4-stage stepper shows where the AI analysis is in real-time — analysts don't wonder if the system is hanging.
- **Confidence nuance**: A single `xai_confidence` number is insufficient. Per-category bars (anomaly detection, classification, overall) let analysts weigh recommendations by category.
- **Source trust**: Source annotations ("Suricata EVE log · Ollama · Threat intel") build calibrated trust in AI output (Radiant Security pattern).
- **No emoji**: All icons are inline SVGs consistent with the existing admin hub design system.
- **HITL completeness**: Five decision buttons cover the full human-in-the-loop workflow plus incident creation, without requiring navigation away from the alert.
- **Loading clarity**: Every async button shows a spinner + dimmed state with `cursor: not-allowed` — never a silent hang.

---

## Architecture

### Routes

| Route | Purpose | Type |
|-------|---------|------|
| `/admin/system` | Admin hub page — Suricata alert detail modal | Existing page, redesigned modal section |

### Frontend Components

```
src/frontend/src/app/admin/system/page.tsx
  └─ Suricata alert detail modal (selectedLog)
       ├─ Tab bar (5 tabs: Overview, AI Analysis, Raw Payload, Evidence, History)
       ├─ Overview tab (default)
       │    ├─ Alert header (title, severity badge, timestamps, status)
       │    ├─ AI Analysis Card (two states: progress stepper | structured results)
       │    │    ├─ State 1: Progress stepper + elapsed timer + cancel button
       │    │    └─ State 2: 2×2 results cards + source annotation + confidence bars
       │    ├─ Stats cards row (3 cards: AI confidence, classification, related events)
       │    ├─ Alert fields grid (8 fields in 4-column grid)
       │    ├─ Threat decision row (5 buttons + loading states)
       │    └─ Reviewed state banner (when resolved)
       ├─ AI Analysis tab
       │    └─ Full-width structured output (same 2×2 cards as Overview AI section)
       ├─ Raw Payload tab
       │    └─ Scrollable preformatted JSON payload
       ├─ Evidence tab
       │    └─ Related audit evidence panel (existing logic, new tab)
       └─ History tab
            └─ Decision timeline (admin_action_taken, hitl_decision revisions)

src/frontend/src/lib/
├── xaiNarrativeNormalizer.ts    # Enhanced: confidence_breakdown, source annotation
├── xaiNarrativeNormalizer.test.ts  # Updated tests
└── admin.ts                     # + create-incident button API (exists)
```

### Backend Changes

| Change | Purpose | Notes |
|--------|---------|-------|
| `ai_service.py`: emit `xai_confidence_breakdown` JSONB | Store per-category confidence in new column | Modeled as `{"anomaly_detection": 0.97, "classification": 0.94, "overall": 0.96}` |
| `ai_service.py`: emit `xai_sources` array in narrative | Source annotation for trust calibration | Array of strings: `["Suricata EVE log", "Ollama", "Threat intel"]` |
| `security_threat_log.py`: new `xai_confidence_breakdown` column + migration | Persist breakdown data | `JSONB`, nullable. Migration file: `76_add_xai_confidence_breakdown.sql` |
| `security.py` GET security-logs: return `xai_confidence_breakdown` | Wire to frontend | Include in SELECT and response dict |

---

## Design Section 1: Tab Bar

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [grid] Overview | [pen] AI Analysis | [file] Raw Payload            │
│ [book] Evidence | [clock] History                                   │
├─────────────────────────────────────────────────────────────────────┤
```

- Active tab: purple underline + purple icon + bold text
- Inactive tabs: gray icon + gray text, clickable
- 5 tabs total: **Overview** (default), **AI Analysis**, **Raw Payload**, **Evidence**, **History**
- Custom SVG icons (see [Tab Icons](#tab-icons))
- Fixed tab bar at top of modal, sticky when scrolling

### Tab Icons

| Tab | SVG Icon | Description |
|-----|----------|-------------|
| Overview | 4-square grid | Dashboard-style overview |
| AI Analysis | Pen/edit | AI analysis output |
| Raw Payload | Document | Raw JSON payload |
| Evidence | Book/stack | Related evidence |
| History | Clock | Decision timeline |

### Tab Content

| Tab | Content |
|-----|---------|
| Overview | Alert header, AI analysis card, stats cards, fields grid, threat decision buttons, reviewed banner |
| AI Analysis | Full-width 2×2 AI structured output (same as Overview AI card but larger) |
| Raw Payload | Scrollable `<pre>` block with the raw EVE JSON payload |
| Evidence | Related audit evidence panel (same logic as existing `View Related Evidence` button) |
| History | Current `hitl_decision` snapshot (single entry, not a timeline) |

---

## Design Section 2: Overview Tab

### 2.1 Alert Header

```
┌─ [shield icon] Suricata Alert #2841  [CRITICAL badge] ──────────┐
│ [clock] Today, 14:32:11   [person] Reviewed by: —               │
│ [detected] Detected: 14:32:11                                    │
│                                      Status: [Unreviewed badge] │
└──────────────────────────────────────────────────────────────────┘
```

- Title: "Suricata Alert #{log_id}" with severity badge (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW`)
- Severity badge colors: CRITICAL=red (`bg-red-600`), HIGH=orange, MEDIUM=amber, LOW=gray
- Three metadata rows: timestamp, reviewed by, detected time
- Status badge: Unreviewed (amber), Confirmed Threat (green), False Positive (red)

### 2.2 AI Analysis Card

Two mutually exclusive states.

#### State 1: AI Analysis Running (Progress)

```
┌─ [pen icon] AI Threat Analysis in Progress ─────────────────────┐
│ Running analysis via Ollama...                                   │
│                                                                  │
│   [✓]─[🔄]─[○]─[○]                                              │
│  Fetching Analyzing Normalizing Complete                         │
│ Alert data  Ollama     Structuring Ready for                     │
│ loaded      inf...     output     review                         │
│                                                                  │
│ [clock] Elapsed: 3.2s                            [Cancel]       │
└──────────────────────────────────────────────────────────────────┘
```

**Progress Stepper Details:**

- 4 steps in a row with a continuous connector line behind the circles
- Background connector line: `bg-gray-200` (full width)
- Foreground connector line: `bg-purple-600` (fills through completed + current step)
- Step circles: 28×28px, filled
  - Completed: purple (`bg-purple-600`) with white checkmark SVG
  - Current (active): purple with animated spinner/clock SVG
  - Pending: gray (`bg-gray-200`) with gray icon
- Step labels: 12px, bold for active/completed, gray for pending
- Sub-labels: 10px, colored per state
- Active step pulse animation on the circle (CSS `animate-pulse`)

**Stepper Stages:**

| Stage | State (in progress) | State (complete) |
|-------|-------------------|-------------------|
| 1. Fetching | Checkmark | Checkmark |
| 2. Analyzing | Animated spinner | Checkmark |
| 3. Normalizing | Gray pending | Checkmark |
| 4. Complete | Gray pending | Checkmark |

- **Connector line:** Absolutely positioned element behind circles, 2px tall
  - Progress state: filled portion through completed + current step = purple, rest = gray
  - Complete state: all purple
- **Elapsed timer:** Lives below stepper, updates in real-time (via `setInterval` every 200ms), shows "Elapsed: {seconds}s" with clock icon
- **Cancel button:** Outlined purple button. Requires adding `AbortController` to the `handleAnalyze` fetch — the current implementation does not support cancellation. The abort aborts the HTTP fetch and resets the stepper to the "Analyze with AI" initial state.
  - **Backend note:** Aborting the HTTP request client-side does NOT halt the Ollama inference process server-side. The FastAPI handler in `ai_service.py` must check `request.is_disconnected()` (FastAPI's `Request` object) within the async loop to detect client disconnection and cleanly release the Ollama thread. Add a connection-liveness check before returning the Ollama response.
- **Edge case — fast analysis (<1s):** Minimum 500ms display of the stepper before transitioning to results to prevent flicker
- **Edge case — error during analysis:** Stepper shows red error state on the failed step, with error message and "Retry" button

#### State 2: AI Analysis Complete

```
┌─ [pen icon] AI Threat Analysis Complete ────────────────────────┐
│ Completed in 4.7s · Ollama qwen2.5:1.5b                        │
│                                                                  │
│  [✓]─[✓]─[✓]─[✓] (all purple, all checkmarks)                  │
│                                                                  │
│ ┌─ Anomaly Description ─────┐ ┌─ Risk Assessment ───────────┐   │
│ │ Potential SSH port scan   │ │ HIGH — SSH scanning often   │   │
│ │ from external IP...       │ │ precedes brute-force...     │   │
│ └──────────────────────────┘ └──────────────────────────────┘   │
│ ┌─ Log Evidence ───────────┐ ┌─ Recommended Action ────────┐   │
│ │ 3 failed SSH auth        │ │ Block source IP at          │   │
│ │ attempts in 2s window...  │ │ firewall...                 │   │
│ └──────────────────────────┘ └──────────────────────────────┘   │
│                                                                  │
│ [info] Sources: Suricata EVE log · Ollama · Threat intel        │
│                                                                  │
│ Anomaly Detection ─███████████████████████████░ 97%             │
│ Classification    ─██████████████████████████░░ 94%              │
│ Overall           ─███████████████████████████░ 96%              │
└──────────────────────────────────────────────────────────────────┘
```

**2×2 Results Cards:**
- 4 cards in a 2×2 grid (`grid-cols-2` with `gap-3`)
- Each card: white background, rounded, 1px purple border
  - **Anomaly Description** — natural language description of what was detected
  - **Risk Assessment** — severity assessment with reasoning
  - **Log Evidence** — specific log evidence supporting the conclusion
  - **Recommended Action** — actionable recommendation for the analyst
- Each card has: uppercase header label (purple, 10px, `tracking-wider`), body text (13px, `text-gray-800`)

**Source Annotation:**
- Light purple background bar below the 2×2 grid
- Info icon + "Sources: **Suricata EVE log** (payload) · **Ollama** (pattern match) · **Threat intel** (IP reputation)"
- Color: `bg-purple-100`, text `text-purple-700`

**Confidence Breakdown Bars:**
- 3 bars in a horizontal row
- Each bar: label (11px, gray), percentage (bold), progress bar (4px tall, rounded)
  - **Anomaly Detection** — purple bar
  - **Classification** — purple bar
  - **Overall** — purple bar
- Values come from the new `xai_confidence_breakdown` JSONB column

**Transition from State 1 to State 2:**
- When the API responds, transition with a brief fade-in (150ms `opacity` transition)
- The stepper completes fully (all checkmarks) before the results cards appear
- The elapsed timer replaces with "Completed in {seconds}s"

**Empty/Error State (no analysis available):**
- If no `xai_narrative` exists, show a single "Analyze with AI" button (same as current behavior)
- After clicking, transition to State 1 (progress stepper)

### 2.3 Stats Cards Row

```
┌─ AI Confidence ───┐ ┌─ Classification ──┐ ┌─ Related Events ──┐
│  96.3%            │ │ Port Scan - SSH   │ │         3         │
│  AI Confidence    │ │ Classification    │ │ Related Events    │
│  [purple icon]    │ │ [red icon]        │ │ [green icon]      │
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

- 3 cards in a row (`flex`, `gap-3`)
- Each card: 40px icon container (rounded), large metric, label
- Card 1 (AI Confidence): Purple background (`bg-purple-600`) icon, `#5b21b6` text, AI icon SVG
  - Metric: `xai_confidence_breakdown.overall` formatted as percentage
- Card 2 (Classification): Red background (`bg-red-600`) icon, `#991b1b` text, warning triangle SVG
  - Metric: `classification` value (free-text from the model, e.g. "Port Scan - SSH")
- Card 3 (Related Events): Green background (`bg-green-600`) icon, `#15803d` text, document stack SVG
  - Metric: Count of related audit events (from the existing `related-audit` endpoint). This requires an eager fetch when the modal opens — the current implementation is lazy (only on button click). Add a `useEffect` on modal open to fetch the count.
  - Alternative (V1 fallback): Show "—" until the user clicks View Related Evidence or the Evidence tab; then update the count.
  - **Race condition prevention:** The `useEffect` performing the eager fetch must include a cleanup function that discards stale responses. Use an `AbortController` or a `useRef` boolean flag: if `log.log_id` changes before the fetch settles, the in-flight response is ignored to prevent stale counts overwriting current data.

**Edge case — null classification:** Show em-dash (—) instead of metric name
**Edge case — zero related events:** Show "0" as metric, label "Related Events"

### 2.4 Alert Fields Grid

```
┌─ Alert Fields ───────────────────────────────────────────────────┐
│ ┌──────────┬──────────┬──────────┬──────────┐                    │
│ │Source IP │Dest IP   │SID       │Signature │                    │
│ │203.0.113 │10.0.1.50 │2024153   │ET SCAN   │                    │
│ │.42       │          │          │Potential │                    │
│ │          │          │          │SSH Scan  │                    │
│ ├──────────┼──────────┼──────────┼──────────┤                    │
│ │Category  │Timestamp │Protocol  │Port      │                    │
│ │Attempted │2026-06-28│TCP       │22 → 54321│                    │
│ │Info Leak │T14:32:11Z│          │          │                    │
│ └──────────┴──────────┴──────────┴──────────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

- 8 fields in a 4-column grid (`grid-cols-4`)
- Each field: uppercase label (10px, gray, `tracking-wider`), value
  - **Source IP** — monospace font, `font-semibold`
  - **Destination IP** — monospace font, `font-semibold`
  - **Suricata SID** — `font-semibold`
  - **Signature** — `suricata_signature`, truncated if >30 chars with tooltip
  - **Category** — `suricata_category` or `classification`
  - **Timestamp** — ISO 8601 format
  - **Protocol** — uppercased, derived from raw_payload (EVE `proto` field) or —
  - **Port** — "src_port → dst_port" string derived from raw_payload (EVE `src_port`, `dest_port`), or single value
- Background: `bg-gray-50` with `border-gray-200`
- Rounded corners, padding 16px

**Data sourcing:** The `SecurityLog` interface currently does not have `protocol` or `port` fields. These must be derived from `raw_payload` (EVE JSON has `src_port`, `dest_port`, `proto` fields) on the frontend via a lightweight parser. For V1, derive client-side from `raw_payload` to avoid backend schema changes.

**Edge case — null field:** Show em-dash (—) as value
**Edge case — missing port/protocol:** Derive from `raw_payload` when possible, fall back to —

### 2.5 Threat Decision Row

```
Threat Decision
┌──────────────┐ ┌──────────────┐ ┌────────────────┐ ┌──────────────────┐ ┌────────────────┐
│ [✓] Confirm  │ │ [✗] False   │ │ [?] Request    │ │ [🔍] View        │ │ [📄] Create    │
│     Threat   │ │   Positive   │ │   More Info    │ │   Related        │ │   Incident     │
│  red filled  │ │  gray filled │ │  white outline │ │  Evidence        │ │  orange filled │
└──────────────┘ └──────────────┘ └────────────────┘ └──────────────────┘ └────────────────┘
```

5 buttons with distinct visual hierarchy:

| Button | Style | Icon | Action |
|--------|-------|------|--------|
| Confirm Threat | Red filled (`#dc2626`), white text | Checkmark | `PATCH /security-logs/{id}` with `action=CONFIRM_THREAT` |
| False Positive | Gray filled (`#e5e7eb`), dark text | X | `PATCH /security-logs/{id}` with `action=FALSE_POSITIVE` |
| Request More Info | White outlined (`border-gray-300`), dark text | Question circle | `PATCH /security-logs/{id}` with `action=REQUEST_MORE_INFO` |
| View Related Evidence | White outlined (`border-gray-300`), dark text | Magnifying glass | Toggle related evidence panel (same as existing, now also opens Evidence tab) |
| Create Incident | Orange filled (`#ea580c`), white text | Document | `POST /security-logs/{id}/create-incident` (existing endpoint) |

**Loading State (all buttons):**
- Wrap the entire button row in a `<div>` with `pointer-events: none` during submission to prevent accidental double-clicks or multi-button triggers
- Icon replaced with spinning SVG (`animate-spin`)
- Button opacity set to 0.7
- `cursor: not-allowed`
- Text changes to "Applying..." for the triggered button
- Other buttons disabled but remain visible
- After the API response, loading state clears and the modal transitions to Reviewed State

**Interactions:**
- Each button is independent (one async action at a time)
- Confirmed Threat + False Positive are terminal: after success, the decision row collapses and the Reviewed State banner appears
- Request More Info is non-terminal: the decision row remains but the status badge shows "More Info Requested"
- View Related Evidence toggles the evidence panel inline below the decision row (existing behavior). The Evidence tab (tab bar) shows the same content in the tabbed view — the button and tab are two access paths to the same data.
- Create Incident is independent: creates incident, shows success message with link to incident page (existing behavior)

### 2.6 Reviewed State Banner

```
┌─ [✓] Reviewed: Confirmed Threat ────────────────────────────────┐
│ Resolved 2026-06-28 14:45:00 by admin@bfp.gov.ph                │
└──────────────────────────────────────────────────────────────────┘
```

- Replaces the threat decision buttons when `admin_action_taken` is set
- Green background (`bg-green-50`, `border-green-200`)
- Checkmark icon in green circle
- Bold "Reviewed: {action label}" text
- Subtitle: "Resolved {timestamp} by {reviewer email}"
- Shows for: CONFIRM_THREAT, FALSE_POSITIVE
- REQUEST_MORE_INFO: amber banner with question icon instead

**Transition from buttons to banner:**
- After successful PATCH, buttons fade out (200ms) and banner fades in (200ms)
- Smooth animation, no layout shift (reserve space or animate height)

---

## Design Section 3: Other Tabs

### 3.1 AI Analysis Tab

Full-width version of the 2×2 structured output cards. Same content as the AI Analysis Card in State 2 (complete), but without the stepper or the card wrapper. Useful for copy-pasting or reading long recommendations.

### 3.2 Raw Payload Tab

Scrollable `<pre>` block with the raw EVE JSON payload (same as existing logic, now in its own tab instead of a section below the details).

### 3.3 Evidence Tab

Related audit evidence panel (same logic as existing `View Related Evidence`). Shows audit trail entries within ±1 hour window of the alert timestamp. Each entry: `action_type`, `timestamp`, `ip_address`, `user_agent`.

### 3.4 History Tab

**Limitation:** `hitl_decision` is a single JSONB column — if a new decision overwrites, the old one is lost. For V1, display the current `hitl_decision` snapshot only (action, note, reviewer, timestamp).

Display:
- Action label (from `hitl_decision.action` mapped through `HITL_ACTION_LABELS`)
- Note (if present)
- Reviewed by (from `hitl_decision.reviewed_by`)
- Reviewed at (formatted timestamp)
- **Future:** Maintain a `hitl_decision_history` JSONB array on `security_threat_logs` for a true timeline.

---

## Design Section 4: States

| State | AI Analysis Card | Threat Decision Row | Reviewed Banner |
|-------|-------------------|-------------------|-----------------|
| **Loading modal** | Skeleton placeholder | Skeleton buttons | Hidden |
| **No analysis** | "Analyze with AI" button | Full decision row | Hidden |
| **Analysis in progress** | Progress stepper (State 1) | Disabled | Hidden |
| **Analysis complete** | Structured output (State 2) | Full decision row | Hidden |
| **Analysis error** | Error message + Retry | Full decision row | Hidden |
| **Decision submitting** | Read-only (dimmed) | Loading state on clicked button | Hidden |
| **Confirmed / FP** | Read-only | Collapsed | Green banner |
| **More Info Requested** | Read-only | Remains but disabled | Amber banner |
| **Error on decision** | Read-only | Re-enabled, toast error | Hidden |

---

## Design Section 5: Backend Additions

### 5.1 New Column: `xai_confidence_breakdown`

Add to `wims.security_threat_logs`:

```sql
ALTER TABLE wims.security_threat_logs
ADD COLUMN xai_confidence_breakdown JSONB DEFAULT NULL;
```

Format:

```json
{
  "anomaly_detection": 0.97,
  "classification": 0.94,
  "overall": 0.96
}
```

All values are floats 0.0–1.0. The `overall` field matches the existing `xai_confidence` value (write both for consistency).

### 5.2 Modify `ai_service.py:analyze_threat_log`

- Add `xai_confidence_breakdown` to the prompt, requesting per-category confidence from the LLM
- After parsing the LLM response, extract `confidence_breakdown` object:
  ```python
  confidence_breakdown = {
      "anomaly_detection": max(0.0, min(1.0, float(parsed.get("confidence_breakdown", {}).get("anomaly_detection", confidence)))),
      "classification": max(0.0, min(1.0, float(parsed.get("confidence_breakdown", {}).get("classification", confidence)))),
      "overall": max(0.0, min(1.0, float(parsed.get("confidence_breakdown", {}).get("overall", confidence)))),
  }
  ```
- Add `xai_sources` array to the narrative response:
  ```python
  sources = parsed.get("sources", ["Suricata EVE log", "Ollama"])
  ```
  These are persisted in the narrative JSON (inside `xai_narrative` as a `sources` key)
- Update the UPDATE SQL to also set `xai_confidence_breakdown`
- Update the return dict to include `xai_confidence_breakdown`

### 5.3 Modify `ai_service.py` Prompt

Update the prompt to request the additional fields:

```
Output strictly JSON with keys:
'anomaly_description' (string),
'log_evidence' (string),
'risk_assessment' (string),
'recommended_action' (string),
'confidence' (float 0.0-1.0),
'confidence_breakdown' (object with keys 'anomaly_detection', 'classification', 'overall', each float 0.0-1.0),
'sources' (array of strings indicating which data sources were used).
```

### 5.4 Modify `security.py` GET Response

Add `xai_confidence_breakdown` to the SELECT and response dict in the GET `/security-logs` endpoint.

### 5.5 Modify `xaiNarrativeNormalizer.ts`

Enhance `normalizeNarrative` to handle the new fields:

- `confidence_breakdown` — extract from the parsed JSON and surface as a new field in `ParsedNarrative`
- `sources` — extract the sources array from the narrative JSON

Update `ParsedNarrative` interface:

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

Update `extractPartialFields` with regex patterns for the new fields.

**Regex fragility mitigation:** The backend already uses `"format": "json"` in the Ollama prompt (see `ai_service.py`), which forces the LLM to return valid JSON. To further reduce regex fallback reliance:
1. Add the `confidence_breakdown` and `sources` fields to the Ollama response schema in the prompt (already specified in Section 5.3)
2. Add explicit type coercion for the breakdown floats in the backend response parsing (already in Section 5.2)
3. If the LLM returns structured JSON (which it does >95% of the time with `format: json`), the regex fallback is never reached. The regex path is a last-resort safety net for malformed responses.
4. For the regex patterns themselves, use strict key matching (e.g., `"confidence_breakdown"\s*:\s*\{`) rather than loose substring matching to reduce false positives.

### 5.6 Migration

New migration file: `76_add_xai_confidence_breakdown.sql`:

```sql
ALTER TABLE wims.security_threat_logs
ADD COLUMN xai_confidence_breakdown JSONB DEFAULT NULL;

COMMENT ON COLUMN wims.security_threat_logs.xai_confidence_breakdown
IS 'Per-category AI confidence: {anomaly_detection, classification, overall}';
```

---

## Design Section 6: Component Architecture (within page.tsx)

The modal should be extracted to a dedicated component file to avoid further bloating `page.tsx` (currently 2896 lines). Extract the entire modal into:

```
src/frontend/src/app/admin/system/components/SuricataAlertModal.tsx
```

This component accepts:
```typescript
interface SuricataAlertModalProps {
  log: SecurityLog;
  onClose: () => void;
  onDecisionComplete: (logId: number, updatedLog: Partial<SecurityLog>) => void;
}
```

Internal state is fully self-contained (active tab, stepper progress, analysis state, loading flags). The parent `page.tsx` imports and renders `<SuricataAlertModal>` when `selectedLog !== null`.

```
┌─ selectedLog !== null gate ──────────────────────────────────────────┐
│  ┌─ Modal backdrop (fixed inset, bg-black/50) ┐                     │
│  │  ┌─ Modal container (max-w-4xl, wider) ──────────────────────┐   │
│  │  │  ┌─ Header ──────────────────────────────────────────────┐ │   │
│  │  │  │  ShieldAlert icon + "Suricata Alert #{log_id}"        │ │   │
│  │  │  │  Close button                                          │ │   │
│  │  │  └────────────────────────────────────────────────────────┘ │   │
│  │  │  ┌─ Tab Bar ──────────────────────────────────────────────┐ │   │
│  │  │  │  5 tabs with SVG icons and click handlers              │ │   │
│  │  │  └────────────────────────────────────────────────────────┘ │   │
│  │  │  ┌─ Tab Content ──────────────────────────────────────────┐ │   │
│  │  │  │  (see sections above per tab)                          │ │   │
│  │  │  └────────────────────────────────────────────────────────┘ │   │
│  │  └─────────────────────────────────────────────────────────────┘   │
│  └─────────────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────┘
```

**Key refactors within page.tsx:**
- Wrap modal content in tab content switcher
- Extract SVG icon components as inline functions or constants
- Internal state: `activeTab` (defaults to 'overview'), `analysisInProgress`, `analysisError`, and stepper progress tracking
- The `analyzingLogId` state is replaced by `analysisInProgress` (boolean) + stepper stage tracking (`'idle' | 'fetching' | 'analyzing' | 'normalizing' | 'complete' | 'error'`)
- All handler functions (`handleHitlDecision`, `handleAnalyze`, etc.) are moved into the component
- **Tab state reset:** When `selectedLog` changes (user clicks a different row), the tab must reset to 'overview'. Implement via `useEffect` keyed on `log.log_id` that sets `activeTab` to 'overview'.

### Modal Width Increase

Current modal: `max-w-2xl` → new modal: `max-w-4xl` to accommodate the 4-column grid and the stats cards row without cramping.

**Responsive adaptation:** On viewports <1024px, collapse the 4-column grid to 2 columns and stack the 3 stats cards vertically. The modal container should use `max-w-[95vw]` on small screens (`<md` breakpoint) to prevent overflow. Tailwind classes: `max-w-4xl md:max-w-[95vw]`.

---

## Design Section 7: SVG Icons Reference

All icons are inline SVGs (no icon library dependency). Key icons:

| Icon | Usage | SVG Description |
|------|-------|----------------|
| Overview (grid) | Tab bar | 4 small squares in 2×2 |
| AI Analysis (pen) | Tab bar, AI card header | Pen/edit symbol |
| Raw Payload (file) | Tab bar | Document with lines |
| Evidence (book) | Tab bar | Two stacked pages |
| History (clock) | Tab bar | Clock with hour/minute hands |
| Checkmark | Stepper completed, Confirm button | `M20 6 9 17l-5-5` |
| Spinner | Loading states | Animated circle arc |
| Shield | Header | Shield with checkmark |
| Question circle | Request More Info button | Circle with `?` |
| Magnifying glass | View Related Evidence button | Search icon |
| Document | Create Incident button | Document with lines |

---

## Design Section 8: Visual Specification

| Element | Color | Background | Border | Radius | Font |
|---------|-------|-----------|--------|--------|------|
| Active tab text | `#7c3aed` | — | Bottom `#7c3aed 2px` | — | 13px, 600 |
| Inactive tab text | `#6b7280` | — | — | — | 13px, 500 |
| AI Analysis Card | — | `#faf5ff` | `#e9d5ff` | 10px | — |
| AI card header icon | white | `#7c3aed` | — | 8px | — |
| AI card section header | `#7c3aed` | — | — | — | 10px, 700, uppercase |
| Stepper circle (done) | white | `#7c3aed` | — | 9999px | — |
| Stepper circle (active) | white | `#7c3aed` | — | 9999px | — |
| Stepper circle (pending) | `#9ca3af` | `#e5e7eb` | — | 9999px | — |
| Stepper connector line (filled) | — | `#7c3aed` | — | — | 2px tall |
| Stepper connector line (empty) | — | `#e5e7eb` | — | — | 2px tall |
| Source annotation bar | `#5b21b6` | `#ede9fe` | — | 6px | 12px |
| Stats card (confidence) | `#5b21b6` | `#faf5ff` | `#e9d5ff` | 10px | — |
| Stats card icon (conf) | white | `#7c3aed` | — | 10px | — |
| Stats card (classification) | `#991b1b` | `#fef2f2` | `#fecaca` | 10px | — |
| Stats card icon (class) | white | `#dc2626` | — | 10px | — |
| Stats card (events) | `#15803d` | `#f0fdf4` | `#bbf7d0` | 10px | — |
| Stats card icon (events) | white | `#16a34a` | — | 10px | — |
| Fields grid bg | — | `#f9fafb` | `#e5e7eb` | 10px | — |
| Fields label | `#9ca3af` | — | — | — | 10px, uppercase |
| Confirm Threat btn | white | `#dc2626` | — | 8px | 13px, 600 |
| False Positive btn | `#374151` | `#e5e7eb` | — | 8px | 13px, 600 |
| Request More Info btn | `#374151` | white | `#d1d5db` | 8px | 13px, 600 |
| Create Incident btn | white | `#ea580c` | — | 8px | 13px, 600 |
| Review banner (confirmed) | `#15803d` | `#f0fdf4` | `#bbf7d0` | 8px | 13px, 600 |

---

## Migration Considerations

1. **Backward compatibility:** The `xai_confidence_breakdown` column is nullable. Existing records without breakdown data should render gracefully (show only the overall `xai_confidence` bar, hide breakdown bars).
2. **SQL migration:** Create a new file `src/postgres-init/76_add_xai_confidence_breakdown.sql`. The existing bootstrap spans `000_` through `075_` (76 files, zero-indexed), so `76_` avoids collision.
3. **Existing analysis records:** Old `xai_narrative` records won't have `confidence_breakdown` or `sources`. The normalizer should handle missing fields gracefully (return null for breakdown, empty array for sources).
4. **Frontend without backend changes:** The tabbed layout and decision buttons work without backend changes. The AI Analysis card and progress stepper require the backend to emit `xai_confidence_breakdown` for full functionality, but degrade gracefully (show single confidence bar).
5. **Modal width increase:** `max-w-2xl` → `max-w-4xl` requires responsive adaptation for <1024px viewports (see Design Section 6 — Modal Width Increase). Test at 1024px and 768px viewport widths.
6. **Extraction to separate component:** Moving the modal out of `page.tsx` into `SuricataAlertModal.tsx` means tests that reference the modal indirectly (e.g., HITL tests that simulate the modal) need updated imports. See test plan below.
