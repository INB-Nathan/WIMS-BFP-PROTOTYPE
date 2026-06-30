# Task for scout

Investigate the Suricata IDS logging pipeline to the admin. Check: 1) Where does Suricata write its EVE JSON logs? 2) How does the backend ingest them — via file-tail (`tasks/suricata.py`) or Redis stream (`tasks/suricata_redis.py` or similar)? 3) Are the ingested alerts written to `wims.security_threat_logs`? 4) Does `GET /api/admin/security-logs` (in `admin/security.py`) query that table properly? 5) Check the admin frontend page at `src/frontend/src/app/admin/security/page.tsx` — does it display security logs from the API? 6) Are there any known gaps where Suricata alerts could be ingested but NOT visible in the admin UI or API? Search files, read configs, report findings.

---
Update progress at: .pi/sessions/subagent-artifacts/progress/ec4fea39/progress.md

## Acceptance Contract
Acceptance level: reviewed
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope
- criterion-2: Return evidence sufficient for an independent acceptance review

Required evidence: changed-files, tests-added, commands-run, validation-output, residual-risks, no-staged-files

Review gate: required by reviewer.

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