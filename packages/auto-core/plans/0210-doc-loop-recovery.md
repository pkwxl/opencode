# 0210 — The doc loop's recovery: the drain rule for throws, the flatten's ownership, the orphan's report and identity

Status: **active**. Ruled by 0166 step 050 (findings 0165-009, 0165-079, 0165-080,
0165-081; the evidence, reproductions and register rows in
[0165-review/S05-loop-task.md](./0165-review/S05-loop-task.md) S05-01…S05-04).

## Derivation and Category scope

Derives: **P20** (in-flight work is never destroyed — the showing: D1's drain
lands the siblings before the failure surfaces; D3's refusal keeps a
leftover's preserved half-work out of the sweeping stash; D5's identified
worker is still awaited, the cattle property intact), **P12** (fail loud,
conservative under uncertainty — D4's report read never lets a dead pid
override a written verdict; D5's unreadable lock counts as live), **P8**
(every new line teaches its remedy — the reset line, the mismatch line, the
still-waiting line, the refusal's serial re-run), **P6** (the in_progress
mark is runtime state about a live session; when both its witnesses — the
session and the progress record — are gone, D3 re-derives it to pending),
**P17** (declared concurrency bounded by disjoint scopes with wrong outcomes
surfacing loudly — D3's rollback refusal at dispatch holds the bound the
flatten already held), **P2** (D4: a finished FAIL verdict reaches the
person, never a silent re-run on the person's behalf). Amends: none at the
principle tier; 0068 D14 and 0099 D10 amended at the decision level (below).
Tier: mechanism.

### Category scope

- Code homes: `src/loop-task.ts` (D1 the race's rejection arm, D3 the
  flatten's mark reset + dispatch's sibling scopes + the degrade line),
  `src/opts.ts` (D2 `sessionOpts`' docLane control), `src/runner.ts` (D3 the
  rollbackRefused wording, one home), `src/tasks.ts` (D3
  `resetUnitInProgress`, beside `resetInProgress` — the mark writes' one
  home), `src/lanes.ts` (D4 `dispatchLane`'s stale-report removal), 
  `src/loop-preflight.ts` (D4/D5 `recoverOrphanLanes`' report-first read and
  identity-gated wait).
- Test homes: `test/agent-fake.test.ts` (D1's drain pin, D3's re-run pin),
  `test/lanes-scheduler.test.ts` (D4's report-first and stale-removal pins,
  D5's mismatch and await pins; the live-pid and 0156-D3 tests reshaped to
  the ruled procedure), `test/session-opts.test.ts` (D2's field pin).
- Documentation homes: AGENTS.md navigation line (the doc-lane recovery
  family), `docs/structure.md` rows (the loop-task/preflight/lanes
  responsibilities), `plans/INDEX.md` row + the 0068 D14 and 0099 D10
  annotations.

## Decisions

### D1 (0165-079) — the race over the doc pipelines gains a rejection arm: the drain rule for throws

`runDocLaneLoop`'s `Promise.race` over the in-flight pipelines resolves only
fulfilled arms; any throw out of one doc unit's pipeline (a driver fault on
the 0185 D1 channel, a `PromptGuaranteeError`, an unexpected exception)
rejected the race itself, exiting the loop mid-drain: the sibling pipelines
were abandoned in flight, the loop's `finally` restored the undecorated git
seam under them, and their partial work stayed uncommitted — the exact
abandonment 0068 §6.2's drain rule and 0143 D3/D4 reason about for the
worktree lane worker, reached through the doc loop's in-process pipelines
(0143's floor text named the worktree worker alone; the doc loop is the same
rule's other subject).

The race wraps every pipeline with a rejection-capturing arm
(`{lane, result} | {lane, error}`). An error arm: the lane leaves the
in-flight set, scheduling stops (no new dispatches), the first error is
recorded with a ⚠ line naming the unit, and the loop keeps draining — every
later fulfilled lane lands through the ordinary landing (the regression
boundary, the boundary hooks in probe form), later rejected lanes are
dropped the same way (the first error alone is kept), and when the in-flight
set empties the first error is rethrown — before the stop/`/exit`/degrade
handling, the failure dominating them. The rejected lane's scope stays
registry-live through the drain (its uncommitted writes are excluded from
the siblings' landing commits — preserved for the person, never swept, and
never committed by a sibling either). The error propagates through runAll's
driver-fault channel exactly as a serial run's throw would; the difference
is that the siblings' work has landed and is committed when it does.

Floor: no pipeline ever rejects — the wrapped race resolves identically, the
loop byte-identical.

### D2 (0165-079) — a doc-lane unit's session opts carry no control

`sessionOpts` threaded `ctx.control` into every session, the doc lanes'
included, and the four in-pipeline `/exit` probes (`opts.control?.maybeExit`
at `wrapup.ts`'s fix-handover and wrap-up-entry, `execute.ts`'s
whole-session and subtask handovers) would throw `ExitRequested` inside a
sibling-shared pipeline — pre-D1 the abandonment above, post-D1 a contained
but avoidable run stop. No `/exit` channel exists at width ≥ 2 (preflight
refuses `--interactive`/`--wait-answer`, 0068 D11; 0162 D2 attaches no
bridge to a wide run), and `opts.control`'s only consumers are those four
probes (the sleeps read the run's own services holder), so the field's value
is `undefined` for a doc-lane task site: `control: site.docLane === true ?
undefined : ctx.control` — the key stays set (the builder's no-omissions
rule), the value is the doc-lane exception. If a width ≥ 2 exit channel is
ever added, the pipeline still cannot throw; the exit surfaces at the
landing, in probe form, where the loop already defers it past the drain.
Every non-doc site keeps `ctx.control` byte-identically.

### D3 (0165-009) — the flatten owns every leftover; dispatch passes the live sibling scopes; the degrade names what it skipped

The dead-end: a doc-eligible in_progress leftover without an active progress
record (the ordinary width-2 kill — progress.json is one record, 0099 D8, so
one of two in-flight units always lacks it) kept its mark and its
registry-live scope but was never driven: `readyUnits` reads in_progress as
busy, so its "dispatch turn" (0099 D10's stated posture) never came, the
degrade found nothing eligible and every re-run ended at "fix the task index
manually" — a remedy that cannot help, the index never being the problem.
Worse, the protection 0099 D10 built held for exactly one run: the flatten
drove the recorded leftover, its rollback verdict was refused while the
sibling remained, the person re-ran as taught — and the main loop dispatched
the resumed unit with no `siblingScopes`, so its strict rollback ran
tree-wide, stashing the leftover's preserved half-work into a stash named
for the other task (S10-08's sweep reached through the documented recovery
path).

Three arms, 0099 D10's posture delivered:

1. **The flatten resets an unrecorded leftover's mark.** `resetUnitInProgress`
   (beside `resetInProgress` in `src/tasks.ts`, the mark writes' one home)
   clears the one unit's in_progress mark with the same transition event;
   a line teaches the posture (`↻ doc-lane recovery: <id> has no active
   progress record; its mark reset to pending …`). The unit's scope stays
   registry-live (the sibling set the gates and the rollback refusal read),
   and its dispatch turn now comes: pending, dependencies met, it dispatches
   through the ordinary `dispatch`, and the start gate judges its
   uncommitted work — `beginUnit` tolerates exactly the OTHER live scopes'
   dirt (D5's relaxation), so the unit's own half-work blocks for the human
   naming the files, the serial loop's own posture. A clean leftover (a kill
   before any write) simply runs.
2. **`dispatch` passes the live sibling scopes.** The other registry-live
   scopes at dispatch time ride into `runDocUnit` as `siblingScopes`, the
   flatten's drive already doing so: a resumed unit's rollback verdict meets
   the D10 refusal whenever sibling state is in the tree — the leftover's
   preserved half-work above all — never a tree-wide stash. The refusal's
   wording loses its false "the recovery flatten holds" clause (an in-flight
   lane is as much the holder); the load-bearing clause ("a rollback is
   tree-wide and would sweep it") and the remedy (commit or clean the
   sibling state, re-run serially) are unchanged.
3. **The degrade's dead-end line names what it skipped.** When the degrade
   finds nothing eligible while in_progress units exist in the plan, the
   stop names them and the true home (`a stale runtime mark in
   .auto/units.json — never a task-index problem; remove the mark and
   re-run`); with nothing skipped the line is byte-identical. Post-arm-1
   this arm is defensive: the flatten owns every doc leftover, non-doc and
   other-phase marks are reset at preflight, and no in_progress doc unit can
   reach the degrade.

Residual (0165-019's, step 077): the siblingScopes snapshot is taken at
dispatch — a lane dispatched before its sibling still reaches the tree-wide
rollback on a mid-run verdict, and the engine's deeper `rollbackRedo` path
(`execute.ts`) is unguarded; both belong to the rollback guard at
`rollbackUnitState`, ruled there.

### D4 (0165-080) — the recovery reads the report first; a re-dispatch removes the stale report

`recoverOrphanLanes` read the park's report only inside the live-pid arm, so
a dead pid over a written report — a worker that finished, wrote its
controlled-exit report and exited — was decided as the "crash / no report"
matrix row and re-dispatched: every recovery booked an attempt toward the
cap, a finished FAIL verdict was never shown, and the blocked unit was
re-attempted on the person's behalf. And since nothing ever removed a reused
worktree's `.auto/lane.json`, a re-dispatched worker that crashed again was
silently decided by the previous attempt's report — the 0156 D3 recovery
test passed only through that stale read (its default launcher re-ran the
test file itself, wrote no report, and the landing consumed the planted
one).

The report is read first, whatever the pid says: a written report is the
worker's controlled exit — 0068 D8's own letter ("absence … is the orphan
signal" names the report's absence) — and is landed or blocked on its
verdict; the pid never overrides it. `dispatchLane`'s reuse arm removes the
worktree's `.auto/lane.json` before the spawn, so every re-dispatch site
(the scheduler's orphan and conflict-repair arms, the isolation loop, the
recovery) — all funneling through the one dispatch home — can never read a
previous attempt's report as this attempt's verdict. The removal was chosen
over an attempt-number field on the report exactly to keep `LaneReport`'s
frozen shape (P13: no protocol change).

### D5 (0165-081) — the orphan wait identifies the worker and teaches its way out

The report-less wait keyed on a bare `pidAlive` probe with no bound and no
identity: a pid recycled after a reboot or container restart (or a record
whose scene arrived from another host) held every later run start forever,
one printed line and a hang, the only exit a hand edit the line never
mentioned. `pidAlive`'s own comment already concedes the limit ("a recorded
pid this host never had reads dead exactly like an exited worker" — true
only while nothing reuses the number); the run lock beside it checks host,
pid namespace and start time (0183 D4) — the one liveness identity this
codebase has.

The wait is entered only when the worktree's own live run lock identifies
the recorded pid: `liveRunLock(park)`'s holder must name the record's pid on
this host (an unreadable lock counts as live — conservative, P12, the same
reading `lockLines` makes). A live recorded pid the lock does not identify
gets one ⚠ line (a reused pid after a restart, or a scene from another
host) and is treated as crashed — the report decides, the re-dispatch loop
under the cap if none. An identified worker is awaited as before (the
cattle property), with a periodic (10 s) ℹ line naming the pid and the
manual way out (`remove its record in .auto/units.json and re-run`) — the
person is the terminal of every bounded wait (P20's tension clause). The
"interruptible by the run's control" remedy clause is declined: no `/exit`
channel exists at width ≥ 2 (0068 D11) to interrupt with; the wait's
terminals are the worker's exit, the notice line and Ctrl+C.

## Premise guard

premises this ruling changes:

- **0068 D14** — the orphan/re-dispatch matrix keyed the re-dispatch on the
  pid's death alone; restated: the report's presence is the controlled-exit
  signal (D8's own letter), the pid decides nothing over a written report,
  and the report-less wait is gated by the run lock's identity (D5). INDEX
  row annotated.
- **0099 D10** — "a leftover WITHOUT an active record keeps today's posture
  when its dispatch turn comes" presupposed a dispatch turn the busy mark
  never delivered; restated: the flatten owns the mark reset (the pending
  mark is what delivers the posture), and the dispatch-time sibling scopes
  hold the refusal D10 built beyond the flatten's own drive. INDEX row
  annotated.

Re-read, standing: 0068 D8 (the report contract — D4 enforces its letter);
0156 D1 (preflight's keep-set still feeds the flatten, which now owns the
unrecorded marks it finds); 0143 D3/D4 (the drain floor's text named the
worktree lane worker — D1 extends the same rule to the doc loop's
in-process pipelines, no premise invalidated).

## Residuals (named)

1. The dispatch-time `siblingScopes` snapshot covers siblings registered
   before the dispatch (the leftovers and earlier-dispatched lanes); a lane
   dispatched before its sibling still reaches the tree-wide rollback on a
   mid-run verdict, and the engine's `rollbackRedo` path is unguarded —
   both 0165-019's (step 077, the guard at `rollbackUnitState`).
2. The degrade's naming arm (D3.3) is defensive prose: post-flatten-ownership
   no in_progress doc unit reaches the degrade; the arm is pinned only as
   the byte-identical floor (nothing skipped → the unchanged line).
3. D4's final-exit window (lock released, report write in flight, pid alive,
   no report read) reads as unidentified → crashed → one re-dispatch over a
   just-finished worker; the attempts cap bounds it, the branch's committed
   work survives every re-dispatch (the kill-resume property), and the
   stale-report removal keeps the verdicts true — an re-run unit, never a
   loss.
4. D5's notice cadence (10 s) is implemented but unpinned — a pin would cost
   the suite a 10-second wait; the mismatch and await arms are pinned.
5. D2 has no behavioral `/exit`-during-a-doc-pipeline pin (no channel exists
   to drive one, 0068 D11); the field pin and D1's drain pin cover the
   mechanism jointly.

## Vocabulary (P13)

No frozen vocabulary changes: the run-status event stream, exit codes,
document grammars and protocol literals are untouched; the new lines are log
prose; `LaneReport`'s fields unchanged; the refusal line's load-bearing
clause preserved byte-identically ("a rollback is tree-wide and would sweep
it"). Floors byte-identical where no defect was ruled: the serial loop, the
worktree lane loop's own paths, the non-doc session sites, and every
doc-loop run in which no pipeline rejects and no unrecorded doc leftover
exists.
