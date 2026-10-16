# 0098 — The regression lane: two-level pass

One design, ported from the dm-glm round's own practice (`/home/wxl/workspace/
root/dm-glm`, the device-mapper → Asterinas migration the 0096 lane vocabulary
came from) and ruled into the driver there:

- **Two-level pass.** A task's pass status splits into *preliminary pass*
  (its relevant unit tests green — today's wrap-up: the cheap lanes, the
  anchor, the verify session) and *complete pass* (the full regression the
  project's gate requires). Preliminary pass closes the task and releases its
  dependents; complete pass is a property of the *tree*, not of any task, and
  is kept green by the driver in the background.
- **The gate leaves the per-task critical path.** The full regression runs as
  the driver's own background process against committed snapshots; the phase
  never closes without a covering green receipt, and a red routes into the
  existing fix machinery with the offending units named.

## The evidence (why now)

dm-glm's R-01 measured it: `test/verify_full.sh` — four serial gates (kernel
build, an 868-summary-line guest regression boot, a 925-test / 34-section
ktest lane, `make check`) plus tooling sub-gates, median 12 min warm, p90 18,
max 36, strictly serial on one QEMU display — ran **~95 times, ~20.4 hours**,
almost entirely on the critical path of a serial task loop: every implement
batch paid 2–6 full runs (shake-out + anchor + bare-defaults re-run), every
test-phase coverage task paid two by protocol (the gate anchor plus the
idempotency hop). The round also proved the alternative works: the parked W1
wave (T-097/T-098/T-099, real `Auto-Stage: park` commits) ran its narrow
lanes, parked, and ONE remediation hop (T-100) landed all three tasks'
expected counts in a single freeze; each parked task then took its bare
anchor receipt against the remediated tree. Dependents proceeded on
preliminary evidence, complete pass landed at wave granularity, and nothing
about the evidence discipline weakened.

The two-level split is that practice made structural. What it is NOT: a
second task-status system. "Done" keeps its exact meaning (0083 wrap-up
green); complete pass lives in receipts and the driver's runtime record,
never in a task document — the "completion is never judged by agent
self-report" invariant holds (verdicts stay driver-parsed from log tails).

## D1 — The third cost class

The lane table's `Cost` gains a value: `cheap | anchor | regression`. A
regression-cost row is the project's full-gate suite — the one whose verdict
the phase's completion requires but whose duration forbids the per-task
critical path.

- `runTestLanes` (the wrap-up's set runner) filters regression rows out: the
  per-task lane set is cheap + anchor only, byte-identical to today's shape.
- `anchorLaneOf` skips regression rows in both its scans (the names the
  `## Acceptance` lists and the anchor-cost fallback): a regression row is
  never a task's anchor — anchoring is the per-task pre-gate, exactly what
  the class exists to leave behind. A task naming one simply has no
  mechanical anchor; its verify session judges receipts by inspection.
- Grammar is strict as ever: a `Cost:` line outside the three values throws
  naming the pack and suite (`testLanesProblem` at preflight).

## D2 — The receipt home

