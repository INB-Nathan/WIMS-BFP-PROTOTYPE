# Task for scout

Investigate the Keycloak SPI event listener for logging authentication failures. Check: 1) Is the branch `feat/rp08-rp18-keycloak-event-spi` merged? 2) Does `src/keycloak/wims-audit-event-listener/` exist? 3) Is there a `POST /api/auth/keycloak-event` route in `src/backend/api/routes/security_events.py`? 4) Does the Keycloak realm config (`src/keycloak/import/bfp-realm.json`) have `eventsListeners` including `wims-audit`? 5) What gets logged when a bad-password login attempt happens at Keycloak — does it reach `wims.system_audit_trails`? Search actual files, do not guess. Report what IS working, what IS NOT working, and what the exact gap is.

---
Update progress at: .pi/sessions/subagent-artifacts/progress/ec4fea39/progress.md

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