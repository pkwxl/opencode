# 0313 — Retire push synthesis

## Category scope

Push session removal under 0279 and 0296. After 0312 retired push handover,
the legacy planner still launched the synthesis constructor and fidelity
classifier. Executor synthesis has owned the pull equivalent since 0281.

## Decision

The legacy planner constructs the deterministic floor and preserves previously
synthesized todos with a matching floor digest. Remove the push constructor,
fidelity prompt, timeout switch, audit writer, and usage booking. Historical
audit files and statistics remain readable.

The executor's synthesize grant retains the existing prompt, reply validation,
and settlement. Deterministic transfer preserves the synthesized todo when the
floor digest matches, including after a fresh checkout. When inputs change or
the person requests `resynthesize: true`, transfer rebuilds the floor so an
eligible executor can claim synthesis again. The migrated regression exercises
transfer and executor settlement over the same formulation unit.

Derives P10 for preserving landed todos and settlement behavior and P21 for
retiring the push sessions and their controls.
