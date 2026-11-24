# 0309 — Retire the push lane worker entry

## Category scope

Push session removal under 0296 and 0256 Program S. The legacy worker entry
ran either a whole task or a subtask stream through the push loop. The shell
commands that launched it retired in 0283. The only remaining import was a
CLI test fixture with no callers.

## Decision

Remove the core entry and the unused fixture. The legacy runner still calls
the decompose and subtask sessions directly. Retain the lane report builder
used by the stream recovery regression, which checks that the report uses
the owning task's phase. The shell contract follows the existing executor
lease surface for concurrent work.

## Verification

The standalone daemon replayed 0304 on a fresh repository with the same
fixture. Both settlement recovery paths completed over HTTP. The run handled
six grant kinds, verified the repair against all 108 inputs, closed the
round with a clean tree, and answered `done` on the final claim.

Derives: P10 (preserve lane report recovery coverage) and P21 (remove the
callerless entry after checking its consumers).
