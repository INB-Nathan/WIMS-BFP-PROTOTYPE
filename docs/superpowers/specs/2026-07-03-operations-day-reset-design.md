# Operations Day Reset and Archive Design

## Goal
Add an Operations Board day reset that archives every active operation by default, while allowing `NATIONAL_VALIDATOR` users to mark selected operations as `keep_overnight` for a one-reset carryover. Provide an archived operations board and validator restore flow.

## Scope
- Active operations list defaults to non-archived operations.
- Archived operations are visible on an archived board.
- Validators can toggle `keep_overnight` on active operations.
- Manual reset requires confirmation with archive/carryover counts.
- Automatic reset runs daily at configurable Asia/Manila time, default `06:00`.
- Restoring an archived operation requires choosing the current fire status.

## Data Model
Add to `wims.operations`:
- `is_archived BOOLEAN NOT NULL DEFAULT FALSE`
- `archived_at TIMESTAMPTZ NULL`
- `archived_by UUID NULL`
- `archive_reason TEXT NULL`
- `keep_overnight BOOLEAN NOT NULL DEFAULT FALSE`
- `carried_over_at TIMESTAMPTZ NULL`
- `last_reset_at TIMESTAMPTZ NULL`

Add `wims.operation_reset_batches`:
- `reset_id BIGSERIAL PRIMARY KEY`
- `triggered_by UUID NULL`
- `trigger_type TEXT NOT NULL CHECK (trigger_type IN ('AUTO','MANUAL'))`
- `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `completed_at TIMESTAMPTZ NULL`
- `archive_count INTEGER NOT NULL DEFAULT 0`
- `carried_over_count INTEGER NOT NULL DEFAULT 0`
- `notes TEXT NULL`

## API
- `GET /api/operations?archived=false|true`: default active only.
- `PATCH /api/operations/{operation_id}`: accepts `keep_overnight` for validators.
- `GET /api/operations/reset-preview`: validator-only counts active operations that will archive vs carry over.
- `POST /api/operations/reset-day`: validator-only manual reset.
- `POST /api/operations/{operation_id}/restore`: validator-only, requires `fire_status`.

## Reset Rules
For all active operations:
- If `keep_overnight = TRUE`: keep active, clear `keep_overnight`, set `carried_over_at` and `last_reset_at`.
- Otherwise: set `is_archived = TRUE`, `archived_at`, `archived_by` if manual, `archive_reason = 'daily_reset'`, clear `keep_overnight`, set `last_reset_at`.
- Insert one reset batch with counts.

## Frontend
- Operations board has Active/Archived toggle.
- Active board shows validator-only `Keep overnight` action and badge.
- Validator-only `Reset Day` button opens confirmation with preview counts.
- Archived board is read-only except validator `Restore`.
- Restore modal requires choosing fire status.

## Testing
Backend unit tests cover active/archive filtering, reset preview, reset carryover/archive behavior, and restore status requirement.
Frontend tests cover keep-overnight toggle, reset preview modal counts, archived board display, and restore status modal.
