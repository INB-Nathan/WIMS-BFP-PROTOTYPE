# Hide Dismissed Threats — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-30-hide-dismissed-threats-design.md`
**Pre-requisite:** PR #497 merged (active_count/dismissed_count fields in summary)

---

## P1 — Backend: `show_dismissed` query parameter

**File:** `src/backend/api/routes/admin/security.py`

**Change — `get_security_logs()`** (around line 140):

Add `show_dismissed: bool = Query(default=False)` to function parameters.

After the existing WHERE clause building block (after the `q` block, around line 177), add:
```python
if not show_dismissed:
    where_clauses.append(
        "(admin_action_taken IS NULL OR admin_action_taken NOT IN (:dismissed_val, :fp_val))"
    )
    params["dismissed_val"] = "Dismissed"
    params["fp_val"] = "False Positive (Dismissed)"
```

This filters out dismissed/false-positive rows from both the row query and the paginated total count query (both use `where_sql`).

## P2 — Frontend: Toggle pill + "X dismissed" link

**File:** `src/frontend/src/app/admin/monitoring/page.tsx`

### P2.1 — State

Add state at the top of the component (around line 70):
```typescript
const [showDismissed, setShowDismissed] = useState(false);
```

### P2.2 — API call wiring

Update the `loadThreats` callback (or wherever the fetch happens) to pass `show_dismissed`:
```typescript
const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
if (activeSeverities.size > 0) params.severity = [...activeSeverities].join(',');
if (sourceIp) params.source_ip = sourceIp;
if (dateFrom) params.date_from = dateFrom;
if (dateTo) params.date_to = dateTo;
if (searchQ) params.q = searchQ;
if (showDismissed) params.show_dismissed = 'true';  // NEW
```

### P2.3 — Toggle pill

Add in the filter bar area (near the severity chips, around line 540):
```tsx
<button
  onClick={() => setShowDismissed((v) => !v)}
  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
    showDismissed
      ? 'border-[var(--bfp-maroon)] text-[var(--bfp-maroon)] bg-white'
      : 'border-gray-300 text-gray-500 bg-gray-50'
  }`}
>
  {showDismissed ? 'Include Dismissed' : 'Dismissed Hidden'}
</button>
```

### P2.4 — "X dismissed" link in summary card

Replace the passive dismissed_count text with a clickable link:
```tsx
{(summary?.dismissed_count ?? 0) > 0 && (
  <button
    onClick={() => setShowDismissed(true)}
    className="text-xs mt-1 underline hover:no-underline cursor-pointer"
    style={{ color: 'var(--text-muted)' }}
  >
    {summary!.dismissed_count} dismissed — click to view
  </button>
)}
```

### P2.5 — Re-fetch on toggle change

Add a `useEffect` that calls `loadThreats()` when `showDismissed` changes:
```typescript
useEffect(() => {
  loadThreats();
}, [showDismissed]);
```
(If `loadThreats` is already called via a broader mechanism, may just need to ensure the dependency is wired.)

## P3 — Backend tests

**File:** `src/backend/tests/test_security_monitoring.py`

Add to `TestSecurityLogsSummary` or create a new test class:

1. **`test_default_excludes_dismissed`** — Create list DB mock where some rows have `admin_action_taken='Dismissed'`. Call `GET /security-logs` (no param). Assert dismissed rows are excluded from `items` and `total`.
2. **`test_show_dismissed_includes_all`** — Same mock, call `GET /security-logs?show_dismissed=true`. Assert all rows returned.
3. **`test_dismissed_filter_composes_with_severity`** — Mock with mixed dismissed/fp rows. Call with `severity=HIGH` and no `show_dismissed`. Assert only HIGH active rows returned.

## P4 — Frontend tests

**File:** `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx`

1. **Default state does not show dismissed** — Render with mock that includes dismissed rows in the full dataset. Assert they don't appear in the table.
2. **Toggle pill shows dismissed** — Click the filter pill, assert fetch was called with `show_dismissed=true`, assert dismissed rows appear.
3. **"X dismissed" link toggles filter** — Click the dismissed count link, assert it calls fetch with `show_dismissed=true`.

## Implementation Order

1. ✅ P1 — Backend param + WHERE clause
2. ✅ P2.1-P2.3 — Frontend toggle + state
3. ✅ P2.4 — "X dismissed" link
4. ✅ P2.5 — useEffect for re-fetch on toggle
5. ✅ Run backend lint: `ruff check .`
6. ✅ P3 — Backend tests
7. ✅ P4 — Frontend tests
8. ✅ Run all tests: backend + frontend

## Files Changed Summary

| File | Change |
|------|--------|
| `src/backend/api/routes/admin/security.py` | Add `show_dismissed` param + WHERE clause |
| `src/frontend/src/app/admin/monitoring/page.tsx` | Toggle pill, "X dismissed" link, state + wiring |
| `src/backend/tests/test_security_monitoring.py` | 3 new tests for dismissed filter |
| `src/frontend/.../admin-security-monitoring.test.tsx` | 3 new tests for toggle and link |
