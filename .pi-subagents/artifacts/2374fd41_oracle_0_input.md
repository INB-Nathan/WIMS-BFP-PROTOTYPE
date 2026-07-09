# Task for oracle

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
Review key decisions 1 and 2 from the issue #517 implementation (PR #540):

**Key decision 1: Vendor minimal files, not submodule/full repo**
The handoff chose to vendor only the minimal required upstream generated files under `src/nginx/bot-blocker/` instead of using a git submodule (rejected: ~629 MB upstream repo) or build-time download (rejected: less deterministic, GitHub rate limits). Check that:
- The vendored files are complete enough for nginx to start (no missing includes)
- Upstream MIT license is properly attributed (LICENSE file present, README credits)
- The review checklist from handoff section 9 (nobody UA vs bad UA) was run or is gated
- The false-positive workflow in README.md is actionable

**Key decision 2: Use upstream-correct include scopes**
`globalblacklist.conf` goes in `http {}` scope; `blockbots.conf`/`ddos.conf` go in each app-serving `server {}` block (not http). Check that:
- The HTTP redirect-only server block (301 return) is properly exempt from server-scope includes
- All three nginx configs (nginx.conf, nginx.local.conf, nginx.ci.conf) consistently apply the pattern
- The 10 contract tests in test_nginx_bot_blocker.py actually verify this scope distinction
- Zone collision is handled correctly (wims-botblocker-settings.conf defines `flood`, refrains from redefining WIMS `addr`)

Read the relevant files to verify. Focus on correctness and consistency — does the implementation honor the decisions made in the handoff?

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return a concise result and residual risks when applicable

Required evidence: manual-notes, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```