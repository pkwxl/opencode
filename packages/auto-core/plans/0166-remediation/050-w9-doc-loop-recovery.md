# Step 050 — w9-doc-loop-recovery: doc-loop dead-end, Promise.race rejection arm, orphan probe bounds and identity

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W9-lanes (the doc-lane loop's recovery family), findings **0165-009**
(S05-02, S2), **0165-079** (S05-01, S3), **0165-080** (S05-03, S3) and
**0165-081** (S05-04, S3). Started 2026-11-08 at HEAD `2572943be` (steps
001–049 done); **done** the same day, ruled by
[../0210-doc-loop-recovery.md](../0210-doc-loop-recovery.md).

## Findings (from plans/0165-review/S05-loop-task.md)

- **0165-009 (S05-02, S2, P6/P8/P20, 0156 D1 + 0099 D10/D8)** — a
  doc-eligible in_progress leftover without an active progress record
  dead-ends the doc loop on every re-run, and on the way loses 0099 D10's
  protection: the flatten keeps its mark and its scope registry-live but
  never drives it, readyUnits treats it as busy, the main loop's dispatches
  carry no siblingScopes — so a resumed sibling's strict rollback stashes
  the leftover's preserved half-work — and the degrade arm ends in
  "not ready and nothing is executing … fix the task index manually", exit 2.
  Progress.json is one record (0099 D8), so a width-2 kill always leaves one
  in-flight unit in this shape.
- **0165-079 (S05-01, S3, P20, 0068 §6.2/0099 D3 drain rule)** —
  runDocLaneLoop's Promise.race over the pipelines has no rejection arm:
  any throw out of one doc unit's pipeline exits the loop mid-drain,
  abandoning the sibling pipelines in flight; runAll's finally then closes
  the server under their sessions and their partial work stays uncommitted.
- **0165-080 (S05-03, S3, 0068 D8/D14, P12/P2)** — the orphan recovery
  treats every dead pid as an orphan even when the worker wrote its
  controlled-exit report (the matrix row is "crash / no report"),
  re-dispatching instead of landing; and since nothing ever removes a reused
  worktree's `.auto/lane.json`, a re-dispatched worker that crashes is
  silently decided by the previous attempt's report.
- **0165-081 (S05-04, S3, P12/P8/P20/P5)** — the orphan recovery awaits any
  live process under a recorded lane pid with no bound, no identity check
  and no surfaced remedy: a pid recycled after a reboot or container restart
  (or a record from another host) holds every later run start forever.

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary for each finding first
   (requirement family, home-set enumeration). Write ruling **0210** first
   (Status: active; Derives/Amends with showing clauses; Category scope;
   D1..Dn; premise guard; named residuals; P13 statement).
2. Enact per decision; regression pins that fail on pre-fix source.
3. Full verification (`bun typecheck`, `bun test`; baseline 3141/0/155).
4. Docs lockstep (INDEX row, AGENTS.md navigation, structure.md), ledger
   rows for 009/079/080/081, program position; single commit.

## Work log

- 2026-11-08: step record created; status table marked `doing`. Read the
  S05 evidence, the source homes (loop-task.ts's doc loop, loop-preflight's
  recoverOrphanLanes, lanes.ts's dispatch/report/lock reads, runner.ts's
  rollback refusal, opts.ts's sessionOpts) and docs/principles.md; answered
  the boundary per finding; ruling 0210 written first.
- 2026-11-08: enactment — tasks.ts (`resetUnitInProgress`), loop-task.ts
  (D1 the race arm + failure drain; D3 the flatten reset, docAdmissible's
  own-scope exclusion, dispatch's sibling scopes, the degrade line), opts.ts
  (D2), runner.ts (D3 the refusal wording), lanes.ts (D4 the stale-report
  removal), loop-preflight.ts (D4/D5 report-first + identity wait + notice).
  One enactment defect caught by the new pin before commit: the flatten's
  pre-registered scope made the reset leftover inadmissible to itself
  (`docAdmissible` compared a unit against its own registration — the
  dead-end in a new shape); fixed by excluding the own entry (own dirt is
  the start gate's, never the admission's).
- 2026-11-08: test homes — agent-fake (+2), lanes-scheduler (+4 net, the
  live-pid pair reshaped, the 0156 D3 test launcher-guarded), session-opts
  (the D2 pin riding the width-keys test). Fail-before proof over
  /tmp/050-fixed; full verification; docs lockstep; committed.

## Verification

`bun typecheck` exit 0; auto-core full suite **3147 pass / 0 fail** (155
files = the 3141/155 baseline + 6 net new, zero regressions). Fail-before
proof over /tmp/050-fixed (the six changed src files backed up, `git show
HEAD:` pre-fix versions swapped in, the pins run, the fixed files restored
and cmp-verified byte-identical): **8 pins red on pre-fix source** —

- D1 (1 pin in agent-fake.test.ts): the sibling's done.md absent at the
  throw — the error surfaced at ~200 ms with T-002's turn still in flight
  (the abandonment verbatim; post-fix the same run lands T-002 done and
  committed, T-001's writes preserved as dirt, before the rethrow);
- D3 (1 pin in agent-fake.test.ts): the re-run's "T-002 has no active
  progress record" line never printing (the mark kept busy forever; the
  sweep one assertion later — notes.md gone, the stash list non-empty —
  and the "dependency graph cannot progress" dead-end line the old end);
- D2 (1 pin in session-opts.test.ts): the docLane site threading
  `ctx.control`;
- D4 (3 pins + 1 reshaped pair in lanes-scheduler.test.ts): the stale
  report surviving a re-dispatch over a recorded worktree; the FAIL report
  over a dead pid re-dispatched (attempts 2, the verdict never surfaced,
  the throwing launcher refused); the report-over-live-pid arm waiting the
  worker's full second with "still executing" logged (the pid overriding
  the report); the 0156 D3 scene re-dispatching over its written report
  (the "Cannot use describe outside of the test runner" relay verbatim —
  the stale read that test used to pass only through);
- D5 (1 pin in lanes-scheduler.test.ts): the recycled-pid scene (the
  record naming an unrelated live `sleep 8`) hanging to the 5 s test
  bound — the finding's own incident.

The pre-existing tests of the touched files were green on the pre-fix
source (the floor); the restored tree green across all three touched
suites (216/216). Shell guards: auto and auto-server typechecks clean;
auto 159/8/6 — the 5 known fork failures plus the "roadmap-driven
establishment" e2e, reproduced identically on pre-fix src (environment
drift on this host, both ways); auto-server 142/2 — "planPrelude boundary
matrix" and the 5 s "malformed requests" timeout, both reproduced
identically on pre-fix src (the same drift class; the known 0165-220
observe race passed this run). No packages/auto, auto-server or
templates/prompts surface touched by this step.

## Dispositions

- **0165-009 (S05-02, S2)** — fixed (ruling 0210 D3): the flatten owns
  every leftover — an unrecorded one's mark resets to pending
  (`resetUnitInProgress`), its scope staying registry-live, its dispatch
  turn coming, the start gate judging its dirt (0099 D10 delivered);
  `docAdmissible` never counting a unit's own registration; `dispatch`
  threading the live sibling scopes (the re-run sweep dead); the degrade's
  line naming what it skips.
- **0165-079 (S05-01, S3)** — fixed (ruling 0210 D1+D2): the race's
  rejection arm (drain, land, rethrow — the siblings' work committed when
  the error surfaces) and the doc session's control-less opts (the
  in-pipeline /exit probes structurally gone).
- **0165-080 (S05-03, S3)** — fixed (ruling 0210 D4): the report read
  first whatever the pid says (a dead pid never overrides a written
  verdict), the reused worktree's stale report removed before every
  re-spawn, the 0156 D3 test launcher-guarded.
- **0165-081 (S05-04, S3)** — fixed (ruling 0210 D5): the wait entered
  only on the worktree run lock's identity (host + pid), an unidentified
  live pid one ⚠ line and the crashed posture, the identified wait's
  repeating notice naming the pid and the manual remedy.
- Named residuals carried (0210): the dispatch-time siblingScopes snapshot
  (a lane dispatched before its sibling, and the engine's deeper
  rollbackRedo) stay 0165-019's (step 077, the guard at
  rollbackUnitState); the degrade's naming arm defensive; D4's final-exit
  window one bounded re-dispatch, never a loss; the notice cadence
  implemented but unpinned; no behavioral /exit-during-doc-pipeline pin
  (no channel, 0068 D11).
- Premise guard: 0068 D14 and 0099 D10 re-read and annotated in the same
  change; 0068 D8, 0156 D1 and 0143 D3/D4 re-read standing.

