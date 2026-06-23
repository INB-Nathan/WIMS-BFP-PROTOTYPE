# Fix encoder dashboard widget scope (user, not region)

## Goal
Make all `REGIONAL_ENCODER` widgets count the encoder's own work (`encoder_id = :uid`)
instead of the region's work. Rename labels so the scope is obvious.

## Touch list
- [ ] `src/backend/api/routes/dashboard.py` — switch 6 encoder widgets to `encoder_id = :uid`,
      add `{region_filter}` to `by_category`, extend placeholder logic to cover both
      `total_incidents` and `by_category`, pass `:uid` in params.
- [ ] `src/frontend/src/components/dashboard/widget-definitions.ts` — rename
      `Drafts` → `My Drafts`, `Submitted Today` → `My Submissions Today`,
      `Pending Validation` → `My Pending Validation`,
      `By Alarm Level` → `My Incidents by Alarm Level`.
      (Leave `Total Incidents` and `By Category` labels alone — shared with
      `NATIONAL_ANALYST` / `SYSTEM_ADMIN` / `NATIONAL_VALIDATOR`.)
- [ ] `src/frontend/src/components/dashboard/WidgetGrid.test.tsx` — update test
      expectations for renamed labels.
- [ ] `src/backend/tests/test_dashboard_widgets.py` — update mock prefix for
      `total_incidents` (`fi.region_id = :rid` → `encoder_id = :uid`) and add a
      new test that asserts every encoder widget SQL uses `encoder_id`, not
      `region_id`.
- [ ] `system-wiki/log.md` — append the change entry.
- [ ] `system-wiki/subsystems/regional-dashboard.md` — note that encoder widgets
      are user-scoped (only if the page already covers widget scope; otherwise
      skip).
- [ ] CI preflight: `ruff check`, `ruff format --check`, `pytest`, `npm run lint`,
      `npx vitest run`.
