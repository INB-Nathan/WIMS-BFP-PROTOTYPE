# Delegation Result: test_anomaly_detection.py update

**Agent:** worker  
**Model:** opencode/deepseek-v4-flash-free:xhigh  
**Status:** ✅ Complete — all 63 tests pass

## Summary

Updated `src/backend/tests/test_anomaly_detection.py` according to the plan to match production code changes in `anomaly_detection.py` (per-minute `window_start` via `date_trunc('minute', timestamp)`, SUSPICIOUS_QUERY_PATTERN `ORDER BY + LIMIT`, RAPID_IP_SWITCH trailing-window JOIN).

## Changes Applied

### A. TestWindowFloorDedup — per-minute window_start values
- **Section comment block**: renamed "Window-floor dedup stability" → "Per-minute dedup stability", updated doc to reference `date_trunc('minute', ...)`
- **Class docstring**: updated to say "per-minute window"
- **test_bulk_delete_key_is_window_floor_not_run_minute**: `window_floor` 14:00→14:01, dedup_key `202606121400`→`202606121401`, updated docstring and inline comments
- **test_bulk_delete_same_window_two_runs_produce_identical_key**: `window_floor` 14:00→14:01
- **test_bulk_delete_two_runs_yield_exactly_one_write**: `window_floor` 14:00→14:01
- **test_rapid_ip_key_is_window_floor_not_run_minute**: `window_floor` 14:00→14:01, dedup_key `202606121400`→`202606121401`, updated docstring
- **test_rapid_ip_two_runs_yield_exactly_one_write**: `window_floor` 14:00→14:01

### B. TestSuspiciousQueryPatternWindowFloor — same pattern
- **Class docstring**: updated to "per-minute window"
- **test_key_is_window_floor_not_run_minute**: `window_floor` 14:00→14:01, dedup_key `202606121400`→`202606121401`, updated docstring
- **test_two_runs_same_window_produce_identical_key**: `window_floor` 14:00→14:01
- **test_two_runs_yield_exactly_one_write**: `window_floor` 14:00→14:01

### C. TestQueryBounds — 3 new SUSPICIOUS_QUERY_PATTERN LIMIT tests
Added after `test_bulk_delete_limit_preserves_anomaly_detection`:
- **test_suspicious_query_sql_has_limit**: verifies `LIMIT :max_rows` and `ORDER BY t1.timestamp DESC` in SQL
- **test_suspicious_query_passes_max_rows_param**: verifies `max_rows: 10_000` in params
- **test_suspicious_query_limit_preserves_anomaly_detection**: verifies anomaly detection still works with LIMIT active

### D. Cross-boundary burst comment updates
- **TestBulkDeleteDetector.test_cross_boundary_burst_detected**: removed "fixed floor buckets" language
- **TestSuspiciousQueryPatternDetector.test_cross_boundary_burst_detected**: removed "Fixed floor-bucket" language
- **TestPasswordResetAbuseDetector.test_cross_boundary_burst_detected**: removed "With fixed floor buckets" language

### E. TestSuspiciousQueryPatternDetector.test_dedup_key_encodes_user_and_window
- `window_floor` 14:00→14:01, dedup_key assertion `202606121400`→`202606121401`

### G. TestRapidIPSwitchDetector.test_cross_boundary_ip_switch_detected comment
- Removed "different floor buckets" → "different per-minute windows"

## Test Results

```
63 passed in 0.73s
```

All existing tests pass and the 3 new tests validate the SUSPICIOUS_QUERY_PATTERN LIMIT behavior.