Background receipts are round-scoped, not task-scoped: one run vouches for a
tree many tasks built. They live at `docs/R-NN/regression/<seq>-<lane>.md`
(`regressionReceiptDoc` in docpaths.ts; the lane id keeps its filename-safe
grammar, the seq is per-round monotonic from a directory scan, the
`latestHandoffSeq` precedent), carry the same machine fields the task-family
receipts carry (`Lane:`/`Heads:`/`Start:`/`End:`/`Verdict:` — `parseLaneReceipt`
reads both unchanged), end with the eof terminator, and get their own document
role (`regression`, beside 0097's `coverage`): driver-written round-level
evidence, eof-scanned, never a session write target. Being under `docs/R-*`
keeps them P1-exempt process paths.

## D3 — Coverage (the complete-pass predicate)

A regression lane is **covered at the current tree** iff its newest green
receipt (by `End:`, searched round-scoped) has non-empty heads and the paths
changed since those heads (`rangeChangedFiles`, multi-root) miss the lane's
surfaces (`laneTouches`). This is 0096's carry-forward rule, moved from "may
this task's lane skip its run" to "is the tree's regression obligation
discharged" — the same diff discipline, read at phase scope. Unparsable,
headless or red receipts never cover (the fail-safe direction); a lane with
no green receipt at all is uncovered. The task-family carry search
(`docs/*/testhands/`) is unchanged and never sees round receipts — the two
homes do not collide.

## D4 — The background slot

One in-flight background run per driver process, launched at unit boundaries
(after a task's close-out in the serial loop, after a lane's landing in the
worktree loops — parent sites only; lane workers and the formulation step
never launch):

- **Conditions**: the switch (D8) on, not dryrun, `testByDriver && codeWork`
  (the lane gate's own derived condition — the regression lane is the same
  channel), the table declares regression rows, no run in flight, the tree
  clean, and the lane uncovered per D3. A dirty tree or a busy slot skips
  silently (the next boundary retries).
- **Isolation**: the run executes in a disposable copy of the tree —
  `cp -a --reflink=always` into `.auto/regression-copy/` — so it never
  contends with the next unit's session for the working tree (the copy also
  carries nested repositories and warm build directories a git worktree
  cannot materialize, dm-glm's exact shape). The copy is gated on a reflink
  probe (the 0096 D9 discipline: no reflink, no background copy — a full copy
  of an x-GB tree costs more than it saves); without reflink the lane degrades
  to close-time-only (D5's in-tree run, serialized where the driver owns the
  tree exclusively) and the boundary logs the degrade once.
- **Execution**: the table row's command, cwd the copy, log under
  `/tmp/opencode/` with the `LANE_RC=$?` terminator, the runScript
  idle-progress watchdog (idleMs/maxMs from the run's opts). No stash guard —
  the copy is disposable; the receipt records the MAIN tree's HEADs at
  launch (the pinned state the copy materialized; the tree was clean, so
  copy state = committed state).
- **Completion**: verdict from the log tail (`readLaneVerdict`), receipt
  written through the shared `writeLaneReceipt` (the D2 path), the runtime
  record cleared, the copy removed, the verdict logged. The receipt file
  appears in the main tree possibly mid-session and rides the next unified
  commit (the 0096 discipline); at the following boundary the driver commits
  any still-uncommitted receipts as their own `Auto-Stage: regression`
  commit — the tree must be clean for the next unit's start gate, and a
  receipt is the only file that can legitimately appear between a close-out
  and a beginUnit.
- **Runtime record**: `.auto/regression.json` holds the in-flight marker
  (lane, seq, heads, log, started) for crash detection; the newest-receipt
  facts are always re-derived from the committed receipts on disk (receipts
  are the truth, the record is the liveness pointer). Preflight orphans a
  stale marker (the previous process died mid-run): the copy is removed, the
  marker cleared, a loud line names the discarded run — no receipt landed,
  the lane re-runs at the next boundary (fail-safe: uncovered).

## D5 — The phase-close hold

`handoverPhase`, after the distillation and beside the round-report
self-heal, before the completion gates: `ensureRegressionGreen`. For every
regression lane, under the same D4 conditions (switch, `testByDriver &&
codeWork`, table):

1. Covered (D3) → proceed.
2. A run in flight → await it, re-check.
3. Uncovered, none in flight → **run it now in the main tree** — the tree is
   exclusively the driver's between the distillation commit and the
   completion rename; the stash guard applies as in the lane gate. This is
   the close-time serialization, the one place the full gate still blocks:
   the dm-glm "final regression verification" task (T-121) as a driver
   invariant instead of planned work.
4. Red → **the remediation wave**: under a `--repair` budget the hold
   appends repair tasks over the gate evidence (the 0079 §4 held-verdict
   shape — the append input names the receipt, the bounded evidence and the
   D6 suspects; the loop re-derives the execute route, the tasks run, the
   phase distills again and the hold re-checks). Without budget, a gate stop
   (exit 2) naming the receipt, the suspects and the person's ways — the
   `logGateStop` posture. A covering green receipt is the only way through;
   the phase never closes on red or on a stale lane.

## D6 — Attribution

A red (or the repair input) names its suspects mechanically: the paths
changed since the lane's last green receipt (or since the round's first
commit when none exists) intersected with the lane's surfaces give the
failing surface set; the round's tasks whose own commits (`taskChangedPaths`,
the `Auto-Task:` trailer scan) intersect that set are the named units. The
dm-glm freeze-chain composition notes, made mechanical — and deliberately
advisory for the person's rework, never a gate: attribution steers, the
receipt decides.

