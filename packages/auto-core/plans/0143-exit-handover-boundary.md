# 0143 — the session handover and the wrap-up entry are /exit boundaries: the person's pause lands at the run's real pause points, not at the task's close

The maintainer's field report (2026-10-27, over the `dm-glm-t083` fork of the aster-mig cleanroom,
mid-run, T-083 "K5 verity (batch B14)" attempt 3): *Why does `/exit` not lead to exiting at
handover?* — with the run's log: the second session received `/exit` at 22:34, the acknowledgement
promised "will pause and exit at the next safe boundary (phase/task/subtask handover point, or a
recovery wait)", the session then reached its wall and handed itself over
(`docs/T-083/handoff.md`; continuing in a new session) — and the driver dispatched the third
session. The ruling, the maintainer's own words: *It should exit at handover, as it did in
subtasks.* The follow-up ruling, same day, after the first landed: *It should also exit before a
`wrapup`* — the pause must not wait out the task's whole verification tail either.

## The measurement (the probe census and the incident's own journal)

- The incident's `.auto/run-status.jsonl`, in order: `task-start` T-083 → `session-handover`
  (self-directed, 223.9k of the 250k wall) → **`exit-request`** → `session-handover` again
  (231.8k) → the third session dispatched. The request sat pending through a full handover and
  past it.
- The `maybeExit` census: the flag is consumed only at the step-mode pause points /exit inherited
  wholesale — phase planning (`src/loop-plan.ts`), phase append, phase handover
  (`src/loop-phase.ts`), the task boundaries (`src/loop-task.ts` — the task-close and lane-drain
  probes), the subtask steps (`src/runner.ts`), plus the recovery sleep (0057). The three
  continuation loops' `continue` branches — `executeWhole`, `runSubtask`'s streams, the fix
  rounds — hold none: the verdict consumed the document and the loop dispatches the next session
  with no checkpoint between.
- The design archaeology: 0014 enumerated "the three existing step-mode safe boundaries"; 0057
  added the wait; 0130 made the handover standing for every whole-task session and fix round and
  never mentions `/exit` — the two mechanisms never crossed. Before 0130 the gap was rare (a
  handover needed the switch on and a wall hit); after it, handovers are the normal rhythm of
  every long task, so the person's pause now waits out handover after handover, each one exactly
  the scene 0014's own contract names as safe.
- The contract already holds at the handover point, each scope measured: `executeWhole` commits
  **before** the verdict (`git.afterSession` precedes `handoverVerdict`) and the handoff document
  rides that commit; the resume path seeds the continuation from the document ("resume after
  interruption: handed over as … the new session continues from the handover document",
  `src/execute.ts`) — the incident's own run demonstrates it (attempt 3 began from exactly that
  state: "the record has no session; starting a new session to continue"). A stream's open work
  and a fix round's open work are the interruption seeding their resume paths already own
  (0130 D2's round-entry seeding; resumed runs exempt from the clean gate).
- *As it did in subtasks*: the subtask pipeline's probe lands between subtasks — an intermediate
  committed boundary inside one task where the person's `/exit` takes effect long before the task
  closes. The whole-task session handover is that boundary's structural twin, and it held no
  probe.

The defect, one sentence: 0014's boundary enumeration was never revisited when 0130 made session
handovers the normal rhythm of every long task, so `/exit` — whose acknowledgement copy even says
"handover point" — sits pending while the driver burns continuation sessions the person asked to
stop after.

## D1 — the handover point is an exit boundary, all three scopes

`maybeExit("handover", …)` fires at the `continue` verdict, after the document is consumed and
before the continuation dispatch, in all three continuation loops:

- `executeWhole` — label `T-NNN session handover`;
- `runSubtask`'s streams — `T-NNN subtask <n> session handover`;
- `runFixRound` — `T-NNN fix <round> session handover`.

The throw propagates to `runAll`'s uniform `ExitRequested` catch (exit code 3, the re-run resume
promise) — no intermediate catch exists on any of the three paths (measured: the subtask probe at
the runner's own depth already proves the pipeline path; the wrapup path is return-value-driven).

## D2 — the vocabulary grows additively, one lockstep

`"handover"` joins the exit boundary set — `EXIT_BOUNDARIES` in `src/run-status-schema.ts` and
`ExitRequested`'s union in `src/exit.ts`, in the same change (D5 adds `"wrapup"` beside it).
`Boundary` (`src/control-types.ts`) stays the step trio: step mode does not pause at handovers
and failback does not reset there — the kind is `/exit`'s own, never a second meaning of
`"task"` (P13). The acknowledgement message is reworded to name the real set ("a phase, task or
subtask boundary, a session handover, a wrap-up entry, or a recovery wait") — the old copy's
"phase/task/subtask handover point" was the wording the person reasonably read as session
handovers.

## D3 — the crash-isomorphism at each scope

`executeWhole`: the session's work is committed before the verdict; the pause leaves exactly the
scene a kill at that spot leaves, and the re-run seeds the continuation from the committed
document. A stream (`runSubtask`): the open work is the interruption seeding the resume path
owns. A fix round: neither booked nor committed past the verdict — the round-opening persist
stands as the record a kill between the round's sessions leaves (the same record 0142 D2's
unbooked round produces), and the re-run's round entry seeds from the document. An `/exit`
request cannot cross a worker process boundary, so inside a lane worker the probes read a fresh
control and are inert — the parent's drain rule keeps its order (a mid-drain throw would abandon
in-flight lanes).

