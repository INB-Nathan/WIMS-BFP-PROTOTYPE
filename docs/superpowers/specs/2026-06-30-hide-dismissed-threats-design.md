# Hide Dismissed Threats by Default

**Date:** 2026-06-30
**Status:** Draft
**PR pre-requisite:** PR #497 (active_count/dismissed_count fields)

---

## Problem

The security monitoring threat table shows every row from `wims.security_threat_logs`, including dismissed and false-positive rows. As volume grows, operators waste time scanning past rows they've already handled. The previous PR added `active_count`/`dismissed_count` to the summary cards, but the table itself still shows everything.

## Design

### Backend — `GET /security-logs`

Add an optional `show_dismissed` query parameter (type: `bool`, default: `false`).

**When `show_dismissed=false` (default):** The WHERE clause adds:
```sql
AND (admin_action_taken IS NULL OR admin_action_taken NOT IN ('Dismissed', 'False Positive (Dismissed)'))
```
Applied to **both** the row query and the paginated `total` count, so pagination stays consistent.

**When `show_dismissed=true`:** No change from current behavior — all rows returned.

**Filters compose:** Existing filters (severity, source_ip, date range, search query) AND with the dismissed filter. A dismissed row that matches all other filters is still excluded unless `show_dismissed=true`.

### Frontend — Monitoring Page (`/admin/monitoring`)

**Filter bar — "Include Dismissed" toggle**

Add a toggle chip in the filter bar area (alongside severity chips and search). Styled as an outline pill:
- Default: **"Dismissed Hidden"** (gray outline, muted)
- Toggled on: **"Include Dismissed"** (maroon outline, solid)

When toggled on, the page re-fetches `GET /security-logs?show_dismissed=true` plus any other active filters. Dismissed rows in the table are visually distinct:
- Row background slightly muted (e.g., `opacity-70` or a gray left border)
- Status column already shows "Dismissed" or "False Positive (Dismissed)" from `admin_action_taken`

When toggled off (default), dismissed rows are excluded from results entirely.

**"X dismissed" link in summary card**

The secondary text in the Active Threats card — `{summary.dismissed_count} dismissed` — becomes a clickable link. Clicking it toggles the `show_dismissed` filter on (same as clicking the pill).

**Bulk actions remain unchanged**

The bulk action bar (select-all, block, dismiss, false_positive) works on whatever rows are currently in the table. When `show_dismissed=false`, the "Dismiss" bulk action on visible rows will make them disappear from view — the same behavior as today when refetching.

### Test changes

**Backend:** Add tests to `test_security_monitoring.py`:
- Default behavior excludes dismissed rows
- `show_dismissed=true` returns all rows
- `show_dismissed=false` composes with severity filter correctly

**Frontend:** Update `admin-security-monitoring.test.tsx`:
- Default state does not show dismissed rows
- Toggling "Include Dismissed" re-fetches with `show_dismissed=true`
- Clicking "X dismissed" link in card toggles the filter on

---

## Files Changed

| File | Change |
|------|--------|
| `src/backend/api/routes/admin/security.py` | Add `show_dismissed` param to `get_security_logs()`, append WHERE clause |
| `src/frontend/src/app/admin/monitoring/page.tsx` | Add toggle pill and "X dismissed" link, wire up `show_dismissed` param |
| `src/backend/tests/test_security_monitoring.py` | Add tests for dismissed filter |
| `src/frontend/.../admin-security-monitoring.test.tsx` | Add tests for toggle and link behavior |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Operator dismisses a row and it disappears — they think it failed | The toast already says "Alert dismissed". The count updates. This is consistent with existing behavior. |
| Offline cache serves stale list with dismissed | `StaleCacheBanner` already handles this. The filter param is part of the cache key. |
| Bulk "Dismiss" on visible rows when dismissed are hidden — refetch may show empty page | Same as today — the table refetches after bulk action and may return fewer rows. Pagination handles this via the total count. |
