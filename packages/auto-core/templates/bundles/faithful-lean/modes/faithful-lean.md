# faithful-lean

## init

Lean reimplementation on the builtin analysis/design/implement/test/acceptance flow:
external behavior is preserved exactly as the reference exhibits it, internal design is
free, and legacy debt is shed deliberately. The brief names where the reference
implementation lives; read it there for the behavior it exhibits, distill the behavior
baseline in the analysis phase — with each area's legacy debt named beside it — and plan
every later phase toward the lean posture: design pins external contracts and redesigns the
internals under them, implementation keeps external behavior exact while rebuilding
internals and shedding debt, testing proves named behaviors against the baseline, and the
acceptance verdict judges external parity plus the debt-removal accounting. Plan against
the reference's behavior, the baseline, the brief and the planning input only.

## exec

Lean boundary: external behavior is preserved exactly — public interfaces, observable
effects, state and error semantics match the reference's behavior baseline — while internal
design is free: rebuild, rename, restructure. Shed legacy debt deliberately and justify
each removal in the task documents; never preserve internals for their own sake, and never
let an internal cleanup shift observable behavior. Where the reference's internals are
carried over because they carry behavior, say so; where they are dropped, say why.
