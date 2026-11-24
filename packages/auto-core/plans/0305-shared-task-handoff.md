# 0305 — Shared task handoff decisions

## Category scope

Tier: push session removal. This is a preparatory change under 0296 and
0256 Program S. The executor uses the dependency-park check, the resumed
task's release note and the continuation bound. Those imports entered
`execute.ts`, which also contains the push session and subtask dispatch.

## Decision

Move the shared park check, release note and continuation limits to
`src/task-handoff.ts`. The pull executor, push execution and wrap-up use
the same definitions. Keep the existing `execute` subpath exports for
callers and preserve the park verdicts and release-note content.

The overlap check still comes from `lanes.ts`, and the legacy transfer
entry still imports `loop.ts`. Those are separate dependency boundaries to
account for before removing the remaining push subtask machinery.

Derives: P10 (park settlement and continuation limits keep their behavior)
and P21 (move the code shared by existing callers before removing its old
module's push responsibilities).