## D7 — Strict test-readiness (the per-edge form, pack-declared)

The dm-glm analysis ruled the wave/phase-scoped form (D5) the standard; the
strict per-edge form — *a dependent's testing waits until its depended-on
tasks achieved complete pass* — is a declared option: `Strict: yes` on a
regression row (grammar: regression rows only, `testLanesProblem` enforces).
When declared, the wrap-up's lane gate, before the unit's own lanes run,
checks each of the task's effective dependencies (`Depends:` ids, the
implicit previous-in-index task, cross-phase ids resolved against the done
set): a dependency is complete iff the newest green receipt's
heads..HEAD diff misses both the lane's surfaces and the dependency's own
changed paths — the dependency's committed state is exactly what a green
run vouched for. An incomplete dependency waits (in-flight run awaited,
else one launched in-tree under the guard — the wrap-up moment is a
driver-exclusive window like D5's) and re-checks; a red rides the anchor-red
path: the gate returns red with the receipt's evidence and the D6 suspects
named as gaps, and the 0083 fix loop owns it. The cost is the trade the
declaration makes: strict mode re-introduces a blocking regression wait at
each dependent's wrap-up when anything it depends on moved — the pack
declares it precisely where building on unregressed ground is more
expensive than the wait.

## D8 — The switch

`OPENCODE_AUTO_REGRESSION`, default on. Off removes the machinery never the
grammar: no background launches, no hold, no strict wait — the declared
regression rows then simply run nowhere (the pack author who wants the gate
does not flip the switch; the switch is the operator's emergency stop). The
0080 kill-switch convention: experiment-layer, env-only, never persisted.

## D9 — Templates

The `test-lanes` partial gains one clause: a regression-cost row is
driver-owned — sessions never run it, never write its receipts (they live
round-scoped under `docs/R-NN/regression/`), and a task's anchor is never
one. The wrap-up charter is unchanged: the verify session judges the
task-family receipts; the regression receipt is driver-gated evidence the
driver itself consumes at D5/D7.

## D10 — Non-goals (recorded so they stop re-surfacing)

- No new task status, no new document the sessions write, no change to the
  wrap-up verdict protocol — complete pass is tree state in receipts.
- No stats booking of lane wall time (0096 books none for its lanes either;
  the log lines carry the timings, dm-glm's own "timings are recorded
  evidence, never gates").
- No cross-process physical exclusivity lock: the copy isolation removes
  tree contention with sessions; physical contention (dm-glm's one QEMU
  display) remains the `Exclusive: yes` discipline's, and the driver's own
  runs never overlap each other in-process (D5/D7 runs are sequential with
  the lane gate by construction, the background slot is single).
- The manual prompt suite (`prompts/`) mirrors nothing yet — the driver
  mechanism lands first, the suite can adopt the two-level vocabulary when
  a person-driven round needs it.
- No `status` tree surfacing of the in-flight run in v1 (the marker file and
  the log lines are the observability).

## Floor

A pack without regression-cost rows is byte-identical to today: the
`runTestLanes` filter is a no-op, no boundary launches, no hold, no strict
wait, no new files anywhere. Projects without time-consuming full tests
declare none of this and pay nothing — the declaration IS the opt-in, the
0080 optionality precedent.

## Staging

- **Stage A** — the vocabulary: the cost value, the parser, the anchor
  exclusion, the set filter (`test/lane-table.test.ts`).
- **Stage B** — the receipt home: docpaths, the role, the coverage predicate
  (`test/regression.test.ts`).
- **Stage C** — the background slot: the runner (copy, watchdog, verdict),
  the runtime record, the boundary hook, orphan recovery, the switch.
- **Stage D** — the hold: `ensureRegressionGreen`, attribution, the repair
  composition.
- **Stage E** — the strict form: the `Strict:` field, the lane-gate wait,
  the partial's clause, the prompt tests.
