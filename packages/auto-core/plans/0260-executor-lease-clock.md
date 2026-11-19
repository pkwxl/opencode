# 0260 — The executor lease clock configured

Discharges [0257](0257-executor-preview-findings.md) finding 03 (the lease
clock hardcoded where its own ruling says configured) and with it **0246 §C's
deferral and D4 l's open values** — the lease slice this change is. Derives
P16 (the clock's letter: "configured, never hardcoded per project" — the
project declares the budget on its own surface, the code carries only the
default and the grammar's relations; no project's number enters source), P10
(absent the key every emitted value is byte-identical to the pre-key clock —
budget 60, window 65 minutes, hard cap 130, proven by test), P13 (no wire
act: `grant.budget` and `grant.deadline` keep their frozen names and shapes,
only the value's source changes; the config key is additive, no step kind,
blocked reason or switch touched), P5 (one declared value, one derivation —
window and cap are computed from the grant's own budget at both clock sites,
never a second persisted clock), P6 (derived state only: nothing new
persists, the entry's existing `issued`/`grant` carry everything renewal
needs), P12 (an invalid declaration fails the strict load and surfaces
through the claim path's standing `blocked config` step, the error naming
the key and its range), P19 and P21 (the adoption site's measured arcs —
~45 min runway against a 65-minute wall — are the consumer that locks this
shape now; the shape is the simplest the consumer needs, independent window
and cap knobs declined with reasons below), and P20 (a lease keeps the clock
it was issued under — a config edit lands at the next grant's issuance
boundary, never under a live lease). Amends none — 0246 §C deferred the
values to "the lease slice", D4 l left them "ruled at the lease slice": this
ruling completes that design by naming the configuration home and the
grammar, it contradicts no letter.

## Category scope

Tier: mechanism (code homes `src/config.ts` + `src/executor-coordinator.ts`,
test homes beside them).

Premises this ruling changes: none — no standing letter rested on the
constants; 65/130 appear nowhere in the corpus. Re-read in this change:
**0246 §C and D4 l** (stand — the deferral discharged exactly as worded:
the window, the refresh and the hard cap now configured; the lease grammar
unchanged, its values ruled here), **0246 D4 c** (stands — the budget stays
advisory, "the work is judged on disk regardless", its default figure 60
now the named absent-key default), **0248 D8** (stands — its
"configured at slice 2" letter governs the *attach idle window*, a
different clock nothing hardcodes today; cited by the finding as family
reinforcement only), **0249 D2** (stands — "the server computes each
renewal from the current time and configured lease duration": this ruling
names that duration's home), **0253/0254** (stand — silent on clock values,
unchanged). `MAX_ATTEMPTS` and `MAX_RESPONSE_BYTES` are unruled by §C's
letter, not findings, and stay untouched.

## The ruling

**The configuration home: a target-declared config key.**
`.opencode/auto/config.json` grows `executorLease` — the hand-edited
optional-key pattern of `acceptanceGate`/`build`/`lanes` (no init flag, no
`amend` spelling, no hint-table row, no banner line): the target declares,
the code carries only the default. The rejected homes, for the record: a
wire field would make the worker its own clock authority against 0246 D5's
"the coordinator is the admission authority behind every lease grant"; a
per-claim parameter would make the lease contract negotiable per claim.
P16's letter is exactly this shape.

**The grammar.** `executorLease` is an integer in **1..1440** — minutes of
advisory wall-clock budget every grant kind carries (the wire `budget`
field's value); the ceiling is the idle keys' day (`idleMax`), the floor any
positive integer (the relations stay coherent at every value). Strictly
validated at load (`executorLeaseOf`), so a hand edit hears the same refusal
a future init flag would give, the error naming the key and range. Absent =
undefined = the default **60** (0246 D4 c's figure, inherited from 0117) —
and the clock byte-identical (P10).

**The relations stay derived.** The lease window is the budget **+ 5
minutes of grace**; the hard age cap is **twice the window** — exactly
today's 65/130 at the default, and the grammar 0246 D4 l words ("deadline =
issued + budget + grace, refresh window, hard cap multiple") — relations of
the one budget, never independently declared knobs. Reasons: independent
values would admit incoherent combinations (a window shorter than the
budget it must cover, a cap under the window) demanding cross-field
validation with no consumer asking (P21 — the adoption site's measured
arcs need longer budgets, not different relations, P19); and 0249 D2's own
letter says "configured lease duration", singular. One declared value tunes
the whole clock.

**The two clock sites.** Grant issuance reads the declared budget once
(`loadProjectConfig` at the claim, the absent key falling to the default;
select's admission arm has already proved the config loads, so a throw
there is a hand edit landing mid-claim and fails loud). Heartbeat renewal
derives window and cap **from the grant's own budget** — not from a fresh
config read — so a lease keeps the clock it was issued under across a
mid-lease edit: clock changes land at the issuance boundary, the next grant
carrying the new value (P20). No new wire field, no new entry state (P5,
P6); the frozen `budget` carriage is now read by its own issuer, still
advisory.

**Surfacing.** An invalid value fails `loadProjectConfig`, which the claim
path already renders as its standing `blocked config` step
(`readExecutorSnapshot`), the detail naming the key and the accepted range
(P12) — verified at the claim, ahead of readiness and dirt (0249 D4's
precedence, config first).

Untouched: experiment switches (`src/switches.ts` — run-scoped experiments
are never a per-project clock home, P13's letter), the frozen wire
vocabulary, `MAX_ATTEMPTS`/`MAX_RESPONSE_BYTES`, and 0248 D8's attach idle
window (a later slice's value, nothing hardcodes it today).

## Tests

`test/config.test.ts` — the key's validation: absent loads as undefined;
1/60/1440 read back; 0, negative, 1441, fractional, string and null values
fail the load naming the key and range. `test/executor-steps.test.ts` —
the clock itself, driven through `options.now`: the absent-key floor pins
today's exact values (budget 60, deadline = issue + 65 minutes, renewal
+65, cap at issue + 130, expiry past it — every emitted number
byte-identical, P10); a 240-minute declaration carries on the grant
(`budget` 240, deadline = issue + 245 minutes, renewal +245, cap at issue +
490); an invalid value answers the claim with the `blocked config` step
naming the key. Form checks: `bun typecheck` exit 0; the executor suites,
`test/blockage-executor.test.ts`, the config suites, the four reconciliation
suites and the manual-prompts ratchet green (no pinned coordinator string
moved — the heartbeat's pinned holder/live lines untouched).
