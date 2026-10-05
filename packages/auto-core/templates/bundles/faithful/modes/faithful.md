# faithful

## init

Faithful reimplementation on the builtin analysis/design/implement/test/acceptance flow:
the reference implementation is the primary input, and parity with its observed behavior —
behavior and the structure that carries it — is the bar. The brief names where the reference
implementation lives; read it there, distill the behavior baseline in the analysis phase,
and plan every later phase toward parity: design maps onto the reference's structure,
implementation reproduces behavior with the structure that carries it, testing proves named
behaviors against the baseline, and the acceptance verdict judges parity. Plan against the
reference, the behavior baseline, the brief and the planning input only.

## exec

Faithful parity rule: the reference implementation is the primary input, not a forbidden
one — read it, follow it, and preserve its observable behavior and the structure that
carries it. Every deliberate divergence from the reference is a deviation: recorded in the
task documents, naming what diverges and why; an unrecorded divergence is a defect. Parity
is the bar: work that alters observable behavior away from the reference's baseline is out
of scope unless the task names it. Where the reference is ambiguous, follow its observed
behavior over any reading of its words, and record the reading relied on.
