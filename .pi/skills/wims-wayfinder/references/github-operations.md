# WIMS Wayfinder GitHub Operations

Run commands from the WIMS-BFP repository root. Use `--repo x1n4te/WIMS-BFP-PROTOTYPE` for mutation commands even after repository verification so the target is explicit.

## Preflight

```bash
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef
gh --version
gh label list --limit 200 --json name,color,description
```

Require `x1n4te/WIMS-BFP-PROTOTYPE`. This profile relies on GitHub CLI support for `--parent`, `--add-blocked-by`, and JSON fields `parent`, `subIssues`, `blockedBy`, `blocking`, `comments`, and `updatedAt`.

## Approved labels

Create only labels shown as missing in the confirmed chart batch:

```bash
gh label create 'wayfinder:map' --color 5319E7 --description 'Canonical Wayfinder decision map' --repo x1n4te/WIMS-BFP-PROTOTYPE
gh label create 'wayfinder:research' --color 1D76DB --description 'AFK research needed for a Wayfinder decision' --repo x1n4te/WIMS-BFP-PROTOTYPE
gh label create 'wayfinder:prototype' --color A2EEEF --description 'HITL prototype needed for a Wayfinder decision' --repo x1n4te/WIMS-BFP-PROTOTYPE
gh label create 'wayfinder:grilling' --color D4C5F9 --description 'HITL discussion needed for a Wayfinder decision' --repo x1n4te/WIMS-BFP-PROTOTYPE
gh label create 'wayfinder:task' --color FEF2C0 --description 'Prerequisite task needed to unblock a Wayfinder decision' --repo x1n4te/WIMS-BFP-PROTOTYPE
```

Do not use `--force`: changing an existing label is outside the confirmed missing-label batch.

## Create a map

Write the approved body to a temporary file and create it:

```bash
gh issue create \
  --repo x1n4te/WIMS-BFP-PROTOTYPE \
  --title 'Wayfinder: <destination name>' \
  --label 'wayfinder:map' \
  --body-file <map-body-file>
```

Capture the returned URL/number immediately. Re-read and verify the map marker before creating children.

## Create child tickets

Create all approved children before wiring dependencies:

```bash
gh issue create \
  --repo x1n4te/WIMS-BFP-PROTOTYPE \
  --parent <map-number> \
  --title '<decision title>' \
  --label 'wayfinder:<type>' \
  --body-file <ticket-body-file>
```

Record each returned identity and verify its native `parent` plus body marker:

```bash
gh issue view <ticket-number> \
  --repo x1n4te/WIMS-BFP-PROTOTYPE \
  --json number,title,url,state,parent,labels,body,blockedBy,blocking,comments,updatedAt
```

## Wire dependencies in a second pass

```bash
gh issue edit <blocked-ticket> \
  --repo x1n4te/WIMS-BFP-PROTOTYPE \
  --add-blocked-by <blocking-ticket>
```

Re-read both tickets. Do not recreate children when dependency wiring fails.

## Read a map and derive the frontier

```bash
gh issue view <map-number> \
  --repo x1n4te/WIMS-BFP-PROTOTYPE \
  --json number,title,url,state,body,labels,subIssues,subIssuesSummary,comments,updatedAt
```

For each direct sub-issue, read `state`, `parent`, `blockedBy`, labels, comments, and marker. A frontier ticket is:

- open;
- a direct child of the map;
- marked `kind=ticket` for that map;
- labelled with exactly one approved Wayfinder ticket type;
- blocked by no open issue;
- carrying no earlier active claim under the concurrency protocol.

Use GitHub sub-issue order. If the API response does not expose a stable order, use ascending issue number. Never treat global label search as proof of map membership.

## Comments, close reasons, and assignment

```bash
gh issue comment <number> --repo x1n4te/WIMS-BFP-PROTOTYPE --body-file <comment-file>
gh issue close <number> --repo x1n4te/WIMS-BFP-PROTOTYPE --reason completed
gh issue close <number> --repo x1n4te/WIMS-BFP-PROTOTYPE --reason 'not planned'
```

Optional visual assignment after a claim wins:

```bash
gh issue edit <number> --repo x1n4te/WIMS-BFP-PROTOTYPE --add-assignee '@me'
```

Remove it on release only if this workflow added it and doing so will not remove another collaborator's meaningful assignment.

## Conflict-safe map body update

Acquire the map-writer lock first. Then:

1. read `body` and `updatedAt` as JSON;
2. save the exact body and its SHA-256 hash locally;
3. construct a merged body in a temporary file;
4. re-read and compare the current exact body hash;
5. if unchanged, write with:

```bash
gh issue edit <map-number> \
  --repo x1n4te/WIMS-BFP-PROTOTYPE \
  --body-file <merged-map-body-file>
```

6. re-read and verify the intended linked gist plus every unrelated section;
7. release the writer lock.

A ticket's resolution comment is durable evidence. If the map update fails, do not repost the resolution or close another ticket; recover only the missing index update.

## Resolution comment

Use:

```markdown
<!-- wims-wayfinder-resolution:v1 ticket=<number> -->
## Resolution

<answer or completed prerequisite>

## Evidence and trade-offs

<verified evidence, alternatives, and why this answer was chosen>

## Consequences

<constraints or facts later tickets depend on>

## Remaining uncertainty

<none, or precisely bounded uncertainty>
```

The map receives only a linked one-line gist under Decisions so far. It must not duplicate the full resolution.

## Partial-failure report

On failure, report:

- confirmed batch identity;
- successful labels, map, child issues, edges, comments, and closures;
- failed command and stderr without secrets;
- exact recovery step;
- whether any claim or writer lock remains active.

Retry only after re-reading remote state and matching native hierarchy plus versioned markers.
