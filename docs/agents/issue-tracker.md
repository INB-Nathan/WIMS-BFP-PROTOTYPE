# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `x1n4te/WIMS-BFP-PROTOTYPE`. Use the `gh` CLI for issue operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Run `gh` from inside this clone so it infers the repository from `git remote -v`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

`/skill:wims-wayfinder` uses GitHub issues as a manual-only decision map for
large, uncertain, multi-session efforts. Its detailed command and recovery
contract lives in `.pi/skills/wims-wayfinder/references/github-operations.md`;
its claim and map-writer rules live in
`.pi/skills/wims-wayfinder/references/concurrency-protocol.md`.

GitHub CLI 2.94 or newer provides the required native operations:

- create a child: `gh issue create --parent <map-number> ...`;
- attach existing children: `gh issue edit <map> --add-sub-issue <number>`;
- wire blockers: `gh issue edit <blocked> --add-blocked-by <blocker>`;
- inspect hierarchy/frontier data: `gh issue view <number> --json parent,subIssues,blockedBy,blocking,comments,updatedAt`.

Wayfinder uses labels `wayfinder:map`, `wayfinder:research`,
`wayfinder:prototype`, `wayfinder:grilling`, and `wayfinder:task`. Decision
tickets must not receive `ready-for-agent`; that label is reserved for separate,
fully specified implementation issues created after map completion.

### Authorization and concurrency

- Charting shows the full proposed map/label/ticket/dependency batch before one
  confirmation authorizes those displayed mutations.
- Working an explicitly named map authorizes claiming and resolving one eligible
  ticket, but not bulk operations, destination changes, or implementation work.
- Append-only versioned comments are claim authority; assignment is visual only.
  The earliest active claim wins, and claims do not expire automatically.
- Map-body writes use a separate append-only writer lock, an immediate body-hash
  recheck, merge rather than stale replacement, and post-write verification.
- Loading a skill or reading a map is never authorization for remote mutation.
