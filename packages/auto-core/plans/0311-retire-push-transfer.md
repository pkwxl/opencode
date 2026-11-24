# 0311 — Retire push transfer

## Category scope

Push session removal under 0279 and 0296. Plan 0307 separated the
daemon's deterministic transfer from the legacy advance that loaded
`runAll`. The remaining callers of the legacy entry were tests.

## Decision

Remove `runTransfer` and use `transferDeterministic` for every transfer
continuation. The person still applies each boundary under the transfer
lock. Executors produce handovers through the distill grant, and the
next phase's formulation floor lands for review through transfer.

The migrated regressions cover the survey release and brief install, the
wall seal before the phase transition, and phased and open round close.
The transfer boundary test claims and reports a distill grant, then
checks that transfer commits the phase transition and exposes formulate.
The loop's own construction and dispatch regressions continue to exercise
that loop directly.

Derives P10 for the retained boundary and commit coverage and P21 for
removing the legacy session path after migrating its callers.
