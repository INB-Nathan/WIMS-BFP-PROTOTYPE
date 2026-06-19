# Known Issues & Deferred Items

Track bugs, deferred work, and open decisions that don't belong in GitHub Issues yet.

---

## Open

| # | Area | Description | Status |
|---|------|-------------|--------|
| 1 | Backend tests | `test_scheduled_reports.py` fails — `croniter` not installed. Skip with `--ignore=tests/test_scheduled_reports.py`. | Known / deferred |
| 2 | Encoder submission | VPS missing schema columns from migrations 19/21/25/28/35/53/54. Fix: `apply_schema_patches()` in `main.py` adds them on restart. | Fixed in `c7d88b2`, pending deploy |
| 3 | Offline sync | Incidents created offline do not sync to server. Root cause not yet investigated. | Deferred |
| 4 | Fire Scene Sketch | H. Fire Scene Sketch section (JPG/PNG upload, AES-GCM encrypted storage) deferred. | Deferred — see memory |

## Closed

| # | Area | Description | Resolved |
|---|------|-------------|----------|
| — | — | — | — |

---

## How to run all CI checks locally

```bash
bash local-docs/ci-check.sh
```

Lint only (no tests — faster):

```bash
bash local-docs/ci-check.sh --no-tests
```

See [ci-check.sh](ci-check.sh) for details.
