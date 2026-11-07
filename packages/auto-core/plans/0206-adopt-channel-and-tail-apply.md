# 0206 — the adopt step's test handover joins the channel's gate, and the tail reshape's one apply is the advance's

Status: **active**. Ruled 2026-11-07 by 0166 step 046 (wave W8-planning), enacting 0165-094
(S07-04, S3, CONFIRMED — `plan --adopt` executes any `tmp/test.sh` with no channel gate:
`adoptUnit` is never handed `testByDriver` or the phase, so a standalone session's marker runs
as a driver process where the config turns the driver test channel off or the phase type is
not code work. The export's render **does** receive `testByDriver` (plan's `--export` caller
threads it, and the constitution preamble's TEST_PRINCIPLE renders under the same switch —
"the test handover the adopt step executes exists precisely under testByDriver", 0076 §2's own
premise), so the work order tells the session the channel is off while the adopt step serves
the same marker: the two halves of one route disagree on one request, and an agent-authored
script runs under the driver's process and environment — outside the agent host's own
permission posture, the external_directory deny the target ships — in exactly the
configurations where the project declared the driver runs none) and 0165-095 (S07-07, S3,
CONFIRMED — bare plan still owns the phase-tail reshape in phased mode: prelude row 3 re-syncs
the unstarted tail **uncommitted** and teaches "review, commit, then re-run: plan", whose
re-run lands on rows 6/7 and refuses naming transfer — two writers of one reshape (plan's
uncommitted sync, transfer's committed `rederiveTail`), and the uncommitted one leaves
`docs/R-01/phases.md` dirty for the advance's own preflight, which stops on the very file
transfer would have written and committed itself. The drift machinery is phased-only —
`phaseTailDrift` returns undefined in m mode — so every state the apply could run in was
already a state 0101 D4 had made transfer's; the test pinning the apply held the pre-0101
implementation, not the ruling).

This ruling Amends: **0053 D34** (the plan half of the drift row — its phased arm; see
Premises), **0076 §2** (the "testByDriver unchanged" premise the adopt step never enacted),
**0101 D6** (the mid-phase deferral — the advance's execute arm refused "without re-deriving";
see Premises) and **0142 D1** (the consumption scope — a new scope, the adopt step, joins the
execution scopes; the wording and mechanism unchanged). It Derives: **P5** (single ownership —
the marker's one gate is the derived condition `testByDriver && codeWork(phase)` with one
home `testChannelOffFor` in `src/testrun.ts`: every consumer of `tmp/test.sh` passes through
it, the adopt step included, no second ungated consumer; and the tail reshape has exactly one
applying writer, the advance's committed `rederiveTail` — plan's uncommitted sync was the
second writer, its teaching pointing at a re-run that refused toward the apply's true home),
**P2** (the person brackets every boundary — a session's test request is executed only inside
the channel the project declared; where the project declared none, the request is surfaced
and consumed, never silently run; and the reshape is applied on the driver's own committed
rewrite wherever the person's moved line meets the machinery, never left as an uncommitted
write the person must shepherd past a preflight), **P8** (every surfaced line teaches its
remedy — the adopt's ⚠ names why the channel will never serve the request; the drift
refusal names transfer as the apply, and run's stop names the same command, so no line
teaches a re-run that refuses) and **P20** (in-flight work is never destroyed — the mid-phase
run restart keeps its exit: the advance applies the tail on its own commit, then names run;
the pre-narrow reading stranded a mid-phase restart in a run↔transfer loop with no command
out). Tier touched: **mechanism only** — no principle change; the vocabulary changes are
conscious (the re-sync stop line and its three flag-refusal spellings retire for phased, the
refusal and the run-side stop line are new lines, P13's lockstep held by re-pinning every
retired literal's test in the same change).

### Category scope

- **Derives**: P5, P2, P8, P20 (statements unchanged; the showing clauses above).
- **Amends**: no principle. The plans-level amendments are 0053 D34's plan half (phased arm
  retired, m-mode arm kept), 0076 §2's premise (now enacted by the adopt's gate), 0101 D6's
  mid-phase deferral (the execute arm now re-derives before its refusal) and 0142 D1's scope
  (the adopt step joins the consumption scopes). Each is restated in the decisions below;
  their INDEX rows are annotated in this change.
- **Tier**: mechanism. Code homes `src/testrun.ts` (the consume split), `src/work-order.ts`
  (the gate), `src/plan.ts` (the threading and the row-3 refusal), `src/transfer.ts` (the
  mid-phase arm), `src/loop.ts` (the run-side teaching); test homes `test/work-order.test.ts`,
  `test/plan.test.ts`, `test/transfer.test.ts`; documentation homes `packages/auto/README.md`
  (the drift row), `AGENTS.md` (navigation lines), `docs/structure.md` (the Plan prelude and
  Standalone work orders rows).

## D1 — the adopt step's test handover gates through the channel's own condition (0165-094)

The derived condition of 0083 D9 — the config flag AND the phase type's `codeWork` — is the
one gate of every `tmp/test.sh` consumption; the adopt step now passes through it. The facts
arrive exactly as the export renders them: plan's `--adopt` caller threads `testByDriver` and
`phaseKey(route.phase)` into `adoptUnit` beside the watchdog options (the route already
resolved the phase; a phase-less call resolves onto implement, the no-phase convention
`runExecSession` itself uses). Under the gate's two dead worlds:

- the config flag off outright, or on over a phase whose type is not code work — a marker
  left on disk is **consumed and surfaced, never executed**: through the same
  `consumeDeadTestMarker` seam the run flows use (0142 D1), split for this ruling into
  `dropDeadTestMarker` (the consume plus its one ⚠ wording, returning the reason and the
  line) and the logging wrapper (byte-identical for the execution scopes); the adopt step
  carries the ⚠ line in its own outcome lines — the command's result output, not the run's
  log stream, is its canonical surface — so the line rides both the blocked arm (ahead of
  the ⏸ refusal) and the adopted arm, exactly where the executed handover's ⚙ report rides
  today;
- the channel serving (flag on, code-work phase) — the handover executes exactly as before,
  byte-identical (the P10 floor; the existing pins re-pinned under `testByDriver: true`).

The security letter this enacts is 0171 D1's own class transposed to the adopt route: a
session the agent host confines must not steer the driver's process into executing
agent-authored content outside that posture — least of all in the configurations where the
project declared the driver runs none and the work order itself taught the session the
channel is off. The consumption (not a bare refusal) is 0142 D1's rule: the request is
surfaced with its reason and consumed, so it can neither run nor linger as wiring for a
later session to misread.

## D2 — plan's row 3 refuses naming transfer; m mode keeps the D34 shape (0165-095)

In phased mode every drift the row can see refuses **before any write**, naming transfer as
the reshape's apply: `the phase index of round R-NN differs from <from>: transfer re-derives
the unstarted tail on its own commit — run: transfer` (the flag channels append their own
resumption after the same opening — "… (run: transfer), then pass the input / add the task
again / take the work order again." — one refusal family, four channels; the retired
spellings that taught "run plan without <flag> to re-sync it" die with the apply they
taught). The blocked arm is unchanged: a value the sync itself refuses (dropping a completed
phase, a directory that holds work) stops with `plannedPhaseUnits`'s own error exactly as
before — transfer's re-derivation meets the same guard, and the person hears it here first.

m mode keeps the D34 shape — the uncommitted re-sync, the review-and-commit stop — for a
reason the finding itself names: its tail is the single phase, `phaseTailDrift` never
reports one, so the arm is unreachable today; it is kept for that mode alone (m mode's
establishment still writes uncommitted round setups for the person's G1 review, the native
rhythm the D34 shape belongs to) rather than deleted as part of a phased ruling. The drift
refusals' D5 ladder (input before any write) keeps its meaning inside that arm.

## D3 — the advance applies the tail in its mid-phase arm too (0101 D6's deferral amended)

The remedy's sentence — "transfer re-derives it on its own commit" — must be true in every
state the refusal can name, and one state broke it: the advance's execute arm without an
awaiting formulation (mid-phase — pending tasks in flight), whose pinned shape since 0101
was "refuses without re-deriving". With plan no longer applying, that state stranded a
mid-phase run restart: run's drift stop names transfer, transfer refuses without applying
and names run, run stops again — a two-command loop with no exit except reverting the
person's own document edit (the moved roadmap line), while the drift sits in an unstarted
tail the in-flight phase never touches. The arm therefore **re-derives first**: the same
`rederiveTail` the construct paths open with, the person's moved line applied on the
advance's own `phase-sync` commit (started phases immutable by the sync's own guards,
untouched by this change), then the arm's own refusal — `nothing to advance … execute them
first: run` — and that run starts, the drift cleared. The P10 floor holds: with no drift
(a mid-phase transfer that always existed) the arm writes nothing and refuses
byte-identically. The person's reshape freedom is untouched — the document has no hold, and
each advance applies the line as it stands; nothing is consumed silently (the ✓ line and
the commit are the visible apply, P2).

## D4 — run's drift stop names the apply's home (0165-095)

`run` still never re-syncs (0053 Q4 stands — a silent re-sync would start work on a phase
list nobody reviewed); the stop's teaching follows the apply's one home: `run <bin>
transfer <dir> to re-derive its unstarted phases`. Mid-phase the named advance applies the
tail and points back at run (D3); at a boundary it applies and constructs. No line anywhere
teaches "run plan to re-sync" anymore — the phrase retired with the apply it named, its
pins re-pointed in the same change (P13's lockstep).

## Premises

premises this ruling changes: **0053 D34** (plan's re-sync — the phased half retired by D2;
the m-mode half and Q4's "run never re-syncs" stand; the row's INDEX entry annotated),
**0101 D6** (the mid-phase deferral — "the advance refuses without re-deriving" in its
execute arm, amended by D3; the committed-rewrite rule itself is D6's letter, now honored
by every apply; the round's INDEX entry annotated), **0076 §2** ("testByDriver unchanged"
— the premise the adopt step never enacted, now enacted by D1; the INDEX entry annotated),
**0142 D1** (the consumption scopes — the adopt step joins them additively; the mechanism,
wording and the fix-round block unchanged; the INDEX entry annotated). Re-read in this
change: 0053 D32/D34's guard comments in `src/config-op.ts` (the read-only prefix guard
still names a sync that exists — the advance's), 0101 D4's refusal rows (unchanged — this
ruling extends their letter to the drift state they missed), 0083 D9 (the derived condition
itself — untouched, one more consumer).

## Residuals

Named: none for D1 (the gate is total — the adopt was the only ungated consumer of the
marker; `grep` over the three packages confirms `runTestScript`'s callers are the run
channel, the handover front-load and the adopt, the first two already gated). For D2–D4:
the unreachable m-mode apply arm is kept by ruling (its retirement is a future m-mode
ruling's to make, not this phased one's); a person who moves the line mid-phase and never
runs transfer keeps a drifted tail — run's stop names the one command that applies it, and
no silent apply exists (the teaching alone guards, the same class as 0205's named
residuals).
