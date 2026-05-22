---
title: "Phase 2 Slice 6: Gap 3 — Submit Error 911 + Error-Type Copy"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-3]
status: open
phase: 1
gaps: [3]
parent: civilian-reporting-phase-2-implementation-issues
---

# Phase 2 Slice 6: Submit Error — 911 + Error-Type Copy

**Type:** AFK — frontend-only
**File:** `src/frontend/src/app/report/page.tsx`

## Current State

Lines 437-452 in `page.tsx`:
```tsx
async function handleSubmit() {
  const payload = buildPayload();
  if (!payload) return;
  setSubmitting(true);
  setSubmitError(null);

  try {
    const res = await submitCivilianReportV2(payload);
    setSubmittedResponse(res);
    setSubmittedReportId(res.report_id);
    setStep('submitted');
  } catch (err) {
    setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    setSubmitting(false);
  }
}
```

Monolithic `catch` block — no 911 boundary, no error-type differentiation, no bilingual copy.

## Required Behavior

Every submit error must:
1. Show a 911 emergency boundary (always)
2. Show practical next-step copy **specific to the error type**
3. Provide bilingual (EN + FIL) copy

### Error Types

| Error signature | Display copy | Next step |
|---|---|---|
| Network failure / fetch error | "Network error. Check your connection." | "Retry when connected." |
| HTTP 422 / validation error | "Missing required fields." | Point to specific missing field |
| HTTP 429 / rate limit | "Too many reports from this network." | "Track or update an existing report instead." |
| HTTP 500 / server error | "Server error. Please try again later." | "Retry in a few minutes." |
| Unknown | "Submission failed. Please try again." | "If this persists, call 911 for immediate danger." |

### Implementation Approach

The `submitCivilianReportV2` function in `api.ts` returns structured error responses with HTTP status codes. The catch block should:

1. Detect error type from `err` shape (is it an `Error` with `response`? is it a `TypeError` for network?)
2. Set `submitErrorType` state: `'network' | 'validation' | 'rate_limit' | 'server' | 'unknown'`
3. Render a `<SubmitErrorBanner>` component that shows:
   - AlertTriangle icon
   - The appropriate copy per error type above
   - 911 boundary always present
   - 911 sentence in both EN + FIL
   - Retry action if applicable

### Target Component Structure

Add state:
```tsx
const [submitErrorType, setSubmitErrorType] = useState<'network' | 'validation' | 'rate_limit' | 'server' | 'unknown' | null>(null);
```

New `handleSubmit` catch block:
```tsx
catch (err) {
  // Detect error type
  const isNetworkError = err instanceof TypeError || err?.message?.includes('fetch');
  const status = err?.response?.status;

  let type: typeof submitErrorType = 'unknown';
  if (isNetworkError) type = 'network';
  else if (status === 422) type = 'validation';
  else if (status === 429) type = 'rate_limit';
  else if (status >= 500) type = 'server';

  setSubmitErrorType(type);
  setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
  setSubmitting(false);
}
```

Add error banner render (replaces existing `submitError` display in review step):
```tsx
{submitError && submitErrorType && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
    <div className="flex items-start gap-2">
      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-red-700">
          {submitErrorType === 'network' && 'Network error. Check your connection.'}
          {submitErrorType === 'validation' && 'Missing required information.'}
          {submitErrorType === 'rate_limit' && 'Too many reports from this network.'}
          {submitErrorType === 'server' && 'Server error. Please try again later.'}
          {submitErrorType === 'unknown' && 'Submission failed. Please try again.'}
        </p>
        <p className="text-xs text-red-600 mt-0.5">
          {submitErrorType === 'network' && 'Make sure you are connected to the internet and try again.'}
          {submitErrorType === 'validation' && 'Please check the form and try again.'}
          {submitErrorType === 'rate_limit' && 'Try tracking or updating an existing report instead.'}
          {submitErrorType === 'server' && 'Retry in a few minutes. If this persists, contact BFP directly.'}
          {submitErrorType === 'unknown' && 'If this persists, call 911 for immediate danger.'}
        </p>
      </div>
    </div>
    {/* 911 boundary — always present */}
    <div className="border-t border-red-200 pt-2">
      <p className="text-xs text-red-600">
        For immediate danger, call 911. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
      </p>
    </div>
  </div>
)}
```

## Acceptance Criteria

- [ ] Network error shows "Check your connection" + 911 sentence
- [ ] Validation error shows "Missing required information" + 911 sentence
- [ ] Rate limit error shows "too many reports from this network" + "track/update existing" + 911 sentence
- [ ] Server error shows "try again later" + 911 sentence
- [ ] Unknown error shows generic message + "call 911 for immediate danger" + 911 sentence
- [ ] All error types show bilingual (EN + FIL) 911 sentence
- [ ] 911 boundary is always present regardless of error type

## File to Modify

- `src/frontend/src/app/report/page.tsx`
  - `handleSubmit` catch block: error type detection + state update
  - Review step error display: replace plain `submitError` text with typed error banner
  - Add `submitErrorType` state