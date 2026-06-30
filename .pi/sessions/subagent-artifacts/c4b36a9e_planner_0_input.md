# Task for planner

Create a detailed implementation plan based on the spec at /home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/docs/superpowers/specs/2026-06-29-pentest-logging-gap-fixes-design.md

The spec covers three requirements (R1–R3) for fixing the penetration test logging pipeline. R4 (dedup) is deferred. The scope is network-layer only (Suricata IDS + Keycloak auth events). Application-layer audit is out of scope.

Read the full spec, then produce an implementation plan that covers:
- Exact file changes with diffs
- Step-by-step execution order (what to apply first, second, third)
- VPS live commands to apply without full redeploy where possible
- Verification steps with exact SQL queries and docker commands
- Rollback commands

Write the plan to docs/superpowers/plans/2026-06-29-pentest-logging-gap-fixes-plan.md

---
**Output:**
Write your findings to exactly this path: /home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/plan.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

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