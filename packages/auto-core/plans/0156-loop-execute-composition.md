# 0156 — the loop/execute composition boundaries: the designed protections two halves built and no path composed

The 2026-10-30 three-package review of the auto tool family walked the loop and execution layers
the way 0155 walked the git layer: mechanism by mechanism, but asking a different question — not
"does each half fail in the right direction" (that is each half's own design) rather **"does the
composed path ever reach the mechanism"**. Eight findings say no for eight protections the corpus
believes in: a recovery flatten whose input another component erases first, a precedence read gated
off in the default configuration, an orphan recovery that can never land one class of lane, a
re-verification loop that verifies stale text, a verdict that names the wrong document, a landing
that destroys records before persisting them, a kill with no bounded escalation, and a consumed
marker whose consuming site the composing path skips. Every one of them was verified against HEAD
374129a14 before the change; every fix lands beside the composition test that drives both halves.

## The measurement (the review's file:line evidence; each finding names both sides' mechanisms)

- **D1 — the doc-lane recovery flatten (plans/0099 D10) is unreachable in production.** One half:
  `resetInProgress` (`src/tasks.ts:688`) resets *every* `in_progress` mark to pending at run start
  ("the loop resumes them through next() either way, attempts survive"), and preflight calls it
  unconditionally (`src/loop-preflight.ts:670`) — strictly before the phase loop is entered. The
  other half: the doc loop's recovery flatten filters
  `flattenPlan.tasks.filter((unit) => unit.status === "in_progress" && docEligible(unit))` at
  doc-loop entry (`src/loop-task.ts:1296`), so a cross-run leftover — the killed-run scene the
  flatten exists for — arrives already reset to pending; within one process no unit is
  `in_progress` at doc-loop entry either (drained loops; `setParked` deletes the mark). The flatten
  block is therefore dead code on the composed path, silently disarming two designed protections:
  the **rollback-refusal rule** (`siblingScopes` passed only by the flatten, `src/loop-task.ts:1320`
  — without it a killed leftover resumes through the normal scheduler and a strict-resume rollback
  verdict runs `rollbackUnitState` tree-wide, `stash push -u` of everything,
  `src/unit-commit.ts:168`, sweeping record-less sibling leftovers' uncommitted half-work into the
  rolling unit's stash) and the **gate-relaxation registry** (record-less leftovers' dirty scopes
  never registered in `registry.live`, so fresh disjointly-scoped doc dispatches block exit 2 on
  dirt the design meant siblings to tolerate). The existing tests (`test/agent-fake.test.ts` "the
  recovery flatten with siblings" / "the recovery flatten alone") manufacture the scene by writing
  `units.json` by hand and calling the doc loop directly — bypassing preflight; no test drove
  preflight → doc loop end-to-end.
- **D2 — the handover-precedence recovery read is gated off in the default mode.** One half:
  plans/0130 D1 ruled the context-handover protocol stands for *every* whole-task session,
  mode `off` included (steer on by default). The other half: runner's read
  `mode !== "off" ? await Bun.file(...).text() : undefined` (`src/runner.ts:310`) gates on the
  decompose mode, while `executeWhole` reads the document unconditionally and gates only the
  *status parse* on the steer ("the recovery `prior` read follows the steer instead of the mode",
  `src/execute.ts:428`–439). Consequence: default config (mode off + steer on), a task interrupted
  after its session wrote `docs/T-NNN/handoff.md` (`Status: continue`) computes `handedOff = false`,
  the shared recovery ladder may answer reuse — the continuation dispatch goes into the old,
  context-spent session, exactly what execute.ts rules out ("reusing the old session would only hit
  the cap again at once"); the strict-resume `handoffInvalid` rung is dead in mode off for the same
  reason. The coverage gap: `test/resume-gate.test.ts:267` passes `handedOff` directly; runner's own
  computation was untested under any mode.
- **D3 — orphan recovery can never land a stream lane.** One half: `laneReportOf`
  (`src/loop.ts:458`) derives the report's phase from `taskStatePaths(unit)` → for a stream unit
  `T-001.S01` that resolves to `docs/T-001.S01/{todo,done}.md`, a path that never exists (stream
  state lives at `docs/T-001/S01/`), so the report carries `phase: ""` — a stream's own state files
  carry no `Phase:` field at all (`renderSplitTodo`, `src/split.ts:170`, writes only
  `Depends:`/`Touches:`; the phase grammar belongs to the task document). The other half: preflight's
  `landRecovered` (`src/loop-preflight.ts:917`) resolves the report's phase against the phase index
  and blocks exit 2 ("names phase (none), which the phase index does not hold") — even when the
  recovered worker finished and its report says PASS. Plans/0068 D14's cattle property breaks at
  the landing step; `src/loop-task.ts:1601` already shows the stream-aware branch for the
  completion check.
- **D4 — the compose-and-verify remediate loop re-composes from stale sources.** One half: the
  design contract — "remediate" = the interactive fast path executed an approved option inline,
  "the caller re-composes and re-verifies **from scratch**" (plans/0082 §5 D7, restated at
  `src/loop-plan.ts:96`). The other half: `planPhase` captures its sources ONCE before the loop
  (`input` ~:249, `brief` ~:250, `parts` ~:260; `appendPlan` the same at ~:962/:990) — but the
  remediation executor CAN rewrite exactly them: the planning-input channel through `savePlanInput`
  (`src/blockage-execute.ts:129`–148) and the brief through its protect-passing write
  (`editableSurfaceProblem` allows `BRIEF_FILE`, ~:217). Misbehavior: `plan --interactive`,
  formulation judged INCONSISTENT, the person's approved option rewrites plan-input.md, the second
  pass verifies the OLD text, re-blocks, "the step re-blocked after two inline remediations"
  (~:546) — the person's executed Choice wasted.
- **D5 — handoverVerdict names the wrong handover file for lane-stream scopes.** One half:
  `handoverVerdict`'s `const file = handoffFile(task)` (`src/execute.ts:157`) ignores the stream,
  while the same function's callers judge the per-stream document for a lane stream —
  `streamHandoff = laneStream ? subtaskDoc(task.id, index, "handoff") : handoffFile(task)`
  (`src/execute.ts:925`) and the steer teaches that same file (`src/testrun.ts:60`). The other
  half: the verdict's own surfaces — the retry feedback ("no valid `${file}` was written … write
  that file for this subtask", ~:219), the "handed over as" log (~:167), the blocked message
  (~:206), the resume logs (~:952/:955) — all named the task-level path, so an obedient session
  wrote the wrong file, the re-check (`readHandoff`) still read the per-stream file, the single
  retry burned, and the unit blocked as hidden blockage pointing at the wrong document. Serial
  in-lane streams are consistent (task-level everywhere) — only `laneStream = true` is affected;
  `test/execute-handover.test.ts` pinned only the serial shape.
- **D6 — landLane's landing-sync failure destroys the worktree before persisting split/parked.**
  One half: after `syncIndexTicks`/`syncChecklistTicks`, the landing-sync commit; on `!settled.ok`
  the branch runs `clearLane` → `book()` → `teardownLane` and returns blocked (`src/lanes.ts:1150`–
  1158) — BEFORE the `report.split`/`report.parked` re-persistence at ~:1170. The other half: the
  worktree's `.auto/units.json` was those records' only other home ("the worktree's `.auto/` dies at
  teardown, the report is what survives" — the module's own doc). A lead whose split landed but
  whose tick-sync commit failed loses `Task.split` — the re-run (`streamUnits` gates on
  `task.split === undefined`) degrades streams to serial; a landed parked unit loses its parked
  record and can be re-dispatched, re-running committed work.
- **D7 — the watchdog kill has no escalation.** `watchProcess` (`src/script.ts:138`, shared by
  runScript and the regression lane) and the batch copy (~:376): once `timedOut` fires, one
  `proc.kill()` (SIGTERM), `if (timedOut) return` prevents re-kill, then `await proc.exited`
  forever if the child traps/ignores SIGTERM — the wrapper `exec`s the script, so the child IS the
  script (e.g. `trap '' TERM; sleep 1h`). No SIGKILL escalation, no bounded wait: the run hangs
  until double-Ctrl+C. P20's "every automatic escalation is bounded and terminates at the person"
  reads both ways — the person is the terminator of last resort, but the tool's own escalation
  ladder must be bounded before it reaches them.
- **D8 — a dead test marker left by a verify session on the PASS path is not consumed at that
  scope's close.** One half: plans/0142's consumption sites — the execution/subtask session close
  (`src/exec-session.ts:83`), the fix-round close (`src/wrapup.ts:376`), the wrap-up *entry*
  (~:596). The other half: the verify session itself runs through plain `runSession`
  (`src/wrapup.ts:195`) with no consumption, and the PASS return (~:233) never checks. Reachability
  is thin (the wrap-up template forbids re-running checks) but the T-058 family (a gap list / task
  document naming `tmp/test.sh`) is exactly what a verify session reads; when it happens the marker
  lingers until the NEXT task's wrap-up entry, whose log misattributes it to that task's id.

## D1 — the ruling: the reset spares what the flatten reads

`resetInProgress(dir, except?)` — ids in the keep-set are left `in_progress` and emit no transition
event (the flatten's input, not a stale mark; the no-keep-set call shape is byte-identical for every
other caller — resetInProgress has exactly this one). The preflight caller computes the keep-set as
**the current phase's doc-eligible `in_progress` unit ids** (`readPhases` + `currentPhase` +
`loadPlan` + `docEligible`), and only when this run dispatches the doc scheduler — the branch's own
predicate (`docLanes` switch on, isolation off, `docScheduler(maxSessions, treeTier)`; a lane worker
never runs the doc loop, a serial run has no flatten to feed). One teaching line accompanies the
kept marks. Floor: phases with no doc-eligible in_progress units compute an empty set — behavior
byte-identical; the marks are runtime state (`.auto/`, gitignored), so no commit or clean-tree
verdict changes.

## D2 — the ruling: the read follows the steer, like execute

The gate moves from the decompose mode to `switches.steer` — the same key `executeWhole` gates its
status parse on (the whole role's usage policy declares the protocol standing, so
`steer !== undefined` ⟺ the switch on). The per-stream path selection
(`opts.stream !== undefined ? subtaskDoc(...) : taskDoc(...)`) is unchanged; the strict-resume
`handoffInvalid` rung comes back alive in mode off with it. Steer off keeps the skipped read —
0130's floor, the protocol does not exist.

## D3 — the ruling: the stream report reads the owning task's document

`laneReportOf` branches on `streamUnitOf(unit)`: a stream unit's phase is read from the OWNING
task's state paths (`taskStatePaths(stream.task)` → `docs/T-001/{todo,done}.md`, the only document
carrying the `Phase:` field; the worktree holds the lead's landed todo/done either way), a plain
task unit keeps its own paths. Everything else in the report is unchanged. (The review's fix sketch
proposed reading `subtaskStateSpec(task, index)` pending/complete paths — verified wrong against the
grammar: a stream's own files never carry the `Phase:` field, so the report would still name no
phase; the owning-task read is what composes with `landRecovered`'s index lookup.)

## D4 — the ruling: every compose pass re-reads its remediable sources

A per-iteration `freshen()` — the planning input and the brief re-read at the top of each
`compose()` call in both `planPhase` and `appendPlan`. Only the side-effect-free sources remediation
can rewrite re-read; everything else stays captured (the task index path, the phase, the entry-held
standing predicate — read ahead of the loop precisely so the remediate passes cannot change the
answer — and the formulation parts, whose digest half BOOKS the planning session's sizes:
`statsDigest` counts one booking per call, so a per-pass `formulationParts` re-read would
double-book; the parts capture is the named residual below). First iteration's values are
identical, the byte-identical floor; the second pass verifies what landed.

## D5 — the ruling: the scope carries its judged document

`HandoverScope` grows `handoff?: string` — the handover document this scope is judged by:
`handoverVerdict` uses `scope.handoff ?? handoffFile(task)`, and `runSubtask` passes the
stream-aware `streamHandoff` only when `laneStream` (the serial in-lane stream keeps the task-level
file its steer names). The resume logs beside the read use the same `streamHandoff` selection. The
retry feedback, the handed-over log, the blocked message and the resume logs now all name the
document an obedient session must write.

## D6 — the ruling: the records persist before the commit that can fail

The `setSplit`/`setParked` re-persistence hoists to before the landing-sync commit — plain
registry writes into the MAIN tree's `.auto/units.json` (gitignored, no worktree dependency;
`reRootSplit` is pure string rewriting), so both paths — the settled landing and the failure branch
that tears the worktree down — have them persisted before any teardown. The success path's behavior
is unchanged (the same writes, earlier; no interleaving read between).

## D7 — the ruling: the escalation is bounded

After the timeout's SIGTERM, a bounded grace (`DEFAULT_KILL_GRACE_MS` = 10 s, seamed as
`killGraceMs` beside the other millisecond timings so tests run it short) then SIGKILL, one log
line naming the escalation — in both the single watchdog and the batch copy (per lane, its timer
cleared at that lane's exit). Floor: a child that exits on TERM never sees any of it — the grace
timer is cleared at the exit, so the normal and previously-working timeout paths are byte-identical
until a kill is actually ignored. The header's AUTO-RESOLVE note (which declined a kill-grace on
byte-identity grounds) is reworded to name its true scope: the normal path, which stays untouched.

## D8 — the ruling: the verify session's own close consumes

The PASS return of `verifySession` consumes the marker through the same `consumeDeadTestMarker`
seam, same log shape, attributed to this task — the wrap-up template forbids re-running checks, so
a marker there is the T-058 shape, and the next task's entry must never read it as wiring or
misattribute it. The FAIL paths are unchanged (their fix-round close already consumes and blocks).

## The floors

- **D1**: a serial run, a lane worker, a run under the doc-lanes kill switch, or a phase with no
  doc-eligible in_progress units computes an empty keep-set — every mark resets exactly as before;
  the doc loop itself is unchanged (it was correct; only its input was erased).
- **D2**: steer off skips the read — the old reuse answer, 0130's floor; mode `true`/`ondemand`
  with steer on behaved correctly before and after.
- **D3**: plain task units' reports are byte-identical; a stream worktree whose owning task's
  documents are somehow unreadable still carries `phase: ""` and lands in the named manual-landing
  block (fail loud, unchanged).
- **D4**: a step that never blocks reads its sources once more than before (identical values, no
  observable change); the digest-keep and standing predicate are untouched.
- **D5**: every scope that passes no `handoff` — executeWhole, the fix round, the serial stream —
  names the task-level file exactly as before.
- **D6**: the settled landing persists the same records (earlier, no interleaving read); the
  conflict/failed/blocked arms before step ③ are unchanged.
- **D7**: a child that honors SIGTERM exits to the same verdict, same timings, no log line; the
  batch's per-lane clearing mirrors the single watchdog's.
- **D8**: the FAIL paths and `--no-wrapup` are untouched; the entry-side and fix-round consumption
  sites stand.

## The named residuals

- **D1**: if the run stops before the doc loop is reached (a `/exit` at a boundary, a block in an
  earlier phase), the kept marks persist to the next run — the same recovery shape, one run later;
  and a keep-set computed over a current phase whose route later proves different (a handover
  re-entry) leaves marks the serial path's `next()` picks up all the same (`nextReady` treats any
  non-done unit as ready).
- **D2**: the read trusts the document's presence like execute does; a corrupt or foreign
  `handoff.md` under steer on now flips the ladder to fresh where it once fell through to reuse —
  conservative in the direction 0130 already ruled for every mode that built the protocol.
- **D7**: the SIGKILL reaches only the direct child (the runScript limitation, standing); a
  grandchild that trapped TERM survives the escalation as it survived the TERM.
- **D4**: the formulation parts stay an entry-time capture — `formulationParts`' digest half books
  the planning session's sizes (`statsDigest` counts one booking per call), so a per-pass re-read
  would double-book; a remediation that edits a handover (the handover-edit channel) re-voices at
  the step's next entry, not the mid-loop pass. The two sources the remediation channels actually
  target in practice — the planning input and the brief — are the freshened ones.
- **Deferred, standing**: `dispatchLane`'s booking attempts before its failure points (bounded,
  loud — the review found no corruption, only unbooked dispatch counts in a crash window); lane
  receipt races (none found — worktrees isolated, doc lanes serialized through the single commit
  queue).

