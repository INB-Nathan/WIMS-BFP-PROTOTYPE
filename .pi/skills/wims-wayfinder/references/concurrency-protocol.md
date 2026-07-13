# WIMS Wayfinder Concurrency Protocol

GitHub assignment is visual metadata, not exclusive ownership: multiple sessions may share one account and GitHub permits multiple assignees. Claims and map writes therefore use append-only, versioned comments.

## Tokens and markers

Generate a fresh UUID for each claim or lock:

```bash
python -c 'import uuid; print(uuid.uuid4())'
```

Use these exact hidden markers inside readable comments:

```html
<!-- wims-wayfinder-claim:v1 token=<uuid> -->
<!-- wims-wayfinder-release:v1 token=<uuid> -->
<!-- wims-wayfinder-write-lock:v1 token=<uuid> -->
<!-- wims-wayfinder-write-release:v1 token=<uuid> -->
<!-- wims-wayfinder-resolution:v1 ticket=<number> -->
```

GitHub's immutable comment `createdAt` supplies ordering. A release references exactly one token.

## Ticket claim

1. Re-read the ticket state, parent, blockers, and comments. Stop unless it is an open, direct child with every blocker closed.
2. Generate a token and post a comment containing the claim marker plus a short readable line naming the session purpose.
3. Re-read all comments.
4. A claim is **active** when its marker has no later matching release marker.
5. Sort active claim comments by GitHub `createdAt`, then comment ID. The earliest is the winner.
6. Continue only if this session's token won. A losing session posts its matching release, makes no resolution mutation, and chooses another frontier ticket or stops.

Claims have no automatic expiry. A crashed or abandoned claim remains active until its owner releases it or the user explicitly authorizes an override release after checking that no worker is still active.

Optional assignment may be added after winning and removed after release, but it never changes the winner.

## Ticket release

Post a readable release comment with the matching release marker when:

- the session loses the claim race;
- the user pauses or abandons work;
- a prerequisite prevents resolution;
- the ticket resolves and all ticket/map mutations have been verified.

Never edit or delete claim comments to change history.

## Map-writer lock

Ticket work may proceed concurrently, but map-body updates are serialized.

1. Post a unique write-lock marker on the map.
2. Re-read map comments and determine the winner using the same earliest-active rule, with write-release markers.
3. If this session loses, release its token and wait or hand off; do not edit the map body.
4. Once it wins, read the latest map `body` and `updatedAt`, then compute a SHA-256 hash of the exact body.
5. Merge only the intended linked decision gist, fog graduation, or out-of-scope entry.
6. Immediately re-read the body before writing. If its hash changed, merge against the new body and repeat the check.
7. Write with `gh issue edit <map> --body-file <file>`.
8. Re-read and verify the intended entry exists and unrelated sections remain intact.
9. Post the matching write-release marker.

The cooperative lock does not prevent a human or non-Wayfinder client from editing concurrently. The immediate pre-write comparison and post-write verification are mandatory. If verification detects a conflict, preserve the ticket's append-only resolution, reacquire the writer lock, and rebuild the map from the latest body and closed-child resolution comments. Never restore a stale complete body.

## Resolution order

After winning a ticket claim:

1. Post one complete readable resolution comment with the resolution marker.
2. Re-read it and verify the marker and content.
3. Close the ticket as completed.
4. Acquire the map-writer lock and update the map index.
5. Verify the map, release the writer lock, then release the ticket claim.

If closing or map updating fails, report the exact completed steps. The resolution comment remains durable evidence and makes recovery idempotent.

## Idempotent recovery

Before retrying, search comments for the operation's token or resolution marker. Do not repost an existing successful operation. Match tickets through native parentage plus body marker; titles alone are insufficient.
