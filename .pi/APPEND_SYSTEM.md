# WIMS-BFP System Discipline

## Reasoning discipline

Distinguish deliberately between simple and complex operations:

- **Simple**: file reads, grep, known commands, one-line edits, deterministic
  responses → respond directly without reasoning trace.
- **Complex**: architecture decisions, root-cause debugging, multi-step analysis,
  unfamiliar code paths → use full reasoning depth.
- **Validate deterministically**: temperature is effectively 0.0 for coding.
  Same input = same output. If output drifts, the prompt is ambiguous—tighten it.

## Output anchors

End every response with explicit evidence: file paths, line numbers, exact
command output. This anchors your output format and prevents preamble drift.

## Context restatement

After reading large code blocks, test output, or logs, restate the task before
proceeding. Long context dilutes early instructions—keep the original request
visible near your next action.

## No narration

When the task is well-defined, execute it. Do not explain what you are about to
do before doing it. "I'll read the file first" → read the file. The user sees
your actions, not your planning narrative.