Hygiene carried in the same change: preflight's orphan-recovery and housekeeping-commit-failure
exits now close `progress`/`watcher` (the clean-gate exit already did — the 10-min/10-s interval
leaks); the lane loop's serial degrade arm calls `regressionBoundary` like every other
unit-completing arm; the repair confinement restated to its true boundary (doc lanes at tier 0 do
repair — 0099 D3; worktree lanes and isolation do not; never under a stop condition) in
`RunAllOpts.repair`'s comment and AGENTS.md; the dead `?? "unrecorded phase"` fallback dropped (the
type guarantees `unit: string`); the local `pre` shadow in `driveRun` renamed; the dead exports
`countGaps`, `testChannelOffFor`, `HandoverScope` un-exported (each keeps exactly its module-internal
callers); `laneReportOf` exported for the composition test.

Derives: **P20** (in-flight work is never destroyed — the showing: D1's record-less siblings' dirt
never swept into another unit's stash, D6's split/parked records outliving their worktree, D7's
bounded escalation where an unbounded hang once stood), **P6** (derived state, idempotence,
re-derivation — the showing: D3's report phase re-derived from the document that actually holds the
grammar, D4's compose passes re-reading the durable surfaces instead of trusting a capture),
**P3** (completion is never judged by agent self-report; flow and recovery key on driver-persisted
evidence — the showing: D2's ladder answer keyed on the driver-side handover document and its
absence in the mode the default runs), **P13** (frozen additive-only vocabularies — the showing:
D5's file grammar — every surface that names the judged document now names the same one, no literal
grew a second meaning; D7's grace option and log line join the watchdog's seam additively), **P10**
(the byte-identical floor — the showing: each D's floors above, named per mechanism). Amends:
**plans/0099 D10** (the recovery flatten's input side — the flatten itself unchanged, preflight now
feeds it instead of erasing it), **plans/0130 D1** (the runner-side read moves onto 0130's own
steer key — the mode gate was a residue of the pre-0130 world the plan retired), **plans/0082 §5
D7** (the "from scratch" re-compose now includes the sources remediation can rewrite). Tier
touched: **mechanism** — core (`src/loop-preflight.ts`, `src/tasks.ts`, `src/runner.ts`,
`src/loop.ts`, `src/loop-plan.ts`, `src/execute.ts`, `src/lanes.ts`, `src/script.ts`,
`src/wrapup.ts`, `src/loop-task.ts`, `src/loop-phase.ts`) and AGENTS.md's repair line.

Tests: `test/agent-fake.test.ts` — the D1 composition scene (the killed doc-lane driven through
preflight then the doc loop: the kept marks, the teaching line, the 0149 exemption holding, the
rollback refusal firing while the sibling's dirt stays) beside the two standing direct-call tests;
`test/resume.test.ts` — the D2 pair (mode off + steer on: the handover rung taken, a fresh session
continues from the document; steer off: the reuse path, the read skipped); 
`test/lanes-scheduler.test.ts` — the D3 orphan scene with a stream unit (the report through the
real `laneReportOf` names the owning task's phase; the recovery lands, no exit 2) and the D6
landing-sync failure (a seam double failing exactly that stage; the split and parked records in the
main tree's `units.json` after the blocked landing); `test/blockage-diagnosis.test.ts` — the D4
interactive remediation (the planning-input channel rewriting `plan-input.md` through the real
executor, the second compose verifying the rewritten text, the step completing under
`stopBefore: "execute"`); `test/execute-handover.test.ts` — the D5 lane-stream retry feedback naming
`docs/T-001/S01/handoff.md`, never the task-level path; `test/script.test.ts` — the D7 pair (a
`trap '' TERM` child escalated in bounded time with the one log line; a TERM-honoring child
unchanged, no line) and the default-grace pin; `test/verify-loop.test.ts` — the D8 PASS-site
consumption (the verify session leaves the marker, the log names THIS task's id, the marker never
reaches the next task).