## D4 — floors, narrow scope, residuals

- Floors (P10): the flag unset — or `control` absent, which is every lane worker and every unit
  test threading no control — makes the optional-chained probe a no-op; the whole existing suite
  pins the unchanged behavior. The `retry`/`coldstart` remediation branches keep their existing
  flow: a strict-resume rollback is not cut mid-flight, and the exit waits for the next handover
  or the task close (the ruling's words are "at handover", and the remediation loops are not
  handovers).
- Narrow scope: the rejected-split continuation and the park feedback retry also dispatch new
  sessions but are not handovers (no document consumed); they keep their flow.
- Residual: none named. The acknowledgement copy, the README row, and the exit-boundary comments
  reworded in the same change.

## D5 — the wrap-up entry is an /exit boundary (the follow-up ruling)

The second ruling, the maintainer's words: *It should also exit before a `wrapup`.* `runWrapup`
probes at the head of its round loop, **after the stage persist** (`{kind: wrapup, round?}` —
exactly the record a re-run re-enters by; the verify-loop resume fixtures seed it by hand) and
**before the round's first verification act** (the lane gate, the verify session, or the red
path). Every iteration probes — the initial entry and each re-verification after a fix round —
always after the persist, so a pause at any of them re-enters at the next verify session with
the spent rounds standing. Before the probe takes it, a pending request has already passed the
execution stage's commits (the incident's shape: an execution task whose whole verification tail
would otherwise run before the task close boundary). `--no-wrapup` never enters the loop (the
task close boundary catches the request), and the fix-round *dispatch* is deliberately not
probed — the words name the wrap-up; a fix round's own handover boundary (D1) and the next
entry bound its wait. Vocabulary: `"wrapup"` joins the set beside `"handover"` (D2's lockstep);
the label names the entry (`T-NNN wrap-up entry`, the re-verifications `… (after fix round N)`).

This ruling Derives: **P2** (the person brackets every boundary — the showing: `/exit` is the
person's pause request; holding it pending through handover after handover, and then through the
task's whole verification tail, is the driver consuming the person's bracket, and now it lands
at the first safe point the task itself reaches), **P20** (in-flight work never destroyed;
control changes land only at safe boundaries — the showing: every probe placed exactly where a
kill would leave an equivalent scene, each scope's resume path owning the state, the lane drain
never cut), **P13** (frozen additive vocabularies — the showing: `"handover"` and `"wrapup"`
join the exit-boundary vocabulary in one lockstep, kinds of their own rather than second
meanings of `"task"`), **P10** (the byte-identical floor — the showing in D4), **P19** (measured
evidence — the incident's own journal ordering, the maybeExit census, the resume lines in the
incident's own log, the persist-then-probe ordering pinned against the resume fixtures' own
seeded record). Amends: **0014**'s boundary enumeration (the set grows to include the session
handover and the wrap-up entry; the contract — land only where the boundary's own close-out has
persisted everything — unchanged, and D3/D5 show both points satisfy it); 0130's handovers are
now `/exit` boundaries (their own standing unaffected). Tier touched: **mechanism** — core
(`src/exit.ts`, `src/execute.ts`, `src/wrapup.ts` — the fix-round handover and the wrap-up
entry, `src/run-status-schema.ts`, `src/interactive.ts`, comments in `src/loop.ts` and
`src/control-types.ts`) and the shell README row.

Tests: `test/exit.test.ts`'s handover- and wrapup-kind pins (the boundaries and the message
text), `test/execute-handover.test.ts`'s two `/exit`-at-handover cases (whole-task: the exit
thrown at the handover with exactly one session dispatched; a stream: the same at the subtask's
handover), `test/verify-loop.test.ts`'s fix-round variant (the exit before the continuation, the
round uncommitted, the handoff document on disk as the re-run's seeding) and wrap-up-entry case
(end to end through `runTask`: the execution session's commit landed, the progress record at
`{kind: wrapup}`, the verify session never dispatched) — and the unchanged continuation cases
beside them pin the flag-unset floor.
