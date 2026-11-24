# 0310 — Retire the push task-append session

## Category scope

Push session removal under 0279 and 0296. Plan 0283 retired the explicit
append flag and directed callers to task-add and formulation. The legacy
phase loop still dispatched append sessions from implied inputs in manual
mode and open rounds, and from interrupted append records.

## Decision

Remove the dispatch, append collector and reset, and the embedded prompt.
Keep the shared existing-task list used by formulation. A planning input
that would have started an implied append now points to task-add. Keep
reading historical append records and leave their partial work and resume
record in place until a person reviews the work and archives the record.

The daemon regression adds a task after an existing entry in an open
round, executes and verifies it, then drives transfer, audit, independent
verification, and the final transfer. It checks that the first transfer
creates the audit unit and holds the close, the final transfer cites the
audit commit, and a fresh claim returns done.

Derives P8 for the recovery and task-add remedies, P10 for the existing
task and formulation paths, and P21 for the removal of the push session.
